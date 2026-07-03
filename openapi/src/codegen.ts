import { defineConfig, type UserConfig } from "@hey-api/openapi-ts";

/**
 * Shared spec-first codegen config for every `openapi-ts.config.ts` in the
 * monorepo (this package + `@shipeasy/core`, `@shipeasy/devtools`, the
 * dashboard). One standard config, per-folder plugin customization.
 *
 * This is DEV-ONLY tooling loaded by openapi-ts's own TS loader (jiti). The
 * `./codegen` subpath deliberately points at this SOURCE file, not `dist/` —
 * so no consumer has to build `@shipeasy/openapi` before running `pnpm gen`,
 * and there is no build-order coupling. It is not shipped in the published
 * tarball (`files` omits `src/`); nothing published imports it.
 *
 * Consumers:
 *   import { makeConfig, zodCoercePlugin } from "@shipeasy/openapi/codegen";
 * This package's own config imports it relatively (`./src/codegen`).
 */

/**
 * `zod` `$resolvers.number` that emits `z.coerce.number()` instead of
 * `z.number()`/`z.int()` for schemas that back an `in: query` / `in: path`
 * **parameter** — HTTP delivers those as strings, so `z.coerce.number()`
 * handles `"50" → 50` transparently. Every other number (request/response
 * body fields, however deeply nested) keeps the default strict
 * `z.number()`/`z.int()` — coercion there is NOT a no-op: `z.coerce.number()`
 * calls `Number(value)`, so a JSON body field wrongly typed as a boolean or
 * string (`rolloutPct: false`) silently becomes `0` and sails through
 * `.int().gte(0)` instead of being rejected, which is what let the admin API
 * accept a schema-violating `PATCH .../gates/{id}` body (contract-tests
 * fuzzing caught it: `stack[].rolloutPct` accepted `false`).
 *
 * Distinguish the two by `ctx.path`: hey-api's IR ref path is
 * `["components", "parameters", <name>]` for a reusable parameter component
 * (e.g. `PaginationLimit`) and `["components", "schemas", ...]` for anything
 * reachable from a body/response schema — checked once at `path[1]`, so it
 * doesn't matter how deeply the number is nested inside the schema.
 */
export function coerceNumberResolver(ctx: any) {
  // Not a parameter schema (body/response field, however deeply nested):
  // returning nothing here falls through to hey-api's own default resolver,
  // i.e. strict `z.number()`/`z.int()` with no coercion.
  const isParameter = ctx.path?.["~ref"]?.[1] === "parameters";
  if (!isParameter) return undefined;
  // BigInt schemas (format int64 in some configs): keep default behavior.
  if (ctx.utils.shouldCoerceToBigInt(ctx.schema.format)) return ctx.nodes.base(ctx);
  // Const literal (e.g. type:integer, const:0): delegate to default.
  const constNode = ctx.nodes.const(ctx);
  if (constNode) return constNode;
  const z = ctx.plugin.imports.z;
  ctx.chain.current = ctx.$(z).attr("coerce").attr("number").call();
  if (ctx.schema.type === "integer") {
    ctx.chain.current = ctx.chain.current.attr("int").call();
  }
  const minNode = ctx.nodes.min(ctx);
  if (minNode) ctx.chain.current = minNode;
  const maxNode = ctx.nodes.max(ctx);
  if (maxNode) ctx.chain.current = maxNode;
  return ctx.chain.current;
}

/** The `zod` plugin wired with {@link coerceNumberResolver}. */
export const zodCoercePlugin = {
  name: "zod" as const,
  $resolvers: { number: coerceNumberResolver },
};

/** Default spec input: the bundled `openapi.yaml` symlinked in by pnpm. */
export const DEFAULT_INPUT = "./node_modules/@shipeasy/openapi/openapi.yaml";

export interface MakeConfigOptions {
  /** Output directory for the generated files. */
  output: string;
  /** Plugin list — the one axis each folder customizes. */
  plugins: UserConfig["plugins"];
  /** Spec input; defaults to {@link DEFAULT_INPUT}. This package overrides it. */
  input?: string;
}

/** Build a standard openapi-ts config; only `output`/`plugins` vary per folder. */
export function makeConfig({ output, plugins, input = DEFAULT_INPUT }: MakeConfigOptions) {
  return defineConfig({
    input,
    output: { path: output, clean: true },
    plugins,
  });
}
