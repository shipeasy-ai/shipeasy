import {
  gateOperations,
  killswitchOperations,
  configOperations,
  universeOperations,
  operationsToMcpTools,
  operationsToDispatch,
  opMcpName,
  type Operation,
} from "@shipeasy/openapi";

/**
 * The `release`-module surface the MCP server drives straight off the shared
 * operation registry (one `Operation[]` → CLI subcommands + MCP tools + docs).
 *
 * Scope: gate, kill switch, config, universe — the four resources whose MCP
 * tools are a 1:1 match for the registry op. The **experiment** resource is
 * deliberately NOT here: its MCP tools (`release_experiments_*`) stay
 * hand-written in `schema.ts` / `exp/index.ts` because they carry the
 * goal-metric DSL, guardrail metrics, and ship/hold/wait verdict that the thin
 * registry op doesn't model. Alert rules live in the `ops` module and are also
 * hand-written. Both are layered on top of these registry tools.
 */
export const RELEASE_REGISTRY_OPS: Operation[] = [
  ...gateOperations,
  ...killswitchOperations,
  ...configOperations,
  ...universeOperations,
];

/** MCP `tools/list` entries for the registry-driven release tools. */
export const RELEASE_REGISTRY_TOOLS = operationsToMcpTools(RELEASE_REGISTRY_OPS);

/** MCP `tools/call` dispatch map: tool name → (client, args) → result. */
export const RELEASE_REGISTRY_DISPATCH = operationsToDispatch(RELEASE_REGISTRY_OPS);

/** tool name → Operation, so the server can read `mutates` to gate the binding check. */
export const RELEASE_REGISTRY_OPS_BY_TOOL: Map<string, Operation> = new Map(
  RELEASE_REGISTRY_OPS.map((op) => [opMcpName(op), op]),
);
