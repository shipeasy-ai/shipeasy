import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TOOLS } from "./schema.js";
import { REGISTRY_TOOLS } from "./registry.js";

/** All MCP tool definitions (name, description, JSON-schema input). */
export const ALL_TOOLS: Tool[] = TOOLS;

/**
 * The tool subset the assistant surfaces (in-dashboard Jarvis, the Slack /mcp
 * server, and the @-mention Slack bot). Now that the whole CRUD/read surface is
 * registry-driven, the allow-list is a PREFIX POLICY over the registry tools
 * rather than a hand-maintained literal list — every `release_*`, `metrics_*`,
 * `events_*`, `ops_*` (the unified queue + `ops_alerts_*`), `attributes_*`, and
 * `docs_*` tool, plus `projects_current`.
 *
 * Excluded by policy: `i18n_*` (translation workflow), `detect_project`,
 * `projects_upsert`, and `auth_*` (install/identity surface).
 *
 * Renames folded in vs. the old hand-written list (doc 21 §A.D): `exp_*_alert_rule`
 * → `ops_alerts_*`; `file_bug`/`file_feature` → `ops_create`;
 * `list_resources`/`get_resource` → the typed `*_list`/`*_get` tools;
 * `get_sdk_snippet` → `docs_*`.
 */
const ASSISTANT_PREFIXES = [
  "release_",
  "metrics_",
  "events_",
  "ops_",
  "attributes_",
  "docs_",
];

export const EXPERIMENT_TOOL_NAMES: string[] = REGISTRY_TOOLS.map((t) => t.name).filter(
  (n) => ASSISTANT_PREFIXES.some((p) => n.startsWith(p)) || n === "projects_current",
);

export type ExperimentToolName = string;

export const EXPERIMENT_TOOLS: Tool[] = TOOLS.filter((t) =>
  EXPERIMENT_TOOL_NAMES.includes(t.name),
);
