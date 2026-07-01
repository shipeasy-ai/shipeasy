import { defineConfig } from "@hey-api/openapi-ts";

/**
 * Spec-first codegen. `openapi.yaml` is the **bundled** artifact of the
 * hand-authored `spec/` tree (`pnpm bundle`), and is the single input here.
 * Three plugins, one generation:
 *   - `@hey-api/typescript`   → request/response types (`types.gen.ts`)
 *   - `zod`                   → structural validators (`zod.gen.ts`), the
 *                               server's structural-parse layer + client guards
 *   - `@hey-api/client-fetch` → a bundled fetch client (no runtime dependency)
 *
 * Output (`src/generated/`) is committed and re-exported from `src/index.ts`,
 * `src/client.ts` (`./client`) and `src/schemas.ts` (`./schemas`). Regenerate
 * with `pnpm gen` (bundle + this). Never hand-edit `src/generated`.
 */
export default defineConfig({
  input: "./openapi.yaml",
  output: { path: "./src/generated", clean: true },
  plugins: [
    "@hey-api/typescript",
    "@hey-api/client-fetch",
    "@hey-api/sdk",
    {
      name: "zod",
      // Emit z.coerce.number() instead of z.number()/z.int() globally.
      // This fixes query-string → number coercion at the generator level:
      // HTTP delivers query params as strings; z.coerce.number() handles "50" → 50
      // transparently. For JSON bodies the coercion is a no-op (already a number).
      // Trade-off: z.int() integer-type narrowing is lost, but for an admin API
      // where query params are the only string-sourced numbers this is acceptable.
      $resolvers: {
        number: (ctx: any) => {
          // BigInt schemas (format int64 in some configs): keep default behavior.
          if (ctx.utils.shouldCoerceToBigInt(ctx.schema.format)) return ctx.nodes.base(ctx);
          // Const literal (e.g. type:integer, const:0): delegate to default.
          const constNode = ctx.nodes.const(ctx);
          if (constNode) return constNode;
          // Replace z.number()/z.int() with z.coerce.number() so HTTP query-string
          // values ("50") coerce to numbers. For integers, chain .int() to preserve
          // the "no fractional values" constraint (z.coerce.number().int() accepts
          // "50" → 50 but rejects 1.5, same semantics as the old z.int()).
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
        },
      },
    },
  ],
});
