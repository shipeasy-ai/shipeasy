// Generate the MCP tool surface FROM the spec — the MCP twin of the CLI's
// scripts/gen-commands.mjs. Reads @shipeasy/openapi's bundled openapi.yaml and
// emits src/generated/tools.gen.ts:
//   • tool name      ← tag `parent` chain slugs + the x-cli verb, joined by `_`
//                      (Flags<Release + create → `release_flags_create`)
//   • description    ← operation summary + the first paragraph of its description
//   • inputSchema    ← path params + query params + request-body properties
//                      (JSON Schema, with enums/constraints carried through)
//   • synthetic verbs← x-cli.commands[] with a `preset` body (start/stop/restore,
//                      ops create/bug/feature) → one tool each over one endpoint
//   • dispatch       ← calls the generated sdk fn (operationId) via
//                      @shipeasy/openapi/client and unwraps the hey-api result
//
// Run via `pnpm gen:tools` (after @shipeasy/openapi's `pnpm gen`). Never
// hand-edit the output. Hand-written tools (auth/detect/projects_upsert/i18n)
// live in src/tools/ and are merged in src/tools/schema.ts + src/server.ts.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const require = createRequire(import.meta.url);
const specPath = require.resolve("@shipeasy/openapi/openapi.yaml");
const spec = parseYaml(readFileSync(specPath, "utf8"));
const OUT = fileURLToPath(new URL("../src/generated/tools.gen.ts", import.meta.url));

// ── helpers ─────────────────────────────────────────────────────────────────
const resolveRef = (ref) => ref.replace(/^#\//, "").split("/").reduce((o, k) => o?.[k], spec);
const deref = (o) => (o && o.$ref ? resolveRef(o.$ref) : o);

// Request-body → tool input properties. A plain object body → its properties.
// A oneOf/anyOf of object variants (e.g. ops' `type`-discriminated create, or
// metrics' `query` XOR `query_ir`) → the union of every variant's properties,
// where a field is `required` only when required in EVERY variant (so the
// discriminator becomes a required input and the mutually-exclusive fields
// optional ones). This holds for discriminated and undiscriminated unions alike;
// only a non-object body (or one whose variants aren't all objects) stays opaque
// → null → a single `body` object input.
function bodyPropsOf(bodySchema) {
  if (!bodySchema) return null;
  if (bodySchema.type === "object" && bodySchema.properties)
    return Object.entries(bodySchema.properties).map(([name, s]) => ({ name, schema: deref(s), required: (bodySchema.required ?? []).includes(name) }));
  const union = bodySchema.oneOf ?? bodySchema.anyOf;
  if (!union) return null;
  const variants = union.map(deref);
  if (!variants.every((v) => v?.type === "object" && v.properties)) return null;
  const merged = new Map(); // name → { schema, reqCount }
  for (const v of variants)
    for (const [name, s] of Object.entries(v.properties)) {
      const e = merged.get(name) ?? { schema: deref(s), reqCount: 0 };
      if ((v.required ?? []).includes(name)) e.reqCount++;
      merged.set(name, e);
    }
  return [...merged.entries()].map(([name, e]) => ({ name, schema: e.schema, required: e.reqCount === variants.length }));
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const firstLine = (s) => (s ? String(s).split("\n")[0].trim() : "");
const q = (s) => JSON.stringify(s ?? "");

// first paragraph of a long markdown description, collapsed + capped — gives the
// LLM a meaningful tool description without dumping the whole use-case block.
const para = (s) => {
  if (!s) return "";
  const first = String(s).split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  return first.length > 280 ? first.slice(0, 277) + "…" : first;
};
const toolDesc = (verbSummary, op) => {
  const base = firstLine(verbSummary || op.summary);
  const body = para(op.description);
  return body && body !== base ? `${base}. ${body}` : base;
};

// Strip vendor extensions / examples and resolve any stray $ref so the property
// schema is a clean JSON Schema for `inputSchema`. (Component schemas are already
// flattened — zero intra-schema $refs — so a shallow deref per node suffices.)
function cleanSchema(s) {
  s = deref(s);
  if (s == null || typeof s !== "object") return s;
  if (Array.isArray(s)) return s.map(cleanSchema);
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "x-cli" || k === "example" || k === "examples") continue;
    out[k] = v && typeof v === "object" ? cleanSchema(v) : v;
  }
  return out;
}
const withDesc = (schema, desc) => (desc && !schema.description ? { ...schema, description: desc } : schema);

// ── tag tree → tool-name prefix ──────────────────────────────────────────────
const tagByName = Object.fromEntries(spec.tags.map((t) => [t.name, t]));
function tagChain(name) {
  const chain = [];
  let t = tagByName[name];
  while (t) {
    chain.unshift(t);
    t = t.parent ? tagByName[t.parent] : undefined;
  }
  return chain;
}

// ── collect operations ───────────────────────────────────────────────────────
// i18n's API parts (profiles/keys/drafts) are now PROJECTED from the spec like
// every other resource — only the fs/AST i18n tools (scan/codemod/loader/…)
// stay hand-written in the fs-having consumers, and those carry no spec op.
//
// API Keys / Connectors / Errors are documented in the spec (API reference +
// contract tests) but NOT projected to the CLI/MCP surface — they carry `x-cli`
// only for the doc pipeline. Same for `searchResources` (tagged Projects, so
// skipped by id, not tag). Kept in sync with the CLI generator's skip lists.
const SKIP_TAGS = new Set([
  "API Keys",
  "Connectors",
  "Errors",
]);
const SKIP_OPS = new Set(["searchResources"]);
// Tools that have a richer hand-written version in src/tools/ which the
// generated one must NOT shadow. `projects_upsert` layers a `.shipeasy` fs bind
// on top of the shared upsert call, so MCP keeps the hand-written tool.
const OVERRIDDEN = new Set(["projects_upsert"]);
const METHODS = ["get", "post", "put", "patch", "delete"];

const tools = []; // { name, mutates, description, inputSchema, dispatch }

for (const [, item] of Object.entries(spec.paths)) {
  const pathItem = deref(item);
  for (const method of METHODS) {
    const op = pathItem[method];
    if (!op || !op["x-cli"]) continue;
    if (SKIP_OPS.has(op.operationId)) continue;
    const xcli = op["x-cli"];
    const tag = op.tags?.[0];
    if (SKIP_TAGS.has(tag)) continue;
    const segs = tagChain(tag).map((t) => slug(t.name));

    const allParams = [...(pathItem.parameters ?? []), ...(op.parameters ?? [])].map(deref);
    const pathParams = allParams.filter((p) => p.in === "path");
    const queryParams = allParams.filter((p) => p.in === "query");
    const bodySchema = deref(op.requestBody?.content?.["application/json"]?.schema);
    const bodyRequired = op.requestBody?.required === true;
    const bodyProps = bodyPropsOf(bodySchema); // null → opaque body: expose a single `body` object

    const verbs = xcli.commands ?? [{ name: xcli.name, summary: op.summary, preset: {} }];

    for (const v of verbs) {
      const preset = v.preset ?? {};
      const presetKeys = new Set(Object.keys(preset));
      // Nested verb names ("create claude") become underscore segments; when the
      // preset pins the body union's discriminator, scope the schema to that
      // variant instead of the merged union.
      const nameParts = String(v.name).trim().split(/\s+/);
      const disc = bodySchema?.discriminator;
      const variantRef = disc && preset[disc.propertyName] && disc.mapping?.[preset[disc.propertyName]];
      const verbBodyProps = variantRef ? bodyPropsOf(deref({ $ref: variantRef })) : bodyProps;
      const name = [...segs, ...nameParts].join("_").replace(/-/g, "_");
      if (OVERRIDDEN.has(name)) continue;
      const mutates = !op.operationId.startsWith("list") && !op.operationId.startsWith("get");

      // ── inputSchema ──
      const properties = {};
      const required = [];
      for (const pp of pathParams) {
        properties[pp.name] = withDesc(cleanSchema(pp.schema), pp.description);
        required.push(pp.name);
      }
      for (const qp of queryParams) {
        properties[qp.name] = withDesc(cleanSchema(qp.schema), qp.description);
        if (qp.required) required.push(qp.name);
      }
      if (verbBodyProps) {
        for (const bp of verbBodyProps) {
          if (presetKeys.has(bp.name)) continue;
          if (bp.schema?.["x-cli"]?.hidden) continue;
          properties[bp.name] = cleanSchema(bp.schema);
          if (bp.required) required.push(bp.name);
        }
      } else if (bodySchema) {
        properties.body = withDesc(cleanSchema(bodySchema), "Request body.");
        if (bodyRequired) required.push("body");
      }

      // ── dispatch call ──
      const callParts = ["client"];
      if (pathParams.length)
        callParts.push(`path: { ${pathParams.map((p) => `${q(p.name)}: args[${q(p.name)}] as string`).join(", ")} }`);
      if (queryParams.length)
        callParts.push(`query: clean({ ${queryParams.map((p) => `${q(p.name)}: args[${q(p.name)}]`).join(", ")} })`);
      if (!verbBodyProps && bodySchema) {
        callParts.push(`body: args["body"] as never`);
      } else if (verbBodyProps) {
        const fields = [
          ...verbBodyProps.filter((bp) => !presetKeys.has(bp.name) && !bp.schema?.["x-cli"]?.hidden).map((bp) => `${q(bp.name)}: args[${q(bp.name)}]`),
          ...Object.entries(preset).map(([k, val]) => `${q(k)}: ${q(val)}`),
        ];
        if (fields.length) callParts.push(`body: clean({ ${fields.join(", ")} })`);
      }
      const call = `api.${op.operationId}({ ${callParts.join(", ")} }).then(unwrap)`;

      const tool = {
        name,
        mutates,
        description: toolDesc(v.summary, op),
        inputSchema: { type: "object", properties, required },
        call,
      };
      tools.push(tool);

      // Optional top-level alias (e.g. `whoami` for `getCurrentProject`): an
      // extra tool with the same schema/dispatch under a flat name. Single-verb
      // ops only — synthetic-verb ops never carry one.
      if (xcli.topLevelAlias && !xcli.commands && !OVERRIDDEN.has(xcli.topLevelAlias)) {
        tools.push({ ...tool, name: xcli.topLevelAlias });
      }
    }
  }
}

tools.sort((a, b) => a.name.localeCompare(b.name));

// ── emit ──────────────────────────────────────────────────────────────────────
const lines = [];
lines.push("// AUTO-GENERATED from @shipeasy/openapi by scripts/gen-tools.mjs — DO NOT EDIT.");
lines.push("// The full MCP tool surface, projected from the spec's tags + x-cli, calling the");
lines.push("// generated sdk fns. Regenerate with `pnpm gen:tools`.");
lines.push('import type { Tool } from "@modelcontextprotocol/sdk/types.js";');
lines.push('import type { Client } from "@shipeasy/openapi/client";');
lines.push('import * as api from "@shipeasy/openapi/client";');
lines.push('import { clean, unwrap } from "../tools/_gen-runtime.js";');
lines.push("");
lines.push("export const GENERATED_TOOLS: Tool[] = [");
for (const t of tools) {
  lines.push(`  {`);
  lines.push(`    name: ${q(t.name)},`);
  lines.push(`    description: ${q(t.description)},`);
  lines.push(`    inputSchema: ${JSON.stringify(t.inputSchema)},`);
  lines.push(`  },`);
}
lines.push("];");
lines.push("");
lines.push("/** tool name → whether it mutates (drives the server's binding guard). */");
lines.push("export const GENERATED_MUTATES: Record<string, boolean> = {");
for (const t of tools) lines.push(`  ${q(t.name)}: ${t.mutates},`);
lines.push("};");
lines.push("");
lines.push("/** tool name → (client, args) → unwrapped sdk result. */");
lines.push("export const GENERATED_DISPATCH: Record<string, (client: Client, args: Record<string, unknown>) => Promise<unknown>> = {");
for (const t of tools) {
  lines.push(`  ${q(t.name)}: (client, args) => ${t.call} as Promise<unknown>,`);
}
lines.push("};");
lines.push("");

mkdirSync(fileURLToPath(new URL("../src/generated", import.meta.url)), { recursive: true });
writeFileSync(OUT, lines.join("\n"));
console.log(`generated ${tools.length} MCP tools → src/generated/tools.gen.ts`);
