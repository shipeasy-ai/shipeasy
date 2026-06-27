import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TOOLS } from "./schema.js";

/** All MCP tool definitions (name, description, JSON-schema input). */
export const ALL_TOOLS: Tool[] = TOOLS;

/**
 * The tool subset the assistant surfaces (in-dashboard Jarvis, the Slack /mcp
 * server, and the @-mention Slack bot). Experimentation-domain tools plus the
 * two feedback-filing tools (file_bug / file_feature). Excludes all i18n_*,
 * detect_project, auth_*, and the internal ops_notify escalation tool.
 */
export const EXPERIMENT_TOOL_NAMES = [
  "list_resources",
  "get_resource",
  // feature flags (gates) — registry-driven; gains list/enable/disable/rollout
  "release_flags_list",
  "release_flags_create",
  "release_flags_update",
  "release_flags_enable",
  "release_flags_disable",
  "release_flags_rollout",
  "release_flags_archive",
  // kill switches — registry-driven
  "release_killswitch_list",
  "release_killswitch_create",
  "release_killswitch_update",
  "release_killswitch_set",
  "release_killswitch_unset",
  "release_killswitch_archive",
  // configs — registry-driven
  "release_configs_list",
  "release_configs_get",
  "release_configs_create",
  "release_configs_update",
  "release_configs_draft",
  "release_configs_publish",
  "release_configs_archive",
  // universes — registry-driven
  "release_experiments_universes_list",
  "release_experiments_universes_create",
  "release_experiments_universes_update",
  "release_experiments_universes_archive",
  // experiments — hand-written (goal-metric DSL + ship/hold/wait verdict)
  "release_experiments_create",
  "release_experiments_update",
  "release_experiments_archive",
  "release_experiments_restore",
  "release_experiments_start",
  "release_experiments_stop",
  "release_experiments_status",
  // alert rules — ops module, still hand-written under exp_* names
  "exp_create_alert_rule",
  "exp_update_alert_rule",
  "exp_delete_alert_rule",
  // feedback filing
  "file_bug",
  "file_feature",
] as const;

export type ExperimentToolName = (typeof EXPERIMENT_TOOL_NAMES)[number];

export const EXPERIMENT_TOOLS: Tool[] = TOOLS.filter((t) =>
  (EXPERIMENT_TOOL_NAMES as readonly string[]).includes(t.name),
);
