/**
 * Generate an MCP reference MDX page straight from the tool catalog.
 *
 * The single source of truth is `TOOLS` in ../src/tools/schema.ts — the exact
 * array the server advertises via `ListToolsRequestSchema`. Rendering it here
 * means the published docs can never drift from the tool names, descriptions,
 * or input schemas that clients actually see.
 *
 *   pnpm --filter @shipeasy/mcp docs            # all tool groups
 *   pnpm --filter @shipeasy/mcp docs exp i18n   # only these prefixes
 *
 * Output: apps/docs/content/docs/get-started/mcp-reference.mdx
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TOOLS } from "../src/tools/schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(
  HERE,
  "../../../apps/docs/content/docs/get-started/mcp-reference.mdx",
);

/**
 * Group tools by name prefix. The catalog uses `exp_*`, `i18n_*`, `ops_*`
 * prefixes for the subsystem tools; everything else (auth, project binding,
 * resource lookups) is "shared". `order` fixes section ordering; `match`
 * decides membership, first match wins.
 */
const GROUPS: { key: string; title: string; blurb: string; match: (n: string) => boolean }[] = [
  {
    key: "shared",
    title: "Shared",
    blurb:
      "Project detection, binding, auth, the current project, and targeting attributes. Use these before any write tool — every write refuses to run until the cwd is bound to a project.",
    // Auth/detect/bind + `projects_*` + `attributes_*` — everything not owned by
    // a subsystem prefix below.
    match: (n) => !/^(exp|release|i18n|ops|metrics|events|docs)_/.test(n),
  },
  {
    key: "exp",
    title: "Flags & experiments",
    blurb:
      "Create and manage gates, dynamic configs, kill switches, universes, and experiments — all generated from the shared operation registry (@shipeasy/openapi).",
    match: (n) => n.startsWith("exp_") || n.startsWith("release_"),
  },
  {
    key: "metrics",
    title: "Metrics & events",
    blurb:
      "Define event-backed metrics (incl. the query-DSL grammar) and manage the event catalog. Registry-driven.",
    match: (n) => n.startsWith("metrics_") || n.startsWith("events_"),
  },
  {
    key: "i18n",
    title: "Translations",
    blurb:
      "Locale profiles, key push, code scanning/codemods, machine translation, and publishing.",
    match: (n) => n.startsWith("i18n_"),
  },
  {
    key: "ops",
    title: "Ops",
    blurb:
      "The unified operational queue (bugs, feature requests, error/alert tickets), alert rules, escalation notifications, and PR links. Registry-driven.",
    match: (n) => n.startsWith("ops_"),
  },
  {
    key: "docs",
    title: "SDK docs",
    blurb:
      "Fetch SDK documentation — feature pages, nested snippets, and installable skills — from each SDK's published GitHub Pages docs.",
    match: (n) => n.startsWith("docs_"),
  },
];

/**
 * Escape MDX-significant chars in author-written prose, but leave `inline code`
 * spans untouched (their `<…>`/`{…}` are already literal in MDX). In a table
 * cell, `|` must additionally be escaped everywhere — even inside code —
 * because the table tokenizer splits on `|` before parsing inline code.
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
const codeCell = (s: string) => "`" + s.replace(/\|/g, "\\|") + "`";

type JsonSchema = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
};

/**
 * Compact a JSON-Schema node into a single `type` token. Uses plain `|` for
 * unions — `codeCell` does the table-cell pipe escaping at render time, so
 * escaping here would double up to `\\|`.
 */
function typeOf(s: JsonSchema): string {
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  const base = Array.isArray(s.type) ? s.type.join(" | ") : (s.type ?? "any");
  if (base === "array" && s.items) return `${typeOf(s.items)}[]`;
  return base;
}

/**
 * Flatten an object schema into table rows. Nested object properties are
 * rendered one level deep with dotted names (e.g. `params.gate_id`), which is
 * as deep as any tool in the catalog goes.
 */
function rows(schema: JsonSchema, prefix = ""): string[] {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const out: string[] = [];
  for (const [name, prop] of Object.entries(props)) {
    const full = prefix ? `${prefix}.${name}` : name;
    const req = required.has(name) ? "required" : "optional";
    out.push(
      `| ${codeCell(full)} | ${req} | ${codeCell(typeOf(prop))} | ${cell(prop.description || "—")} |`,
    );
    if (prop.type === "object" && prop.properties) out.push(...rows(prop, full));
  }
  return out;
}

function paramsTable(schema: JsonSchema): string {
  const body = rows(schema);
  if (!body.length) return "_No parameters._";
  return [
    "| Parameter | | Type | Description |",
    "| --- | --- | --- | --- |",
    ...body,
  ].join("\n");
}

function toolBlock(tool: Tool): string {
  const out: string[] = ["### `" + tool.name + "`", ""];
  if (tool.description) out.push(prose(tool.description), "");
  out.push(paramsTable(tool.inputSchema as JsonSchema), "");
  return out.join("\n");
}

function main() {
  const filter = process.argv.slice(2);
  const groups = GROUPS.filter((g) => filter.length === 0 || filter.includes(g.key));

  const header = `---
title: MCP reference
description: Auto-generated reference for the @shipeasy/mcp server — every tool and its input schema, straight from the tool catalog.
---

{/* DO NOT EDIT BY HAND. Generated by packages/mcp/scripts/gen-mcp-docs.ts. */}
{/* Regenerate: pnpm --filter @shipeasy/mcp docs */}

Every tool below is generated from the MCP server's own tool catalog, so it
always matches what the server advertises to a connected client.

New to the MCP server? Start with the [MCP guide](/get-started/mcp) for
installation and connecting your agent — this page is the exhaustive
tool-by-tool reference.
`;

  const body = groups
    .map((g) => {
      const tools = TOOLS.filter((t) => g.match(t.name));
      if (!tools.length) return "";
      return [`## ${g.title}`, "", prose(g.blurb), "", ...tools.map(toolBlock)].join("\n");
    })
    .filter(Boolean)
    .join("\n");

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${header}\n${body}`);
  const count = groups.reduce((n, g) => n + TOOLS.filter((t) => g.match(t.name)).length, 0);
  console.log(
    `Wrote ${OUT}\n  ${count} tool(s) across ${groups.length} group(s): ${groups.map((g) => g.key).join(", ")}`,
  );
}

main();
