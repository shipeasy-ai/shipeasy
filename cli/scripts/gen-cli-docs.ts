/**
 * Generate the CLI reference straight from the live Commander tree.
 *
 * The single source of truth is `buildProgram()` in ../src/index.ts — the same
 * definition that backs `--help`. Walking it here means the published docs can
 * never drift from the command names, arguments, options, defaults, or
 * descriptions that actually ship.
 *
 *   pnpm --filter @shipeasy/cli docs            # all top-level commands
 *   pnpm --filter @shipeasy/cli docs flags keys # only these
 *
 * Two outputs, generated together:
 *   • ../docs/cli-reference.md — this package's own reference (always written).
 *   • apps/docs/.../cli-reference.mdx — the published site page, written only
 *     when this package is checked out inside the monorepo (so a standalone
 *     marketplace build skips it instead of creating an orphan apps/ tree).
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Command, Option, Argument } from "commander";
import { buildProgram } from "../src/index";
import { getExamples, getOutput, getDetails } from "../src/util/examples";

// __dirname === marketplace/cli/scripts. The monorepo root is three levels up
// (cli → marketplace → root), so apps/docs resolves there when embedded.
const LOCAL_OUT = join(__dirname, "../docs/cli-reference.md");
const APPS_DOCS_ROOT = join(__dirname, "../../../apps/docs");
const APPS_DOCS_OUT = join(
  APPS_DOCS_ROOT,
  "content/docs/get-started/cli-reference.mdx",
);
// Machine-readable projection of the same tree. The docs site's <Cmd> component
// validates every command it renders against this at build time, so a prose
// mention of a command or flag that doesn't exist fails the build instead of
// shipping. Regenerated together with the reference so the two can't diverge.
const APPS_DOCS_MANIFEST = join(APPS_DOCS_ROOT, "src/lib/cli-commands.json");

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
/**
 * Inline-code a token for a TABLE cell. A `|` inside the token (e.g. the flag
 * `--metric <id|name>`) must be escaped even inside backticks, because the
 * markdown table tokenizer splits on `|` before it parses inline code.
 */
const codeCell = (s: string) => "`" + s.replace(/\|/g, "\\|") + "`";

/** Full invocation path, e.g. "shipeasy flags create". */
function path(cmd: Command): string {
  const parts: string[] = [];
  for (let c: Command | null = cmd; c; c = c.parent) parts.unshift(c.name());
  return parts.join(" ");
}

function defaultNote(d: unknown): string {
  if (d === undefined || d === false) return "";
  return ` (default: ${codeCell(JSON.stringify(d))})`;
}

function argsTable(args: readonly Argument[]): string {
  if (!args.length) return "";
  const rows = args.map((a) => {
    const name = a.variadic ? `${a.name()}...` : a.name();
    const req = a.required ? "required" : "optional";
    return `| ${codeCell(name)} | ${req} | ${cell(a.description || "—")}${defaultNote(a.defaultValue)} |`;
  });
  return ["| Argument | | Description |", "| --- | --- | --- |", ...rows].join("\n");
}

function optsTable(opts: readonly Option[]): string {
  const visible = opts.filter((o) => o.flags !== "-h, --help");
  if (!visible.length) return "";
  const rows = visible.map((o) => {
    const req = o.mandatory ? "required" : "optional";
    return `| ${codeCell(o.flags)} | ${req} | ${cell(o.description || "—")}${defaultNote(o.defaultValue)} |`;
  });
  return ["| Option | | Description |", "| --- | --- | --- |", ...rows].join("\n");
}

/**
 * Render one command and everything beneath it, recursing to ANY depth so deep
 * trees (`shipeasy release flags create`, `… killswitch switches set`, …) are
 * fully documented — not truncated at the first subgroup. Heading level tracks
 * tree depth (top-level commands at `##`, capped at `######`), and every node —
 * leaf or group — emits its full description, authored details, usage, args,
 * options, examples, and return shape so no help text is dropped.
 */
function renderCmd(cmd: Command, depth: number): string {
  const hashes = "#".repeat(Math.min(depth + 1, 6));
  const out: string[] = [`${hashes} \`${path(cmd)}\``, ""];

  if (cmd.description()) out.push(prose(cmd.description()), "");

  // Extra author prose (markdown, may link to deeper docs). Rendered raw — it's
  // authored MDX-safe content, not a CLI string.
  const details = getDetails(cmd);
  if (details) out.push(details, "");

  out.push("```bash", `${path(cmd)} ${cmd.usage()}`.trim(), "```", "");
  const a = argsTable(cmd.registeredArguments as readonly Argument[]);
  const o = optsTable(cmd.options);
  if (a) out.push(a, "");
  if (o) out.push(o, "");

  const examples = getExamples(cmd);
  if (examples.length) {
    const lines = examples.map((e) => (e.note ? `# ${e.note}\n${e.run}` : e.run));
    out.push("Examples:", "", "```bash", lines.join("\n\n"), "```", "");
  }

  const output = getOutput(cmd);
  if (output) {
    out.push(`Returns${output.note ? ` (${output.note})` : ""}:`, "");
    out.push("```json", JSON.stringify(output.json, null, 2), "```", "");
  }

  for (const sub of cmd.commands) out.push(renderCmd(sub, depth + 1));
  return out.join("\n");
}

/**
 * One manifest entry per command node. `options` holds the long flags only
 * (`--rollout-pct`), since that's what prose cites; short aliases are dropped
 * because they're ambiguous across commands. `aliases` are the alternate names
 * Commander accepts at that position (e.g. `ks` for `release killswitch`), so
 * the validator can resolve `shipeasy ks list` too.
 */
interface ManifestCmd {
  path: string;
  aliases: string[];
  args: { name: string; required: boolean; variadic: boolean }[];
  options: string[];
}

/** Long flag names declared on a command, e.g. `["--rollout-pct", "--rules"]`. */
function longFlags(cmd: Command): string[] {
  const flags = cmd.options
    .filter((o) => o.flags !== "-h, --help")
    .flatMap((o) => o.flags.split(/[ ,|]+/))
    .filter((t) => t.startsWith("--"));
  return [...new Set(flags)].sort();
}

function collectManifest(cmd: Command, out: ManifestCmd[]): ManifestCmd[] {
  out.push({
    path: path(cmd),
    aliases: cmd.aliases(),
    args: (cmd.registeredArguments as readonly Argument[]).map((a) => ({
      name: a.name(),
      required: a.required,
      variadic: a.variadic,
    })),
    options: longFlags(cmd),
  });
  for (const sub of cmd.commands) collectManifest(sub, out);
  return out;
}

/** Page header — MDX frontmatter for the site, a plain heading for the repo. */
function header(mdx: boolean): string {
  if (mdx) {
    return `---
title: CLI reference
description: Auto-generated reference for the \`shipeasy\` CLI — every command, argument, and flag, straight from the command definitions.
---

{/* DO NOT EDIT BY HAND. Generated by marketplace/cli/scripts/gen-cli-docs.ts. */}
{/* Regenerate: pnpm --filter @shipeasy/cli docs */}

Every command below is generated from the CLI's own command tree, so it always
matches the installed binary. Run any command with \`--help\` for the same
information in your terminal.

New to the CLI? Start with the [CLI guide](/get-started/cli) for installation,
auth, and worked examples — this page is the exhaustive flag-by-flag reference.
`;
  }
  return `# CLI reference

<!-- DO NOT EDIT BY HAND. Generated by scripts/gen-cli-docs.ts (\`pnpm docs\`). -->

Every command below is generated from the CLI's own command tree (\`buildProgram()\`),
so it always matches the installed binary. Run any command with \`--help\` for the
same information in your terminal.

New to the CLI? Start with the [CLI guide](https://docs.shipeasy.ai/get-started/cli)
for installation, auth, and worked examples — this page is the exhaustive
flag-by-flag reference.
`;
}

function main() {
  const filter = process.argv.slice(2);
  const program = buildProgram();
  const groups = program.commands.filter(
    (c) => filter.length === 0 || filter.includes(c.name()),
  );
  const names = groups.map((g) => g.name()).join(", ");

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
    const body = groups.map((g) => renderCmd(g, 1)).join("\n");
    mkdirSync(dirname(t.out), { recursive: true });
    writeFileSync(t.out, `${header(t.mdx)}\n${body}`);
    console.log(`Wrote ${t.out}\n  ${groups.length} command group(s): ${names}`);
  }

  // The manifest always describes the WHOLE tree, never the `filter` subset —
  // a partial run (`pnpm docs flags`) must not silently shrink what the docs
  // site considers a valid command.
  if (existsSync(APPS_DOCS_ROOT)) {
    const commands = buildProgram()
      .commands.flatMap((g) => collectManifest(g, []))
      .sort((a, b) => a.path.localeCompare(b.path));
    mkdirSync(dirname(APPS_DOCS_MANIFEST), { recursive: true });
    writeFileSync(
      APPS_DOCS_MANIFEST,
      `${JSON.stringify({ generator: "marketplace/cli/scripts/gen-cli-docs.ts", commands }, null, 2)}\n`,
    );
    console.log(`Wrote ${APPS_DOCS_MANIFEST}\n  ${commands.length} commands`);
  }
}

main();
