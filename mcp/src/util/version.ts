import { createRequire } from "node:module";

/**
 * The installed package's own version — what `serverInfo.version`, the stdio
 * banner and `--version` report. Read from package.json at runtime so it can
 * never drift from the published version again (it was a hardcoded "0.1.0"
 * through 2.16.0). `../../package.json` resolves from both `src/util/` (tsx,
 * vitest) and `dist/util/` (the published build), and package.json ships in
 * every npm tarball.
 */
export const PACKAGE_VERSION: string = (
  createRequire(import.meta.url)("../../package.json") as { version: string }
).version;
