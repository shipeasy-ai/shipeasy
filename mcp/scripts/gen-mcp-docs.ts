/**
 * Generate the MCP reference from the tool catalog, enriched from the spec.
 *
 * The catalog (`TOOLS` in ../src/tools/schema.ts) is the source of truth for
 * WHICH tools exist — the exact array the server advertises via
 * `ListToolsRequestSchema`, so the docs can never list a tool the server lacks.
 * But the catalog deliberately carries only a short description + input schema.
 * For the full documentation — the human title, the complete (multi-paragraph)
 * description, and the per-operation error codes — we read `@shipeasy/openapi`'s
 * bundled `openapi.yaml`, plus the shared custom-op registry
 * (`@shipeasy/openapi/custom`) for the non-spec ops (`docs_*`, `metrics_grammar`).
 *
 * Structure mirrors the CLI reference: tools are NESTED under their tag chain
 * (Release ▸ Flags ▸ Attributes, Release ▸ Experiments ▸ Universes, Metrics ▸
 * Events, Ops ▸ Alerts) and each parent level prints its own tag description —
 * the same hierarchy the CLI projects into `release flags …` command groups.
 * The remaining hand-written tools (auth, projects_upsert, and the pure-API
 * i18n write tools) have no spec/custom op; they nest under the matching tag
 * (or a synthetic Auth group) and fall back to the catalog description.
 *
 *   pnpm --filter @shipeasy/mcp docs            # all groups
 *   pnpm --filter @shipeasy/mcp docs release    # only this top-level group
 *
 * Two outputs, generated together:
 *   • ../docs/mcp-reference.md — this package's own reference (always written).
 *   • apps/docs/.../mcp-reference.mdx — the published site page, written only
 *     when this package is checked out inside the monorepo (so a standalone
 *     marketplace build skips it instead of creating an orphan apps/ tree).
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parse as parseYaml } from "yaml";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { customOperations } from "@shipeasy/openapi/custom";
import { TOOLS } from "../src/tools/schema";

// HERE === marketplace/mcp/scripts. The monorepo root is three levels up
// (mcp → marketplace → root), so apps/docs resolves there when embedded.
const HERE = dirname(fileURLToPath(import.meta.url));
const LOCAL_OUT = join(HERE, "../docs/mcp-reference.md");
const APPS_DOCS_ROOT = join(HERE, "../../../apps/docs");
const APPS_DOCS_OUT = join(
  APPS_DOCS_ROOT,
  "content/docs/get-started/mcp-reference.mdx",
);

// ── spec → tag tree + per-tool metadata ───────────────────────────────────────
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const spec: any = parseYaml(
  readFileSync(require.resolve("@shipeasy/openapi/openapi.yaml"), "utf8"),
);

const specSlug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const firstLine = (s: string) => (s ? s.split("\n")[0].trim() : "");

// i18n's API parts + projects_upsert have richer hand-written tools — gen-tools
// skips/overrides them, so they carry no spec op and fall back to the catalog.
const SKIP_TAGS = new Set(["i18n", "Profiles", "Keys", "Drafts"]);
const OVERRIDDEN = new Set(["projects_upsert"]);
const METHODS = ["get", "post", "put", "patch", "delete"];

type SpecMeta = { title: string; description: string; errorCodes: string[] };
const specByTool = new Map<string, SpecMeta>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tagByName: Record<string, any> = Object.fromEntries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (spec.tags ?? []).map((t: any) => [t.name, t]),
);
type TagSeg = { slug: string; name: string; desc: string };
function tagChain(name: string): TagSeg[] {
  const chain: TagSeg[] = [];
  let t = tagByName[name];
  while (t) {
    chain.unshift({
      slug: specSlug(t.name),
      name: t.name,
      desc: String(t.summary || t.description || "").trim(),
    });
    t = t.parent ? tagByName[t.parent] : undefined;
  }
  return chain;
}

// Per-tool spec metadata, named exactly the way gen-tools.mjs names tools:
// tag-chain slugs + the x-cli verb, joined by `_`. Synthetic verbs
// (x-cli.commands) each get their own tool with their own summary.
for (const item of Object.values(spec.paths ?? {})) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pathItem = item as any;
  for (const method of METHODS) {
    const op = pathItem[method];
    if (!op || !op["x-cli"]) continue;
    const tag = op.tags?.[0];
    if (SKIP_TAGS.has(tag)) continue;
    const segs = tagChain(tag).map((s) => s.slug);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const verbs = op["x-cli"].commands ?? [{ name: op["x-cli"].name, summary: op.summary }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const v of verbs) {
      const name = [...segs, v.name].join("_").replace(/-/g, "_");
      if (OVERRIDDEN.has(name)) continue;
      const meta: SpecMeta = {
        title: firstLine(String(v.summary || op.summary || "")),
        description: String(op.description || op.summary || "").trim(),
        errorCodes: op["x-error-codes"] ?? [],
      };
      specByTool.set(name, meta);
      // A top-level alias tool (e.g. `whoami` for getCurrentProject) shares the
      // same metadata — register it so the alias renders fully enriched too.
      const alias = op["x-cli"].commands ? undefined : op["x-cli"].topLevelAlias;
      if (alias) specByTool.set(String(alias), meta);
    }
  }
}

// Custom (non-spec) ops — `docs_*`, `metrics_grammar` — carry their own
// title/description in the shared `@shipeasy/openapi/custom` registry. They're
// auth-free outbound/pure ops, so they have no admin error envelope
// (`errorCodes: []`). Spec ops win if a name somehow collides.
for (const op of customOperations) {
  const name = [...op.group, op.name].join("_").replace(/-/g, "_");
  if (specByTool.has(name)) continue;
  specByTool.set(name, {
    title: firstLine(op.summary),
    description: String(op.description || op.summary || "").trim(),
    errorCodes: [],
  });
}

// The ErrorCode catalogue (code → meaning) — the single source for every error
// the admin API can return. Per-op `x-error-codes` is a subset of these.
const errorCode = spec.components?.schemas?.ErrorCode ?? {};
const ERROR_MEANINGS: Record<string, string> = errorCode["x-enum-descriptions"] ?? {};
const ALL_ERROR_CODES: string[] = errorCode.enum ?? Object.keys(ERROR_MEANINGS);
// Codes every registry-backed tool can return — surfaced once in the global
// section instead of repeated on all ~80 tools (intersection of matched ops).
const matchedErrorSets = [...specByTool.values()]
  .map((m) => m.errorCodes)
  .filter((c) => c.length);
const COMMON_CODES = new Set<string>(
  matchedErrorSets.length
    ? matchedErrorSets.reduce((acc, codes) => acc.filter((c) => codes.includes(c)))
    : [],
);

// ── tag tree (the nesting skeleton, mirroring the CLI command tree) ───────────
type TagNode = {
  slug: string;
  name: string;
  desc: string;
  children: Map<string, TagNode>;
  tools: Tool[];
};
const newNode = (slug: string, name: string, desc = ""): TagNode => ({
  slug,
  name,
  desc,
  children: new Map(),
  tools: [],
});
const roots = new Map<string, TagNode>();

function ensurePath(path: TagSeg[]): TagNode {
  let level = roots;
  let node!: TagNode;
  for (const seg of path) {
    if (!level.has(seg.slug)) level.set(seg.slug, newNode(seg.slug, seg.name, seg.desc));
    node = level.get(seg.slug)!;
    if (!node.desc && seg.desc) node.desc = seg.desc;
    level = node.children;
  }
  return node;
}

// Pre-create the full tag tree in spec order so top-level groups + their
// descriptions are ordered by the spec, not by tool-placement order.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
for (const t of spec.tags ?? []) ensurePath(tagChain(t.name));

// Synthetic top-level groups for hand-written tools that have no spec tag,
// appended after the spec roots so they render last.
roots.set(
  "auth",
  newNode(
    "auth",
    "Auth",
    "Device-flow (PKCE) authentication shared with the CLI — authenticate once and every mutating tool can write. The token is stored in `~/.config/shipeasy/config.json`.",
  ),
);
roots.set(
  "docs",
  newNode(
    "docs",
    "SDK docs",
    "Fetch SDK documentation — feature pages, nested snippets, and installable skills — from each SDK's published GitHub Pages docs.",
  ),
);

// Tools with no tag-prefix match are placed explicitly under an existing group.
// `whoami` is the flat top-level alias of getCurrentProject — nest it with the
// other Projects tools.
const EXPLICIT: Record<string, string[]> = { whoami: ["projects"] };

// Flatten the tree into joined-slug paths for longest-prefix tool placement.
const tagPaths: { joined: string; path: string[] }[] = [];
(function collect(level: Map<string, TagNode>, prefix: string[]) {
  for (const [slug, node] of level) {
    const path = [...prefix, slug];
    tagPaths.push({ joined: path.join("_"), path });
    collect(node.children, path);
  }
})(roots, []);
tagPaths.sort((a, b) => b.joined.length - a.joined.length);

function nodeByPath(path: string[]): TagNode {
  let level = roots;
  let node!: TagNode;
  for (const slug of path) {
    node = level.get(slug)!;
    level = node.children;
  }
  return node;
}

const orphans: Tool[] = [];
for (const tool of TOOLS) {
  const ov = EXPLICIT[tool.name];
  if (ov) {
    nodeByPath(ov).tools.push(tool);
    continue;
  }
  const tp = tagPaths.find(
    (p) => tool.name === p.joined || tool.name.startsWith(p.joined + "_"),
  );
  if (tp) nodeByPath(tp.path).tools.push(tool);
  else orphans.push(tool);
}

/**
 * Render target for one output file. `mdx` toggles MDX-only escaping (`{`/`<`)
 * and frontmatter; plain markdown (the in-repo copy) skips both so it reads
 * cleanly on GitHub.
 */
let MDX = true;

/**
 * Escape author-written prose, leaving `inline code` spans untouched. In MDX,
 * `{`/`<` must be backslash-escaped (they start a JS expression / JSX tag); in
 * plain markdown they're literal, so we leave them. In a table cell `|` must be
 * escaped everywhere — even inside code — because both the MDX and CommonMark
 * table tokenizers split on `|` before parsing inline code.
 */
function escapeProse(s: string, inTable: boolean): string {
  return s
    .split(/(`[^`]*`)/g)
    .map((part) => {
      const isCode = part.startsWith("`") && part.endsWith("`");
      const out = isCode || !MDX ? part : part.replace(/([{}<])/g, "\\$1");
      return inTable ? out.replace(/\|/g, "\\|") : out;
    })
    .join("")
    .trim();
}
const cell = (s: string) => escapeProse(s, true);
const prose = (s: string) => escapeProse(s, false);
const codeCell = (s: string) => "`" + s.replace(/\|/g, "\\|") + "`";

type JsonSchema = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
};

/**
 * Compact a JSON-Schema node into a single `type` token. Uses plain `|` for
 * unions — `codeCell` does the table-cell pipe escaping at render time.
 */
function typeOf(s: JsonSchema): string {
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  const base = Array.isArray(s.type) ? s.type.join(" | ") : (s.type ?? "any");
  if (base === "array" && s.items) return `${typeOf(s.items)}[]`;
  return base;
}

/**
 * Helper-text suffix for a parameter — default, numeric range, length range,
 * format, and pattern carried through from the schema. (Enums already show in
 * the Type column via `typeOf`.) Returns "" when the schema has no constraints.
 */
function constraints(s: JsonSchema): string {
  const parts: string[] = [];
  if (s.default !== undefined) parts.push(`default \`${JSON.stringify(s.default)}\``);
  if (s.minimum !== undefined && s.maximum !== undefined) parts.push(`${s.minimum}–${s.maximum}`);
  else if (s.minimum !== undefined) parts.push(`≥ ${s.minimum}`);
  else if (s.maximum !== undefined) parts.push(`≤ ${s.maximum}`);
  if (s.minLength !== undefined || s.maxLength !== undefined)
    parts.push(`length ${s.minLength ?? 0}–${s.maxLength ?? "∞"}`);
  if (s.format) parts.push(`format: ${s.format}`);
  if (s.pattern) parts.push(`pattern \`${s.pattern}\``);
  return parts.join("; ");
}

/**
 * Flatten an object schema into table rows. Nested object properties are
 * rendered one level deep with dotted names (e.g. `params.gate_id`).
 */
function rows(schema: JsonSchema, prefix = ""): string[] {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const out: string[] = [];
  for (const [name, prop] of Object.entries(props)) {
    const full = prefix ? `${prefix}.${name}` : name;
    const req = required.has(name) ? "required" : "optional";
    const note = constraints(prop);
    const desc = (prop.description || "—") + (note ? ` _(${note})_` : "");
    out.push(`| ${codeCell(full)} | ${req} | ${codeCell(typeOf(prop))} | ${cell(desc)} |`);
    if (prop.type === "object" && prop.properties) out.push(...rows(prop, full));
  }
  return out;
}

function paramsTable(schema: JsonSchema): string {
  const body = rows(schema);
  if (!body.length) return "_No parameters._";
  return ["| Parameter | | Type | Description |", "| --- | --- | --- | --- |", ...body].join("\n");
}

const heading = (depth: number) => "#".repeat(Math.min(depth + 1, 6));

/** One tool leaf, at the given depth. Parameters/Errors are bold labels (not
 * headings) so deep nesting never blows past h6. */
function toolBlock(tool: Tool, depth: number): string {
  const meta = specByTool.get(tool.name);
  const out: string[] = [`${heading(depth)} \`${tool.name}\``, ""];

  if (meta?.title) out.push(`**${prose(meta.title)}**`, "");
  const description = meta?.description || tool.description || "";
  if (description) out.push(prose(description), "");

  out.push("_Parameters_", "", paramsTable(tool.inputSchema as JsonSchema), "");

  if (meta) {
    const extra = meta.errorCodes.filter((c) => !COMMON_CODES.has(c));
    if (extra.length) {
      out.push("_Errors_ — beyond the [common errors](#errors):", "");
      for (const c of extra) out.push(`- ${codeCell(c)} — ${cell(ERROR_MEANINGS[c] ?? "")}`.trimEnd());
      out.push("");
    }
  }
  return out.join("\n");
}

/** True if the node or any descendant has tools (empty tag branches are dropped). */
function hasTools(node: TagNode): boolean {
  return node.tools.length > 0 || [...node.children.values()].some(hasTools);
}

/** Render a tag group and everything beneath it: its description, its own tool
 * leaves (sorted), then its child groups — recursing to any depth. */
function renderNode(node: TagNode, depth: number): string {
  const out: string[] = [`${heading(depth)} ${node.name}`, ""];
  if (node.desc) out.push(prose(node.desc), "");
  for (const tool of [...node.tools].sort((a, b) => a.name.localeCompare(b.name)))
    out.push(toolBlock(tool, depth + 1));
  for (const child of node.children.values()) {
    if (hasTools(child)) out.push(renderNode(child, depth + 1));
  }
  return out.join("\n");
}

/** The global "Errors" section — the uniform envelope + the full code legend. */
function errorsSection(): string {
  const out: string[] = ["## Errors", ""];
  out.push(
    prose(
      "Every registry-backed tool resolves to an admin-API call that, on failure, returns the uniform error envelope below. The MCP server surfaces it to the client as a tool error.",
    ),
    "",
  );
  out.push("```json", '{ "error": "human-readable message", "code": "ERROR_CODE", "detail": "optional context" }', "```", "");
  if (COMMON_CODES.size) {
    const common = ALL_ERROR_CODES.filter((c) => COMMON_CODES.has(c));
    out.push(
      prose(
        `Every such tool can return these: ${common.map((c) => `\`${c}\``).join(", ")}. Each tool's own **Errors** note lists only the codes beyond this common set.`,
      ),
      "",
    );
  }
  out.push("All error codes:", "");
  out.push("| Code | Meaning |", "| --- | --- |");
  for (const c of ALL_ERROR_CODES) out.push(`| ${codeCell(c)} | ${cell(ERROR_MEANINGS[c] ?? "—")} |`);
  out.push("");
  out.push(
    prose(
      "Hand-written tools (`projects_upsert` and auth) layer the `.shipeasy` bind or the device-auth flow on top of the admin API rather than being plain spec calls, so they don't use this envelope. All filesystem / AST tooling (project detection, i18n source scanners / codemods / loader install) now lives in the `shipeasy` CLI, not this MCP server.",
    ),
    "",
  );
  return out.join("\n");
}

/** Page header — MDX frontmatter for the site, a plain heading for the repo. */
function header(mdx: boolean): string {
  if (mdx) {
    return `---
title: MCP reference
description: Auto-generated reference for the @shipeasy/mcp server — every tool, nested under its group, with title, full description, parameters, and error codes.
---

{/* DO NOT EDIT BY HAND. Generated by marketplace/mcp/scripts/gen-mcp-docs.ts. */}
{/* Regenerate: pnpm --filter @shipeasy/mcp docs */}

Every tool below is generated from the MCP server's own tool catalog (so it
matches what the server advertises), nested under its group the same way the
[CLI reference](/get-started/cli-reference) nests commands, and enriched from
the OpenAPI spec with each group's description plus every tool's title, full
description, and error codes.

New to the MCP server? Start with the [MCP guide](/get-started/mcp) for
installation and connecting your agent — this page is the exhaustive
tool-by-tool reference.
`;
  }
  return `# MCP reference

<!-- DO NOT EDIT BY HAND. Generated by scripts/gen-mcp-docs.ts (\`pnpm docs\`). -->

Every tool below is generated from the MCP server's own tool catalog (\`TOOLS\`),
so it matches what the server advertises, nested under its group the same way
the CLI reference nests commands, and enriched from the OpenAPI spec with each
group's description plus every tool's title, full description, and error codes.

New to the MCP server? Start with the [MCP guide](https://docs.shipeasy.ai/get-started/mcp)
for installation and connecting your agent — this page is the exhaustive
tool-by-tool reference.
`;
}

function main() {
  const filter = process.argv.slice(2);
  const groups = [...roots.values()].filter(
    (n) => hasTools(n) && (filter.length === 0 || filter.includes(n.slug)),
  );
  if (orphans.length) {
    console.warn(`WARNING: ${orphans.length} tool(s) not placed: ${orphans.map((t) => t.name).join(", ")}`);
  }
  const matched = TOOLS.filter((t) => specByTool.has(t.name)).length;
  const keys = groups.map((g) => g.slug).join(", ");

  const targets = [
    { out: LOCAL_OUT, mdx: false, requireRoot: false },
    { out: APPS_DOCS_OUT, mdx: true, requireRoot: true },
  ];

  for (const t of targets) {
    if (t.requireRoot && !existsSync(APPS_DOCS_ROOT)) {
      console.log(`Skipped ${t.out} (apps/docs not present — standalone build)`);
      continue;
    }
    MDX = t.mdx;
    const body = [errorsSection(), ...groups.map((g) => renderNode(g, 1))].join("\n");
    mkdirSync(dirname(t.out), { recursive: true });
    writeFileSync(t.out, `${header(t.mdx)}\n${body}`);
    console.log(
      `Wrote ${t.out}\n  ${TOOLS.length} tool(s) (${matched} enriched) across ${groups.length} group(s): ${keys}`,
    );
  }
}

main();
