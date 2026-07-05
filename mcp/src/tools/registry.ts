import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  GENERATED_TOOLS,
  GENERATED_DISPATCH,
  GENERATED_MUTATES,
} from "../generated/tools.gen.js";
import { CUSTOM_TOOLS, CUSTOM_DISPATCH } from "./custom.js";
import { withListTokenParam } from "./list-guard.js";

// The list-before-create guard surface, re-exported so the remote worker (which
// can only import `@shipeasy/mcp/registry`, not deep paths) can enforce the same
// guard the stdio server does — see packages/mcp-worker/src/app.ts.
export {
  LIST_TOKEN_PARAM,
  guardedCreateFamily,
  verifyToken,
  listMintsToken,
  listFamily,
  mintListToken,
  listTokenBlock,
  listGuardError,
  setGuardSecret,
  parseGuardToggle,
} from "./list-guard.js";

/**
 * The full registry-driven MCP surface, projected from the spec — the MCP twin
 * of the CLI's generated command tree. Two layers:
 *
 *   1. **Generated tools** (`GENERATED_*`) — every admin-API endpoint with an
 *      `x-cli` annotation, named `<tag-chain>_<verb>` (e.g. `release_flags_create`,
 *      `ops_create`/`ops_bug`/`ops_feature`). These require auth; mutating ones
 *      (`GENERATED_MUTATES`) additionally require a `.shipeasy` binding.
 *   2. **Custom tools** (`CUSTOM_*`) — the shared non-endpoint sugar
 *      (`metrics_grammar`, `docs_*`). Auth-free (pure / outbound fetch).
 *
 * Hand-written tools that can't be projected from the spec — auth,
 * `projects_upsert` (fs bind), and the pure-API i18n write tools — live in
 * src/tools/ and are merged into the catalog by src/tools/schema.ts. (All
 * fs/AST tooling now lives in the `shipeasy` CLI, not here.)
 */
export { GENERATED_DISPATCH, GENERATED_MUTATES, CUSTOM_DISPATCH };

/**
 * The generated API tools + the shared custom (non-spec) tools. Guarded create
 * tools get an extra `listToken` input advertised (see ./list-guard.ts) so the
 * model knows to carry the token its sibling `*_list` handed out.
 */
export const REGISTRY_TOOLS: Tool[] = [...withListTokenParam(GENERATED_TOOLS), ...CUSTOM_TOOLS];
