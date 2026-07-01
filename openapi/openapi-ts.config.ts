import { makeConfig, zodCoercePlugin } from "./src/codegen";

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
 *
 * Shared shape (input default, `output.clean`, the zod coerce resolver) lives
 * in `./src/codegen` — the one standard config every folder builds on.
 */
export default makeConfig({
  input: "./openapi.yaml",
  output: "./src/generated",
  plugins: ["@hey-api/typescript", "@hey-api/client-fetch", "@hey-api/sdk", zodCoercePlugin],
});
