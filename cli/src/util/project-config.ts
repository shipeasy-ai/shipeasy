/**
 * The `.shipeasy` project-binding file. The implementation is shared with
 * `@shipeasy/mcp` — it lives in `@shipeasy/openapi/node-context` (the node-only
 * fs subpath) so the two binaries can't drift. This file is a thin re-export
 * that preserves the CLI's historical names (notably `readProjectConfig` as the
 * SYNC read).
 *
 * See the shared module for the model: one `.shipeasy` per project, the holding
 * folder is the root, reads walk up to the nearest file, writes stay local.
 */
export {
  type ProjectConfig,
  FILENAME,
  SCHEMA_VERSION,
  findProjectConfigDir,
  readProjectConfigSync as readProjectConfig,
  writeProjectConfig,
  getBoundProjectId,
  getBoundSdk,
  getI18nClientKey,
  saveI18nClientKey,
  bindProject,
  mergeDetected,
} from "@shipeasy/openapi/node-context";
