// Generate the CLI command tree FROM the spec. Reads @shipeasy/openapi's bundled
// openapi.yaml and emits src/generated/commands.gen.ts — the full commander tree:
//   • structure  ← the tag `parent` chain (Flags<Release → `release flags`)
//   • group help ← the tag `description`; group aliases ← tag x-cli.aliases
//   • verb(s)    ← operation x-cli.name (or x-cli.commands[] for synthetic verbs)
//   • args       ← x-cli.positional (path or body fields) → positional arguments
//   • flags      ← remaining body properties + query params (alias ← property x-cli.alias)
//   • action     ← calls the generated sdk fn (operationId) via @shipeasy/openapi/client
//
// Run via `pnpm gen:cli`. Never hand-edit the output. Custom/fs commands live
// hand-written in src/commands/ and are merged in src/index.ts.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const require = createRequire(import.meta.url);
const specPath = require.resolve("@shipeasy/openapi/openapi.yaml");
const spec = parseYaml(readFileSync(specPath, "utf8"));
const OUT = fileURLToPath(new URL("../src/generated/commands.gen.ts", import.meta.url));

// ── helpers ─────────────────────────────────────────────────────────────────
const resolveRef = (ref) => ref.replace(/^#\//, "").split("/").reduce((o, k) => o?.[k], spec);
const deref = (o) => (o && o.$ref ? resolveRef(o.$ref) : o);

// Request-body → flag-able properties. A plain object body → its properties.
// A oneOf/anyOf of object variants (e.g. ops' `type`-discriminated create, or
// metrics' `query` XOR `query_ir`) → the union of every variant's properties,
// where a field is `required` only when required in EVERY variant (so the
// discriminator surfaces as a required flag and the mutually-exclusive fields as
// optional ones). This holds for discriminated and undiscriminated unions alike;
// only a non-object body (or one whose variants aren't all objects) stays opaque
// → null → a single `--data <json>` flag.
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
const kebab = (s) => s.replace(/_/g, "-").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const camel = (s) => s.replace(/[-_]([a-z0-9])/g, (_, c) => c.toUpperCase());
const firstLine = (s) => (s ? String(s).split("\n")[0].trim() : "");
const q = (s) => JSON.stringify(s ?? "");

// ── tag tree → command path ─────────────────────────────────────────────────
const tagByName = Object.fromEntries(spec.tags.map((t) => [t.name, t]));
function tagChain(name) {
  const chain = [];
  let t = tagByName[name];
  while (t) {
    chain.unshift(t);
    t = t.parent ? tagByName[t.parent] : undefined;
  }
  return chain; // [root … leaf]
}

// param type → coercion helper name
const coercer = (schema) => {
  let s = deref(schema) ?? {};
  // unwrap a nullable union ([{type:X},{type:null}]) to its single real branch
  const union = s.anyOf || s.oneOf;
  if (union) {
    const real = union.map(deref).filter((b) => (Array.isArray(b.type) ? !b.type.includes("null") : b.type !== "null"));
    if (real.length === 1) s = real[0];
    else return "json";
  }
  if (s.allOf) return "json";
  const t = Array.isArray(s.type) ? s.type.find((x) => x !== "null") : s.type;
  if (t === "integer" || t === "number") return "num";
  if (t === "boolean") return "bool";
  if (t === "array" || t === "object") return "json";
  return "str";
};

// short one-liner from a long tag description (collapse, take first sentence)
const sentence = (s) => {
  if (!s) return "";
  const flat = String(s).replace(/\s+/g, " ").trim();
  const m = flat.match(/^(.*?[.])(\s|$)/);
  return m ? m[1] : flat.length > 100 ? flat.slice(0, 97) + "…" : flat;
};

// ── collect operations grouped by command path ──────────────────────────────
// i18n is the fs/AST-heavy module — its API parts (profiles/keys/drafts) stay
// hand-written in src/commands/i18n.ts alongside scan/codemod/loader, so skip
// them here to avoid clobbering the custom command tree.
//
// API Keys / Connectors / Errors are documented in the spec (for the published
// API reference + contract tests) but are NOT projected to the CLI/MCP surface
// — they carry `x-cli` only for the doc pipeline. Same for the `searchResources`
// op (tagged Projects, so skipped by id, not tag).
const SKIP_TAGS = new Set([
  "i18n",
  "Profiles",
  "Keys",
  "Drafts",
  "API Keys",
  "Connectors",
  "Errors",
]);
const SKIP_OPS = new Set(["searchResources"]);

const METHODS = ["get", "post", "put", "patch", "delete"];
const groups = new Map(); // pathKey "release/flags" → { segs, tag, commands: [] }
const groupKey = (segs) => segs.join("/");

function ensureGroup(segs, tag) {
  const key = groupKey(segs);
  if (!groups.has(key)) groups.set(key, { segs, tag, commands: [] });
  return groups.get(key);
}

for (const [path, item] of Object.entries(spec.paths)) {
  const pathItem = deref(item);
  for (const method of METHODS) {
    const op = pathItem[method];
    if (!op || !op["x-cli"]) continue;
    if (SKIP_OPS.has(op.operationId)) continue;
    const xcli = op["x-cli"];
    const tag = op.tags?.[0];
    if (SKIP_TAGS.has(tag)) continue;
    const chain = tagChain(tag);
    const segs = chain.map((t) => slug(t.name));
    const grp = ensureGroup(segs, chain[chain.length - 1]);

    // gather params: path + query (deref), and request body properties
    const allParams = [...(pathItem.parameters ?? []), ...(op.parameters ?? [])].map(deref);
    const pathParams = allParams.filter((p) => p.in === "path");
    const queryParams = allParams.filter((p) => p.in === "query");
    const bodySchema = deref(op.requestBody?.content?.["application/json"]?.schema);
    const bodyProps = bodyPropsOf(bodySchema); // null → opaque body: expose --data <json>

    const positional = xcli.positional ?? [];
    // synthetic verbs share one endpoint; default to single command
    const verbs = xcli.commands ?? [{ name: xcli.name, summary: op.summary, preset: {} }];

    for (const v of verbs) {
      grp.commands.push({
        verb: v.name,
        summary: firstLine(v.summary || op.summary),
        description: firstLine(op.description),
        operationId: op.operationId,
        positional,
        pathParams,
        queryParams,
        bodyProps,
        preset: v.preset ?? {},
        // Optional top-level alias (e.g. `whoami` for `projects current`). Only
        // for single-verb ops — synthetic-verb ops never carry one.
        topLevelAlias: xcli.commands ? undefined : xcli.topLevelAlias,
      });
    }
  }
}

// ── emit ─────────────────────────────────────────────────────────────────────
const lines = [];
lines.push("// AUTO-GENERATED from @shipeasy/openapi by scripts/gen-commands.mjs — DO NOT EDIT.");
lines.push("// The full CLI command tree, projected from the spec's tags + x-cli, calling");
lines.push("// the generated sdk fns. Regenerate with `pnpm gen:cli`.");
lines.push('import type { Command } from "commander";');
lines.push('import * as api from "@shipeasy/openapi/client";');
lines.push('import { type GenCtx, defineGroup, num, bool, str, json, clean } from "../commands/_gen-runtime.js";');
lines.push("");
lines.push("export function registerGeneratedCommands(program: Command, ctx: GenCtx): void {");

// group declarations (parents before children)
// Sanitise to a valid JS identifier — slugs can contain `-` (e.g. `api-keys`),
// which is legal in a command name but not in the `const g_…` variable name.
const groupVar = (segs) => "g_" + segs.join("_").replace(/[^a-zA-Z0-9_]/g, "_");
const sortedGroups = [...groups.values()].sort((a, b) => a.segs.length - b.segs.length || groupKey(a.segs).localeCompare(groupKey(b.segs)));
const declared = new Set();
for (const grp of sortedGroups) {
  // ensure every ancestor group is declared
  for (let i = 1; i <= grp.segs.length; i++) {
    const segs = grp.segs.slice(0, i);
    const key = groupKey(segs);
    if (declared.has(key)) continue;
    declared.add(key);
    const parent = i === 1 ? "program" : groupVar(segs.slice(0, i - 1));
    // the tag whose slug matches this path segment supplies help text + aliases
    const tg = spec.tags.find((t) => slug(t.name) === segs[i - 1]);
    const summary = firstLine(tg?.summary) || sentence(tg?.description) || `${segs[i - 1]} commands`;
    const help = (tg?.description ?? "").trim(); // full description → shown on the group's own --help
    const aliases = tg?.["x-cli"]?.aliases ?? [];
    lines.push(`  const ${groupVar(segs)} = defineGroup(${parent}, ${q(segs[i - 1])}, { summary: ${q(summary)}, help: ${q(help)}, aliases: ${JSON.stringify(aliases)} });`);
  }
}
lines.push("");

// command declarations
for (const grp of sortedGroups) {
  for (const cmd of grp.commands) {
    const gv = groupVar(grp.segs);
    const mutates = !cmd.operationId.startsWith("list") && !cmd.operationId.startsWith("get") ? "true" : "false";
    // positional args (in declared order); resolve source path vs body
    const posInfo = cmd.positional.map((name) => {
      const pp = cmd.pathParams.find((p) => p.name === name);
      const isPath = !!pp;
      const bp = cmd.bodyProps?.find((p) => p.name === name);
      const desc = isPath ? pp.description || deref(pp.schema)?.description : deref(bp?.schema)?.description;
      return { name, src: isPath ? "path" : "body", desc: firstLine(desc) };
    });
    const presetKeys = new Set(Object.keys(cmd.preset));
    const positionalSet = new Set(cmd.positional);

    // option flags: query params + body props not positional/preset/hidden
    const opts = [];
    for (const qp of cmd.queryParams) {
      opts.push({ field: qp.name, loc: "query", flag: kebab(qp.name), key: camel(qp.name), coerce: coercer(qp.schema), desc: firstLine(qp.schema?.description || qp.description) });
    }
    if (cmd.bodyProps) {
      for (const bp of cmd.bodyProps) {
        if (positionalSet.has(bp.name) || presetKeys.has(bp.name)) continue;
        if (bp.schema?.["x-cli"]?.hidden) continue;
        const alias = bp.schema?.["x-cli"]?.alias;
        opts.push({ field: bp.name, loc: "body", flag: kebab(alias || bp.name), key: camel(alias || bp.name), coerce: coercer(bp.schema), desc: firstLine(bp.schema?.description) });
      }
    } else {
      // opaque body → single --data <json>
      opts.push({ field: "__rawBody", loc: "rawbody", flag: "data", key: "data", coerce: "json", desc: "Request body as a JSON object." });
    }

    // build the command
    const actionArgs = [...posInfo.map((p) => camel(p.name)), "opts"].join(", ");
    const callParts = [];
    // path object
    const pathPos = posInfo.filter((p) => p.src === "path");
    if (pathPos.length) callParts.push(`path: { ${pathPos.map((p) => `${q(p.name).replace(/"/g, "")}: ${camel(p.name)}`).join(", ")} }`);
    // query object
    const qOpts = opts.filter((o) => o.loc === "query");
    if (qOpts.length) callParts.push(`query: clean({ ${qOpts.map((o) => `${o.field}: ${o.coerce}(opts.${o.key})`).join(", ")} })`);
    // body object
    const bodyPos = posInfo.filter((p) => p.src === "body");
    const bOpts = opts.filter((o) => o.loc === "body");
    const rawBody = opts.find((o) => o.loc === "rawbody");
    if (rawBody) {
      callParts.push(`body: json(opts.data) as never`);
    } else if (bodyPos.length || bOpts.length || presetKeys.size) {
      const bodyFields = [
        ...bodyPos.map((p) => `${p.name}: ${camel(p.name)}`),
        ...bOpts.map((o) => `${o.field}: ${o.coerce}(opts.${o.key})`),
        ...Object.entries(cmd.preset).map(([k, v]) => `${k}: ${q(v)}`),
      ];
      callParts.push(`body: clean({ ${bodyFields.join(", ")} })`);
    }
    const call = `api.${cmd.operationId}({ client${callParts.length ? ", " + callParts.join(", ") : ""} })`;

    // Emit one `.command()` on the given parent. Called for the normal command
    // under its group, and again on `program` for an optional top-level alias.
    const emit = (parentVar, name) => {
      lines.push(`  ${parentVar}.command(${q(name)})`);
      if (cmd.summary) lines.push(`    .description(${q(cmd.summary)})`);
      for (const p of posInfo) lines.push(`    .argument(${q("<" + p.name + ">")}, ${q(p.desc)})`);
      for (const o of opts) lines.push(`    .option(${q("--" + o.flag + " <value>")}, ${q(o.desc)})`);
      lines.push(`    .action(async (${actionArgs}) => {`);
      lines.push(`      await ctx.run({ mutates: ${mutates}, invoke: (client) => ${call} });`);
      lines.push(`    });`);
    };
    emit(gv, cmd.verb);
    if (cmd.topLevelAlias) emit("program", cmd.topLevelAlias);
  }
}

lines.push("}");
lines.push("");

mkdirSync(fileURLToPath(new URL("../src/generated", import.meta.url)), { recursive: true });
writeFileSync(OUT, lines.join("\n"));
const cmdCount = [...groups.values()].reduce((n, g) => n + g.commands.length, 0);
console.log(`generated ${cmdCount} commands in ${groups.size} groups → src/generated/commands.gen.ts`);
