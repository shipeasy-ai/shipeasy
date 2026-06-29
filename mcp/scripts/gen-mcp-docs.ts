/**
 * Generate the MCP reference from the tool catalog, enriched from the spec.
 *
 * The catalog (`TOOLS` in ../src/tools/schema.ts) is the source of truth for
 * WHICH tools exist — the exact array the server advertises via
 * `ListToolsRequestSchema`, so the docs can never list a tool the server lacks.
 * But the catalog deliberately carries only a short description + input schema.
 * For the full documentation — the human title, the complete (multi-paragraph)
 * description, and the per-operation error codes — we read `@shipeasy/openapi`'s
 * bundled `openapi.yaml` and match each registry-backed tool to its operation
 * (same name derivation as scripts/gen-tools.mjs). Hand-written tools (auth,
 * detect_project, projects_upsert, i18n fs/AST) have no spec op, so they fall
 * back to the catalog description and document no admin error envelope.
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
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parse as parseYaml } from "yaml";
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

// ── spec → per-tool metadata (title, full description, error codes) ───────────
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const spec: any = parseYaml(
  readFileSync(require.resolve("@shipeasy/openapi/openapi.yaml"), "utf8"),
);

const specSlug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// i18n's API parts + projects_upsert have richer hand-written tools — gen-tools
// skips/overrides them, so they have no generated tool and need no spec match.
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
function tagChainSlugs(name: string): string[] {
  const chain: string[] = [];
  let t = tagByName[name];
  while (t) {
    chain.unshift(specSlug(t.name));
    t = t.parent ? tagByName[t.parent] : undefined;
  }
  return chain;
}

// Build the tool-name → operation map exactly the way gen-tools.mjs names tools:
// tag-chain slugs + the x-cli verb, joined by `_`. Synthetic verbs (x-cli.commands)
// each get their own tool with their own summary but share the operation body.
for (const item of Object.values(spec.paths ?? {})) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pathItem = item as any;
  for (const method of METHODS) {
    const op = pathItem[method];
    if (!op || !op["x-cli"]) continue;
    const tag = op.tags?.[0];
    if (SKIP_TAGS.has(tag)) continue;
    const segs = tagChainSlugs(tag);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const verbs = op["x-cli"].commands ?? [{ name: op["x-cli"].name, summary: op.summary }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const v of verbs) {
      const name = [...segs, v.name].join("_").replace(/-/g, "_");
      if (OVERRIDDEN.has(name)) continue;
      specByTool.set(name, {
        title: String(v.summary || op.summary || "").split("\n")[0].trim(),
        description: String(op.description || op.summary || "").trim(),
        errorCodes: op["x-error-codes"] ?? [],
      });
    }
  }
}

// The ErrorCode catalogue (code → meaning) — the single source for every error
// the admin API can return. Per-op `x-error-codes` is a subset of these.
const errorCode = spec.components?.schemas?.ErrorCode ?? {};
const ERROR_MEANINGS: Record<string, string> = errorCode["x-enum-descriptions"] ?? {};
const ALL_ERROR_CODES: string[] = errorCode.enum ?? Object.keys(ERROR_MEANINGS);
// Codes every registry-backed tool can return (auth/shape failures) — surfaced
// once in the global section instead of repeated on all ~80 tools. Computed as
// the intersection of every matched op's error set.
const matchedErrorSets = [...specByTool.values()]
  .map((m) => m.errorCodes)
  .filter((c) => c.length);
const COMMON_CODES = new Set<string>(
  matchedErrorSets.length
    ? matchedErrorSets.reduce((acc, codes) =>
        acc.filter((c) => codes.includes(c)),
      )
    : [],
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
    const note = constraints(prop);
    const desc = (prop.description || "—") + (note ? ` _(${note})_` : "");
    out.push(
      `| ${codeCell(full)} | ${req} | ${codeCell(typeOf(prop))} | ${cell(desc)} |`,
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
  const meta = specByTool.get(tool.name);
  const out: string[] = ["### `" + tool.name + "`", ""];

  // Title (the operation summary) as a bold lead — but only for spec-backed
  // tools, where it's distinct from the body. Hand-written tools have no
  // separate title, so we skip straight to their description.
  if (meta?.title) out.push(`**${prose(meta.title)}**`, "");

  const description = meta?.description || tool.description || "";
  if (description) out.push(prose(description), "");

  out.push("#### Parameters", "", paramsTable(tool.inputSchema as JsonSchema), "");

  // Per-tool errors: only the codes BEYOND the common set (which is documented
  // once, globally). Hand-written tools have no spec op → no error section.
  if (meta) {
    const extra = meta.errorCodes.filter((c) => !COMMON_CODES.has(c));
    if (extra.length) {
      out.push("#### Errors", "");
      out.push("Beyond the [common errors](#errors), this tool can return:", "");
      for (const c of extra) {
        out.push(`- ${codeCell(c)} — ${cell(ERROR_MEANINGS[c] ?? "")}`.trimEnd());
      }
      out.push("");
    }
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
        `Every such tool can return these: ${common.map((c) => `\`${c}\``).join(", ")}. Each tool's own **Errors** section lists only the codes beyond this common set.`,
      ),
      "",
    );
  }
  out.push("All error codes:", "");
  out.push("| Code | Meaning |", "| --- | --- |");
  for (const c of ALL_ERROR_CODES) {
    out.push(`| ${codeCell(c)} | ${cell(ERROR_MEANINGS[c] ?? "—")} |`);
  }
  out.push("");
  out.push(
    prose(
      "Hand-written tools (`detect_project`, `projects_upsert`, the `i18n_*` scan/codemod/loader tools, and auth) operate on the local filesystem or the device-auth flow rather than the admin API, so they don't use this envelope.",
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
description: Auto-generated reference for the @shipeasy/mcp server — every tool, its title, full description, parameters, and error codes.
---

{/* DO NOT EDIT BY HAND. Generated by marketplace/mcp/scripts/gen-mcp-docs.ts. */}
{/* Regenerate: pnpm --filter @shipeasy/mcp docs */}

Every tool below is generated from the MCP server's own tool catalog (so it
matches what the server advertises) and enriched from the OpenAPI spec with the
operation title, full description, and the error codes it can return.

New to the MCP server? Start with the [MCP guide](/get-started/mcp) for
installation and connecting your agent — this page is the exhaustive
tool-by-tool reference.
`;
  }
  return `# MCP reference

<!-- DO NOT EDIT BY HAND. Generated by scripts/gen-mcp-docs.ts (\`pnpm docs\`). -->

Every tool below is generated from the MCP server's own tool catalog (\`TOOLS\`),
so it matches what the server advertises, and enriched from the OpenAPI spec
with the operation title, full description, and the error codes it can return.

New to the MCP server? Start with the [MCP guide](https://docs.shipeasy.ai/get-started/mcp)
for installation and connecting your agent — this page is the exhaustive
tool-by-tool reference.
`;
}

function main() {
  const filter = process.argv.slice(2);
  const groups = GROUPS.filter((g) => filter.length === 0 || filter.includes(g.key));
  const count = groups.reduce((n, g) => n + TOOLS.filter((t) => g.match(t.name)).length, 0);
  const matched = TOOLS.filter((t) => specByTool.has(t.name)).length;
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
    const toolDocs = groups
      .map((g) => {
        const tools = TOOLS.filter((tool) => g.match(tool.name));
        if (!tools.length) return "";
        return [`## ${g.title}`, "", prose(g.blurb), "", ...tools.map(toolBlock)].join("\n");
      })
      .filter(Boolean)
      .join("\n");
    const body = [errorsSection(), toolDocs].join("\n");

    mkdirSync(dirname(t.out), { recursive: true });
    writeFileSync(t.out, `${header(t.mdx)}\n${body}`);
    console.log(
      `Wrote ${t.out}\n  ${count} tool(s) (${matched} spec-enriched) across ${groups.length} group(s): ${keys}`,
    );
  }
}

main();
