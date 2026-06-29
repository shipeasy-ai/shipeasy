/**
 * Generate the MCP reference straight from the tool catalog.
 *
 * The single source of truth is `TOOLS` in ../src/tools/schema.ts — the exact
 * array the server advertises via `ListToolsRequestSchema`. Rendering it here
 * means the published docs can never drift from the tool names, descriptions,
 * or input schemas that clients actually see.
 *
 *   pnpm --filter @shipeasy/mcp docs            # all tool groups
 *   pnpm --filter @shipeasy/mcp docs exp i18n   # only these prefixes
 *
 * Two outputs, generated together:
 *   • ../docs/mcp-reference.md — this package's own reference (always written).
 *   • apps/docs/.../mcp-reference.mdx — the published site page, written only
 *     when this package is checked out inside the monorepo (so a standalone
 *     marketplace build skips it instead of creating an orphan apps/ tree).
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
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

/** Page header — MDX frontmatter for the site, a plain heading for the repo. */
function header(mdx: boolean): string {
  if (mdx) {
    return `---
title: MCP reference
description: Auto-generated reference for the @shipeasy/mcp server — every tool and its input schema, straight from the tool catalog.
---

{/* DO NOT EDIT BY HAND. Generated by marketplace/mcp/scripts/gen-mcp-docs.ts. */}
{/* Regenerate: pnpm --filter @shipeasy/mcp docs */}

Every tool below is generated from the MCP server's own tool catalog, so it
always matches what the server advertises to a connected client.

New to the MCP server? Start with the [MCP guide](/get-started/mcp) for
installation and connecting your agent — this page is the exhaustive
tool-by-tool reference.
`;
  }
  return `# MCP reference

<!-- DO NOT EDIT BY HAND. Generated by scripts/gen-mcp-docs.ts (\`pnpm docs\`). -->

Every tool below is generated from the MCP server's own tool catalog (\`TOOLS\`),
so it always matches what the server advertises to a connected client.

New to the MCP server? Start with the [MCP guide](https://docs.shipeasy.ai/get-started/mcp)
for installation and connecting your agent — this page is the exhaustive
tool-by-tool reference.
`;
}

function main() {
  const filter = process.argv.slice(2);
  const groups = GROUPS.filter((g) => filter.length === 0 || filter.includes(g.key));
  const count = groups.reduce((n, g) => n + TOOLS.filter((t) => g.match(t.name)).length, 0);
  const keys = groups.map((g) => g.key).join(", ");

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
    const body = groups
      .map((g) => {
        const tools = TOOLS.filter((tool) => g.match(tool.name));
        if (!tools.length) return "";
        return [`## ${g.title}`, "", prose(g.blurb), "", ...tools.map(toolBlock)].join("\n");
      })
      .filter(Boolean)
      .join("\n");

    mkdirSync(dirname(t.out), { recursive: true });
    writeFileSync(t.out, `${header(t.mdx)}\n${body}`);
    console.log(`Wrote ${t.out}\n  ${count} tool(s) across ${groups.length} group(s): ${keys}`);
  }
}

main();
