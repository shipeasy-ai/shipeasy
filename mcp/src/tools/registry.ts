import {
  ALL_OPERATIONS,
  operationsToMcpTools,
  operationsToDispatch,
  opId,
  opMcpName,
  type Operation,
} from "@shipeasy/openapi";

/**
 * The full registry-driven MCP surface (doc 21 §A2/§A3). One shared
 * `Operation[]` drives the CLI subcommands, these MCP tools, and the docs, so
 * the facade→wire mapping lives once. Every module is here — gates, kill
 * switches, configs, universes, experiments, metrics, events, ops (queue +
 * alert rules), `projects current`, attributes, SDK-docs, and the read-only
 * i18n list ops.
 *
 * Two registry ops are deliberately EXCLUDED on MCP because the consumer layers
 * something the worker-safe op can't:
 *   - `projects.upsert` — MCP keeps a hand-written `projects_upsert` that writes
 *     `.shipeasy` (an fs bind) after the shared upsert call.
 *   - the i18n WRITE ops (`profiles create` / `push` / `update` / `publish`) —
 *     MCP keeps its richer fs-flavoured i18n tools (codemod-review push, etc.)
 *     over the same shared `client.i18n` resource. The READ ops
 *     (`i18n profiles list`, `i18n drafts list`) ARE registry-driven so they can
 *     replace the deleted generic-read `profiles`/`drafts` kinds.
 */
const EXCLUDED_ON_MCP = new Set<string>([
  "projects.upsert",
  "i18n.profiles.create",
  "i18n.push",
  "i18n.update",
  "i18n.publish",
]);

export const REGISTRY_OPS: Operation[] = ALL_OPERATIONS.filter((op) => !EXCLUDED_ON_MCP.has(opId(op)));

/** MCP `tools/list` entries for the registry-driven tools. */
export const REGISTRY_TOOLS = operationsToMcpTools(REGISTRY_OPS);

/** MCP `tools/call` dispatch map: tool name → (client, args) → result. */
export const REGISTRY_DISPATCH = operationsToDispatch(REGISTRY_OPS);

/** tool name → Operation, so the server can read `mutates` to gate the binding check. */
export const REGISTRY_OPS_BY_TOOL: Map<string, Operation> = new Map(
  REGISTRY_OPS.map((op) => [opMcpName(op), op]),
);
