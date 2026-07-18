import type { Command } from "commander";

/**
 * `shipeasy ops ack` — env-side enhancement of the spec-generated command.
 *
 * The generated action already posts `/ops/{handle}/ack`; this layer defaults
 * `--agent` (and, when the harness exposes one, `--session-id`) from the
 * environment so a coding agent can just run `shipeasy ops ack 7` and be
 * recorded as itself. A human at a plain terminal has none of these markers, so
 * their ack stays a human ack.
 *
 * Detection mirrors `setup/agents.ts#HARNESS_ENV`, narrowed to the platforms
 * the ack API accepts as agent types. Overrides:
 *   - `SHIPEASY_ACK_AGENT=<type>` forces a type we can't sniff (e.g. `jules`);
 *   - `SHIPEASY_ACK_AGENT=0|none|human` forces a human ack even inside a
 *     harness (e.g. a person working in Cursor's integrated terminal);
 *   - an explicit `--agent`/`--session-id` always wins over detection.
 */
const AGENT_ENV: Array<[string, string]> = [
  ["CLAUDECODE", "claude"],
  ["CLAUDE_CODE_ENTRYPOINT", "claude"],
  ["CURSOR_AGENT", "cursor"],
  ["CURSOR_TRACE_ID", "cursor"],
  ["GITHUB_COPILOT_CLI", "copilot"],
];

/** Session-id markers, in precedence order. Harnesses that don't export one
 *  simply record no session (the ack still works). */
const SESSION_ENV = ["SHIPEASY_ACK_SESSION", "CLAUDE_SESSION_ID", "CURSOR_SESSION_ID"];

const HUMAN_OVERRIDES = new Set(["0", "false", "none", "human"]);

export function detectAckContext(env: NodeJS.ProcessEnv = process.env): {
  agent: string | null;
  sessionId: string | null;
} {
  const sessionId = SESSION_ENV.map((k) => env[k]?.trim()).find(Boolean) ?? null;
  const override = env.SHIPEASY_ACK_AGENT?.trim().toLowerCase();
  if (override) {
    if (HUMAN_OVERRIDES.has(override)) return { agent: null, sessionId };
    return { agent: override, sessionId };
  }
  for (const [key, agent] of AGENT_ENV) {
    if (env[key]) return { agent, sessionId };
  }
  return { agent: null, sessionId };
}

/** Attach the env-defaulting hook to the generated `ops ack` command. */
export function ackCommand(parent: Command): void {
  const ops = parent.commands.find((c) => c.name() === "ops");
  const ack = ops?.commands.find((c) => c.name() === "ack");
  if (!ack) return;
  ack.hook("preAction", (_this, action) => {
    const detected = detectAckContext();
    if (detected.agent && action.getOptionValue("agent") === undefined) {
      action.setOptionValue("agent", detected.agent);
    }
    if (detected.sessionId && action.getOptionValue("sessionId") === undefined) {
      action.setOptionValue("sessionId", detected.sessionId);
    }
  });
  ack.addHelpText(
    "after",
    "\nInside a coding-agent harness, --agent (and --session-id when exposed) default from the\nenvironment — Claude Code acks as claude, Cursor as cursor, Copilot as copilot. Set\nSHIPEASY_ACK_AGENT=<type> to force a type, or SHIPEASY_ACK_AGENT=none for a human ack.\nList the project's connected agents with `shipeasy ops agents list`.",
  );
}
