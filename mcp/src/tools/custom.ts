import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { customOperations, type CustomOp, type CustomParam } from "@shipeasy/openapi/custom";
import { getBoundSdk } from "../util/project-config.js";

/**
 * MCP adapter for the shared custom-operations registry (`@shipeasy/openapi/custom`)
 * — the sugar tools that aren't admin API endpoints, so they can't be generated
 * from the spec: `metrics_grammar` (prints the metric-DSL grammar) and `docs_*`
 * (fetches each SDK's docs from GitHub Pages). The registry is consumer-agnostic;
 * the CLI projects it onto commander, this projects the same ops onto MCP tools,
 * so the surface stays in sync across both.
 *
 * `run` is worker-safe (pure or outbound `fetch` — never the admin client), so
 * these tools need no auth or `.shipeasy` binding. The server dispatches them
 * without resolving a credential.
 */
const firstLine = (s?: string) => (s ? s.split("\n")[0].trim() : "");

/** Tool name = group path + verb joined by `_` (mirrors the CLI command path). */
export const customToolName = (op: CustomOp): string => [...op.group, op.name].join("_").replace(/-/g, "_");

function paramSchema(p: CustomParam): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: p.type };
  if (p.description) schema.description = p.description;
  if (p.enum) schema.enum = p.enum;
  return schema;
}

/** `metrics_grammar` → "Metrics Grammar" — human display name for MCP clients. */
const toolTitle = (name: string): string =>
  name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const CUSTOM_TOOLS: Tool[] = customOperations.map((op) => {
  const name = customToolName(op);
  return {
    name,
    description: op.description ? `${op.summary}. ${firstLine(op.description)}` : op.summary,
    inputSchema: {
      type: "object",
      properties: Object.fromEntries(op.params.map((p) => [p.name, paramSchema(p)])),
      required: op.params.filter((p) => p.required).map((p) => p.name),
    },
    // Custom ops are pure / outbound-fetch only (grammar print, docs fetch) —
    // never mutate server state, so they're all read-only.
    annotations: { title: toolTitle(name), readOnlyHint: true },
  };
});

/** tool name → (args) → result. No client; custom ops are auth-free. */
export const CUSTOM_DISPATCH: Record<string, (args: Record<string, unknown>) => Promise<unknown>> =
  Object.fromEntries(
    customOperations.map((op) => [
      customToolName(op),
      async (args: Record<string, unknown>) => {
        // `docs` tools default `sdk` to the `sdk` recorded in the bound
        // `.shipeasy`, so an agent in a bound project can omit it.
        if (op.group[0] === "docs" && !args.sdk) {
          const sdk = getBoundSdk(process.cwd());
          if (sdk) args = { ...args, sdk };
        }
        return op.run(args);
      },
    ]),
  );
