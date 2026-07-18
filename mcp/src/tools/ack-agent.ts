// `ops_ack` auto-identification: when the calling agent doesn't pass its own
// `agent` type, identify it from the MCP client identity (the `initialize`
// handshake's clientInfo.name) with the harness env as fallback — a stdio MCP
// server is a child process of the client, so markers like CLAUDECODE are
// inherited. Mirrors the CLI's `ops ack` env layer (cli/src/commands/ack.ts).
// `SHIPEASY_ACK_AGENT=<type>` forces a type; `=none|human|0` forces a human ack.

const MCP_CLIENT_AGENTS: Array<[RegExp, string]> = [
  [/claude/i, "claude"],
  [/cursor/i, "cursor"],
  [/copilot/i, "copilot"],
  [/jules|gemini/i, "jules"],
];

const HUMAN_OVERRIDES = new Set(["0", "false", "none", "human"]);

export function detectAckAgent(
  clientName: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const override = env.SHIPEASY_ACK_AGENT?.trim().toLowerCase();
  if (override) return HUMAN_OVERRIDES.has(override) ? null : override;
  if (clientName) {
    for (const [re, agent] of MCP_CLIENT_AGENTS) {
      if (re.test(clientName)) return agent;
    }
  }
  if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT) return "claude";
  if (env.CURSOR_AGENT || env.CURSOR_TRACE_ID) return "cursor";
  if (env.GITHUB_COPILOT_CLI) return "copilot";
  return null;
}

/** The run's session id, when the harness exposes one to the environment. */
export function detectAckSession(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const key of ["SHIPEASY_ACK_SESSION", "CLAUDE_SESSION_ID", "CURSOR_SESSION_ID"]) {
    const v = env[key]?.trim();
    if (v) return v;
  }
  return null;
}
