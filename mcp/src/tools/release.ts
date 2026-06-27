import {
  gateOperations,
  killswitchOperations,
  configOperations,
  universeOperations,
  experimentOperations,
  operationsToMcpTools,
  operationsToDispatch,
  opMcpName,
  type Operation,
} from "@shipeasy/openapi";

/**
 * The `release`-module surface the MCP server drives straight off the shared
 * operation registry (one `Operation[]` → CLI subcommands + MCP tools + docs).
 *
 * Scope: gate, kill switch, config, universe, and experiment. The experiment op
 * now carries everything that used to be hand-written here (goal-metric DSL,
 * guardrail metrics, `bucketBy`, sequential testing, the ship/hold/wait
 * verdict on `status`), so there are no bespoke `release_experiments_*` tools
 * left. Alert rules still live in the `ops` module and are hand-written until
 * that module is ported.
 */
export const RELEASE_REGISTRY_OPS: Operation[] = [
  ...gateOperations,
  ...killswitchOperations,
  ...configOperations,
  ...universeOperations,
  ...experimentOperations,
];

/** MCP `tools/list` entries for the registry-driven release tools. */
export const RELEASE_REGISTRY_TOOLS = operationsToMcpTools(RELEASE_REGISTRY_OPS);

/** MCP `tools/call` dispatch map: tool name → (client, args) → result. */
export const RELEASE_REGISTRY_DISPATCH = operationsToDispatch(RELEASE_REGISTRY_OPS);

/** tool name → Operation, so the server can read `mutates` to gate the binding check. */
export const RELEASE_REGISTRY_OPS_BY_TOOL: Map<string, Operation> = new Map(
  RELEASE_REGISTRY_OPS.map((op) => [opMcpName(op), op]),
);
