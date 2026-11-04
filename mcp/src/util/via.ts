// Provenance headers on every admin-API call this server makes: the write came
// through MCP, and — from the `initialize` handshake's clientInfo.name, else the
// harness env — which agent drove it. The dashboard prints them next to the
// item's activity and comments ("via MCP · Claude"). A label, not a credential;
// the server folds the raw client name (`claude-code`, `codex-mcp-client`) to
// its own slug.

import { detectAckAgent } from "../tools/ack-agent.js";

let clientName: string | undefined;

/** Record the connected client's self-reported name (set per tool call). */
export function setMcpClientName(name: string | undefined): void {
  clientName = name?.trim() || undefined;
}

export function viaHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const agent = clientName ?? detectAckAgent(undefined, env);
  // The trail the agent works under (`SHIPEASY_TRAIL=T-12`): the server links what
  // each write creates or changes to it. This stdio server reads the env it was
  // launched with; the hosted MCP worker cannot see an agent's env, so the CLI is
  // the supported path there (see the shipeasy-ops-work skill).
  const trail = env.SHIPEASY_TRAIL?.trim();
  return {
    "X-Shipeasy-Via": "mcp",
    ...(agent ? { "X-Shipeasy-Agent": agent } : {}),
    ...(trail && /^T-\d{1,9}$/i.test(trail) ? { "X-Shipeasy-Trail": trail.toUpperCase() } : {}),
  };
}
