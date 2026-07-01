/**
 * The `.shipeasy` project-binding file. The implementation is shared with
 * `@shipeasy/cli` — it lives in `@shipeasy/openapi/node-context` (the node-only
 * fs subpath) so the two binaries can't drift. This file is a thin re-export
 * that preserves the MCP's historical names (the ASYNC `readProjectConfig`, the
 * `*Sync` variants).
 *
 * See the shared module for the model: one `.shipeasy` per project, the holding
 * folder is the root, reads walk up to the nearest file, writes stay local.
 */
export {
  type ProjectConfig,
  FILENAME,
  SCHEMA_VERSION,
  findProjectConfigDir,
  readProjectConfig,
  getBoundProjectIdSync,
  getBoundSdk,
  bindProjectSync,
  mergeDetected,
} from "@shipeasy/openapi/node-context";
