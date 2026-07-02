import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

export function mcpToolName(suffix: string): string {
  return `mcp__${MCP_SERVER_NAME}__${suffix}`;
}

/** Absolute path to the shipped skill tree (…/marketplace/shipeasy/skills). */
export const SKILLS_DIR = resolve(__dirname, "../../shipeasy/skills");

/** Absolute path to this package's generated `cases/` directory. */
export const CASES_DIR = resolve(__dirname, "../cases");

/**
 * The real MCP tool suffixes (name minus the `mcp__<server>__` prefix). Used
 * by the seeder to keep only genuine tool identifiers when scraping a skill's
 * markdown, so prose like "the ops list" doesn't become a false expectation.
 *
 * SOURCE OF TRUTH is `@shipeasy/mcp`'s `REGISTRY_TOOLS` — this list is a
 * committed snapshot so the seeder has no build-time dependency on the MCP
 * package. If tools are added/renamed, re-sync from `marketplace/mcp`
 * (`src/tools/registry.ts` → the generated + custom tool names).
 */
export const KNOWN_TOOLS: readonly string[] = [
  // release / flags
  "release_flags_create", "release_flags_list", "release_flags_update",
  "release_flags_enable", "release_flags_disable", "release_flags_rollout",
  "release_flags_archive",
  // release / configs
  "release_configs_create", "release_configs_list", "release_configs_get",
  "release_configs_update", "release_configs_draft", "release_configs_publish",
  "release_configs_archive",
  // release / killswitch
  "release_killswitch_create", "release_killswitch_list", "release_killswitch_set",
  "release_killswitch_unset", "release_killswitch_update", "release_killswitch_archive",
  // release / experiments (+ universes)
  "release_experiments_create", "release_experiments_list", "release_experiments_update",
  "release_experiments_start", "release_experiments_stop", "release_experiments_status",
  "release_experiments_reanalyze", "release_experiments_restore", "release_experiments_archive",
  "release_experiments_universes_create", "release_experiments_universes_list",
  "release_experiments_universes_update", "release_experiments_universes_archive",
  // metrics
  "metrics_create", "metrics_list", "metrics_show", "metrics_grammar", "metrics_archive",
  // events
  "events_create", "events_list", "events_get", "events_update", "events_approve", "events_archive",
  // ops (unified queue + alerts)
  "ops_create", "ops_get", "ops_list", "ops_update", "ops_notify", "ops_link-pr",
  "ops_alerts_create", "ops_alerts_list", "ops_alerts_update", "ops_alerts_archive",
  "ops_alerts_channels",
  // projects / attributes / docs
  "projects_current", "projects_upsert", "attributes_list",
  "docs_get", "docs_list", "docs_skill", "detect_project",
];

export const KNOWN_TOOLS_SET: ReadonlySet<string> = new Set(KNOWN_TOOLS);
