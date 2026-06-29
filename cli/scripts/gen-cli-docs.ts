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

/** A leaf command (has an action / no subcommands) → one doc block. */
function leafBlock(cmd: Command): string {
  const out: string[] = ["### `" + path(cmd) + "`", ""];
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
  return out.join("\n");
}

/** Render a top-level command group and everything under it. */
function renderGroup(group: Command): string {
  const out: string[] = [`## ${group.name()}`, ""];
  if (group.description()) out.push(prose(group.description()), "");
  const subs = group.commands;
  if (!subs.length) {
    // group is itself a leaf (e.g. `login`)
    out.push(leafBlock(group));
  } else {
    for (const sub of subs) out.push(leafBlock(sub));
  }
  return out.join("\n");
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
    const body = groups.map(renderGroup).join("\n");
    mkdirSync(dirname(t.out), { recursive: true });
    writeFileSync(t.out, `${header(t.mdx)}\n${body}`);
    console.log(`Wrote ${t.out}\n  ${groups.length} command group(s): ${names}`);
  }
}

main();
