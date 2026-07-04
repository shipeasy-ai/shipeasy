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
 * SOURCE OF TRUTH is `@shipeasy/mcp`'s `ALL_TOOLS` (`@shipeasy/mcp/tools-manifest`).
 * This is a committed SNAPSHOT so the fast unit tests don't require the MCP dist
 * built. `catalog.test.ts` cross-checks it against the live manifest WHEN the
 * package is built, and prints the exact diff to paste back here on drift.
 * Re-sync command: see catalog.test.ts.
 */
export const KNOWN_TOOLS: readonly string[] = [
  // release / flags (+ per-flag attributes)
  "release_flags_create", "release_flags_list", "release_flags_update",
  "release_flags_enable", "release_flags_disable", "release_flags_archive",
  "release_flags_attributes_create", "release_flags_attributes_list",
  "release_flags_attributes_get", "release_flags_attributes_update",
  "release_flags_attributes_archive",
  "release_flags_templates_list", "release_flags_templates_get",
  "release_flags_templates_create", "release_flags_templates_update",
  "release_flags_templates_archive",
  // release / configs
  "release_configs_create", "release_configs_list", "release_configs_get",
  "release_configs_update", "release_configs_update_schema", "release_configs_draft",
  "release_configs_discard_draft", "release_configs_publish", "release_configs_activity",
  "release_configs_archive",
  // release / killswitch
  "release_killswitch_create", "release_killswitch_list", "release_killswitch_get",
  "release_killswitch_set", "release_killswitch_set_value", "release_killswitch_unset",
  "release_killswitch_update", "release_killswitch_archive",
  // release / experiments (+ universes)
  "release_experiments_create", "release_experiments_get", "release_experiments_list",
  "release_experiments_update", "release_experiments_start", "release_experiments_stop",
  "release_experiments_results", "release_experiments_timeseries", "release_experiments_set_metrics",
  "release_experiments_reanalyze", "release_experiments_restore", "release_experiments_archive",
  "release_experiments_universes_create", "release_experiments_universes_list",
  "release_experiments_universes_update", "release_experiments_universes_archive",
  // metrics (+ events, which live under metrics_events_*)
  "metrics_create", "metrics_list", "metrics_show", "metrics_update", "metrics_archive",
  "metrics_events_create", "metrics_events_list", "metrics_events_get",
  "metrics_events_update", "metrics_events_approve", "metrics_events_archive",
  // ops (unified queue + alerts + bug/feature sugar + trigger provisioning)
  "ops_create", "ops_bug", "ops_feature", "ops_get", "ops_list", "ops_update",
  "ops_notify", "ops_link_pr",
  "ops_alerts_create", "ops_alerts_list", "ops_alerts_update", "ops_alerts_archive",
  "ops_alerts_channels",
  "ops_trigger_create_claude", "ops_trigger_create_copilot",
  "ops_trigger_create_cursor", "ops_trigger_create_jules",
  // errors (tracked-error read surface — MCP-only projection of the Errors tag)
  "errors_list", "errors_get", "errors_series",
  // i18n
  "i18n_keys_list", "i18n_keys_push", "i18n_keys_set", "i18n_keys_update",
  "i18n_drafts_create", "i18n_drafts_list", "i18n_drafts_update",
  "i18n_profiles_create", "i18n_profiles_list", "i18n_profiles_publish",
  // projects
  "projects_current", "projects_update",
];

export const KNOWN_TOOLS_SET: ReadonlySet<string> = new Set(KNOWN_TOOLS);
