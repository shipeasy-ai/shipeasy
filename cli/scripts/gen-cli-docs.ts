/**
 * Generate a CLI reference MDX page straight from the live Commander tree.
 *
 * The single source of truth is `buildProgram()` in ../src/index.ts — the same
 * definition that backs `--help`. Walking it here means the published docs can
 * never drift from the command names, arguments, options, defaults, or
 * descriptions that actually ship.
 *
 *   pnpm --filter @shipeasy/cli docs            # all top-level commands
 *   pnpm --filter @shipeasy/cli docs flags keys # only these
 *
 * Output: apps/docs/content/docs/get-started/cli-reference.mdx
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Command, Option, Argument } from "commander";
import { buildProgram } from "../src/index";
import { getExamples, getOutput, getDetails } from "../src/util/examples";

const OUT = join(
  __dirname,
  "../../../apps/docs/content/docs/get-started/cli-reference.mdx",
);

/**
 * Escape prose for a markdown table cell. `|` breaks the table; `{`/`}` are
 * parsed as JS expressions by MDX and `<` starts a JSX tag — backslash-escape
 * them so descriptions like `Parameter schema {name: type}` render literally.
 * (Backtick-wrapped tokens from `code()` are exempt: MDX treats inline code as
 * literal, which is also why `<id>` is safe there.)
 */
/**
 * Escape MDX-significant chars in author-written prose, but leave `inline code`
 * spans untouched (their `<…>`/`{…}` are already literal in MDX). In a table
 * cell, `|` must additionally be escaped everywhere — even inside code — because
 * the table tokenizer splits on `|` before parsing inline code.
 */
function escapeProse(s: string, inTable: boolean): string {
  return s
    .split(/(`[^`]*`)/g)
    .map((part) => {
      const isCode = part.startsWith("`") && part.endsWith("`");
      const out = isCode ? part : part.replace(/([{}<])/g, "\\$1");
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

function main() {
  const filter = process.argv.slice(2);
  const program = buildProgram();
  const groups = program.commands.filter(
    (c) => filter.length === 0 || filter.includes(c.name()),
  );

  const header = `---
title: CLI reference
description: Auto-generated reference for the \`shipeasy\` CLI — every command, argument, and flag, straight from the command definitions.
---

{/* DO NOT EDIT BY HAND. Generated by packages/cli/scripts/gen-cli-docs.ts. */}
{/* Regenerate: pnpm --filter @shipeasy/cli docs */}

Every command below is generated from the CLI's own command tree, so it always
matches the installed binary. Run any command with \`--help\` for the same
information in your terminal.

New to the CLI? Start with the [CLI guide](/get-started/cli) for installation,
auth, and worked examples — this page is the exhaustive flag-by-flag reference.
`;

  const body = groups.map(renderGroup).join("\n");
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${header}\n${body}`);
  console.log(
    `Wrote ${OUT}\n  ${groups.length} command group(s): ${groups.map((g) => g.name()).join(", ")}`,
  );
}

main();
