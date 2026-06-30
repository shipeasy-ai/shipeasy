/**
 * Skill → command contract scanner.
 *
 * Pulls every CLI invocation (`shipeasy …`) and MCP tool call (`mcp tool: …`,
 * `tool_name { … }`, or a back-ticked tool name) out of the shipped skill
 * markdown, then validates each one against the *real* surfaces:
 *
 *   - CLI: the commander command tree (command path must resolve; every long /
 *     short flag must be a registered option on the resolved command).
 *   - MCP: the tool catalog (the tool name must exist; every top-level param in
 *     a `{ … }` body must be a property on the tool's input schema).
 *
 * This module is surface-agnostic — the test wires in the live CLI program and
 * MCP tool list so the scan runs against whatever the packages currently ship,
 * catching drift the moment a skill references a renamed/removed command, a
 * dropped flag, or a param that no longer exists.
 */

// ── structural surface types (so we don't depend on commander / the MCP SDK) ──

/** Minimal shape of a commander Command we rely on. */
export interface CmdNode {
  name(): string;
  commands: CmdNode[];
  options: { long?: string | null; short?: string | null }[];
}

/** Minimal shape of an MCP tool definition. */
export interface ToolDef {
  name: string;
  inputSchema?: { properties?: Record<string, unknown> } | undefined;
}

// ── reference records ─────────────────────────────────────────────────────────

export interface CliRef {
  file: string;
  /** The reconstructed `shipeasy …` invocation (for error messages). */
  raw: string;
  /** Whitespace-split argv after `shipeasy`. */
  tokens: string[];
}

export interface McpRef {
  file: string;
  name: string;
  /** Top-level keys passed in the `{ … }` body (empty for bare mentions). */
  keys: string[];
  /** How it was found — for diagnostics. */
  kind: "mcp tool:" | "name{}" | "bare";
}

// A token ends the command path when it's an option, a placeholder, or an
// ellipsis — everything after is args/flags, not subcommands.
const PLACEHOLDER = /[<>[\]…]|\.\.\./;
// Space-delimited shell operators start a *new* command; truncate the
// invocation there so `a && test -f x` doesn't leak `-f` onto `a`.
const SHELL_OP = /\s(?:&&|\|\||;|\||>>?|<|2>(?:&1)?)\s/;

// ── code-context extraction (CLI) ─────────────────────────────────────────────

/** Fenced code blocks + inline code spans — the only places we trust as CLI
 *  invocations (prose mentions like "(shipeasy error)" are not commands). */
export function extractCodeSegments(raw: string): string[] {
  const segs: string[] = [];
  for (const m of raw.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)) segs.push(m[1]);
  for (const m of raw.matchAll(/`([^`\n]+)`/g)) segs.push(m[1]);
  return segs;
}

const CLI_RE = /(?<![\w@/:-])shipeasy\s+([^\n`]*)/g;

export function extractCliRefs(file: string, raw: string): CliRef[] {
  const refs: CliRef[] = [];
  for (const seg of extractCodeSegments(raw)) {
    // Join `\`-continuations so multi-line invocations keep their flags.
    const joined = seg.replace(/\\\n/g, " ");
    for (const m of joined.matchAll(CLI_RE)) {
      let inv = m[1];
      inv = inv.replace(/\s+#.*$/, ""); // strip trailing comment
      const op = inv.search(SHELL_OP); // cut at first shell operator
      if (op >= 0) inv = inv.slice(0, op);
      const tokens = inv.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;
      refs.push({ file, raw: `shipeasy ${inv}`.trim(), tokens });
    }
  }
  return refs;
}

// ── MCP extraction ────────────────────────────────────────────────────────────

/** Capture a balanced `{ … }` starting at `start` (which must point at `{`). */
export function captureBraces(str: string, start: number): string | null {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (inStr) {
      if (ch === inStr && str[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

/** Keys declared at the top level of an object literal (depth 1). Nested object
 *  / array keys (e.g. a JSON-Schema `properties`) are deliberately ignored. */
export function topLevelKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (ch === inStr && body[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      depth--;
      continue;
    }
    if (depth === 1 && ch === ":") {
      let j = i - 1;
      while (j >= 0 && /\s/.test(body[j])) j--;
      if (body[j] === '"' || body[j] === "'") {
        const q = body[j];
        j--;
        let s = j;
        while (s >= 0 && body[s] !== q) s--;
        keys.push(body.slice(s + 1, j + 1));
      } else {
        let s = j;
        while (s >= 0 && /[A-Za-z0-9_]/.test(body[s])) s--;
        const k = body.slice(s + 1, j + 1);
        if (k) keys.push(k);
      }
    }
  }
  return [...new Set(keys)];
}

const SNAKE = "[a-z][a-z0-9]*(?:_[a-z0-9]+)+";

export function extractMcpRefs(file: string, raw: string, toolPrefixes: string[]): McpRef[] {
  const refs: McpRef[] = [];
  const hasPrefix = (n: string) => toolPrefixes.some((p) => n.startsWith(p));

  // 1. `mcp tool: NAME` (optionally followed by a `{ … }` body).
  for (const m of raw.matchAll(/mcp tool:\s*([a-z][a-z0-9_]*)/g)) {
    const name = m[1];
    let keys: string[] = [];
    const after = raw.slice(m.index! + m[0].length);
    const bi = after.search(/\S/);
    if (bi >= 0 && after[bi] === "{") {
      const body = captureBraces(after, bi);
      if (body) keys = topLevelKeys(body);
    }
    refs.push({ file, name, keys, kind: "mcp tool:" });
  }

  // 2. `tool_name { … }` — an inline invocation with args.
  for (const m of raw.matchAll(new RegExp(`(?<![\\w])(${SNAKE})\\s*\\{`, "g"))) {
    const name = m[1];
    if (!hasPrefix(name)) continue;
    const bi = m.index! + m[0].length - 1;
    const body = captureBraces(raw, bi);
    refs.push({ file, name, keys: body ? topLevelKeys(body) : [], kind: "name{}" });
  }

  // 3. Back-ticked bare mention (`tool_name`). Skip wildcards (`foo_*`) and
  //    negative mentions ("there is no `tool_name`").
  for (const m of raw.matchAll(new RegExp("`(" + SNAKE + "(?:_\\*)?)`", "g"))) {
    const name = m[1];
    if (name.includes("*")) continue;
    if (!hasPrefix(name)) continue;
    const pre = raw.slice(Math.max(0, m.index! - 8), m.index!);
    if (/\bno\s+`?$/i.test(pre)) continue;
    refs.push({ file, name, keys: [], kind: "bare" });
  }

  return refs;
}

// ── CLI validation ────────────────────────────────────────────────────────────

function childByName(node: CmdNode, name: string): CmdNode | undefined {
  return node.commands.find((c) => c.name() === name);
}

function flagSet(node: CmdNode): Set<string> {
  const s = new Set<string>();
  for (const o of node.options) {
    if (o.long) s.add(o.long);
    if (o.short) s.add(o.short);
  }
  return s;
}

interface Resolved {
  path: string[];
  rest: string[];
  node: CmdNode;
}

/** Greedily descend the command tree, branching on `a|b` and `a/b` alternation.
 *  Stops at the first option / placeholder / non-subcommand token. */
function descend(root: CmdNode, tokens: string[]): Resolved[] {
  function rec(node: CmdNode, path: string[], idx: number): Resolved[] {
    if (idx >= tokens.length) return [{ path, rest: [], node }];
    const tok = tokens[idx];
    if (tok.startsWith("-") || PLACEHOLDER.test(tok))
      return [{ path, rest: tokens.slice(idx), node }];

    const matched: CmdNode[] = [];
    let ok = true;
    for (const part of tok.split("|")) {
      const c = childByName(node, part);
      if (c) {
        matched.push(c);
        continue;
      }
      if (part.includes("/")) {
        const subs = part.split("/").map((x) => childByName(node, x));
        if (subs.every(Boolean)) {
          matched.push(...(subs as CmdNode[]));
          continue;
        }
      }
      ok = false;
      break;
    }
    if (!ok || matched.length === 0) return [{ path, rest: tokens.slice(idx), node }];

    return matched.flatMap((c) => rec(c, [...path, c.name()], idx + 1));
  }
  return rec(root, [], 0);
}

const SKIP_FLAGS = new Set(["--help", "-h", "--version", "-V"]);

/** Returns a list of human-readable problems for one CLI reference (empty = ok). */
export function validateCliRef(ref: CliRef, root: CmdNode): string[] {
  const problems: string[] = [];

  // A bare command word that resolves to nothing is unknown-command drift.
  const t0 = ref.tokens[0];
  if (/^[a-z]/.test(t0) && !/[<>[\]…|/]/.test(t0) && !childByName(root, t0)) {
    return [`unknown command \`shipeasy ${t0}\`  (from: ${ref.raw})`];
  }

  const resolved = descend(root, ref.tokens).filter((r) => r.path.length > 0);
  // No real command resolved → a placeholder like `shipeasy …` / `shipeasy <cmd>`.
  if (resolved.length === 0) return problems;

  for (const r of resolved) {
    const flags = flagSet(r.node);
    for (const tok of r.rest) {
      if (!tok.startsWith("-")) continue;
      const flag = tok.split("=")[0];
      if (SKIP_FLAGS.has(flag)) continue;
      if (PLACEHOLDER.test(flag)) continue;
      if (!/^-{1,2}[a-z]/.test(flag)) continue;
      if (!flags.has(flag)) {
        problems.push(
          `\`shipeasy ${r.path.join(" ")}\` has no option \`${flag}\`  (from: ${ref.raw})`,
        );
      }
    }
  }
  return problems;
}

// ── MCP validation ────────────────────────────────────────────────────────────

export function toolPrefixesFrom(tools: ToolDef[]): string[] {
  return [...new Set(tools.map((t) => t.name.split("_")[0]).filter(Boolean))].map((p) => `${p}_`);
}

export function validateMcpRef(ref: McpRef, byName: Map<string, ToolDef>): string[] {
  const tool = byName.get(ref.name);
  if (!tool) return [`unknown MCP tool \`${ref.name}\` (${ref.kind})`];
  const props = tool.inputSchema?.properties ? Object.keys(tool.inputSchema.properties) : [];
  const problems: string[] = [];
  for (const k of ref.keys) {
    if (!props.includes(k)) problems.push(`MCP tool \`${ref.name}\` has no param \`${k}\``);
  }
  return problems;
}
