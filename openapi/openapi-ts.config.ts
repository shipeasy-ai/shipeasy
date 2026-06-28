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
    "zod",
  ],
});
