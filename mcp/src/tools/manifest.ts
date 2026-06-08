import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TOOLS } from "./schema.js";

/** All MCP tool definitions (name, description, JSON-schema input). */
export const ALL_TOOLS: Tool[] = TOOLS;

/**
 * Experimentation-domain tools only — the subset the in-dashboard assistant
 * is allowed to use. Excludes all i18n_*, detect_project, feedback tools.
 */
export const EXPERIMENT_TOOL_NAMES = [
  "list_resources",
  "get_resource",
  "exp_experiment_status",
  "exp_create_gate",
  "exp_update_gate",
  "exp_delete_gate",
  "exp_create_killswitch",
  "exp_update_killswitch",
  "exp_delete_killswitch",
  "exp_set_killswitch_switch",
  "exp_unset_killswitch_switch",
  "exp_create_config",
  "exp_update_config",
  "exp_delete_config",
  "exp_create_universe",
  "exp_update_universe",
  "exp_delete_universe",
  "exp_create_experiment",
  "exp_update_experiment",
  "exp_delete_experiment",
  "exp_start_experiment",
  "exp_stop_experiment",
  "exp_create_alert_rule",
  "exp_update_alert_rule",
  "exp_delete_alert_rule",
] as const;

export type ExperimentToolName = (typeof EXPERIMENT_TOOL_NAMES)[number];

export const EXPERIMENT_TOOLS: Tool[] = TOOLS.filter((t) =>
  (EXPERIMENT_TOOL_NAMES as readonly string[]).includes(t.name),
);
