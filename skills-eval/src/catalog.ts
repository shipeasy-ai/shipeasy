import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { KNOWN_TOOLS } from "./generated/tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The name we give the shipeasy MCP server in the harness `--mcp-config`.
 * Claude namespaces MCP tools as `mcp__<serverName>__<tool>`, so with this
 * server name a call to the `release_flags_create` tool appears in the
 * transcript as `mcp__shipeasy__release_flags_create`. (Inside a real Claude
 * session where the plugin ships the server, the prefix is instead
 * `mcp__plugin_shipeasy_shipeasy__…` — we control it here via the config.)
 */
export const MCP_SERVER_NAME = "shipeasy";

/**
 * The name we give the eval's shipeasy MCP server when driving the **copilot**
 * runner (`--additional-mcp-config`). Deliberately DISTINCT from `shipeasy` so
 * we can `--disable-mcp-server shipeasy` (killing any installed prod plugin
 * server of that name) without also disabling our local-backend one. Copilot
 * reports MCP calls with an explicit `mcpToolName`, so the parser keys off the
 * tool suffix, not the server name — this rename is invisible to the assertions.
 */
export const COPILOT_MCP_SERVER_NAME = "shipeasy_eval";

export function mcpToolName(suffix: string): string {
  return `mcp__${MCP_SERVER_NAME}__${suffix}`;
}

/** Absolute path to the shipped skill tree (…/marketplace/shipeasy/skills). */
export const SKILLS_DIR = resolve(__dirname, "../../shipeasy/skills");

/** Absolute path to this package's generated `cases/` directory. */
export const CASES_DIR = resolve(__dirname, "../cases");

/**
 * The real MCP tool suffixes (name minus the `mcp__<server>__` prefix). Used by
 * the seeder to keep only genuine tool identifiers when scraping a skill's
 * markdown, so prose like "the ops list" doesn't become a false expectation.
 *
 * GENERATED from `@shipeasy/mcp`'s `ALL_TOOLS` — never hand-edit it. Re-run
 * `pnpm --filter @shipeasy/skills-eval gen:catalog` after changing the MCP
 * surface; `catalog.test.ts` fails when the committed file and the live manifest
 * disagree in either direction.
 */
export { KNOWN_TOOLS };

export const KNOWN_TOOLS_SET: ReadonlySet<string> = new Set(KNOWN_TOOLS);
