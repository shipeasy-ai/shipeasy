import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * MIRROR of `@shipeasy/core`'s `buildCopilotAgentFile` — the CLI lives in the
 * `marketplace` submodule and can't import `@shipeasy/core`, so this reproduces
 * the same `.github/agents/shipeasy.agent.md` bytes. Keep the two in lockstep
 * (same pattern as `trigger-prompt.ts` ↔ `TRIGGER-INSTALL.md`); the UI renders the
 * core copy, `shipeasy setup` writes this one.
 */

export const COPILOT_AGENT_NAME = "shipeasy";
export const COPILOT_AGENT_FILE_PATH = ".github/agents/shipeasy.agent.md";
/** The repo Copilot secret the agent file references — must start `COPILOT_MCP_`
 *  (the coding agent only injects `COPILOT_MCP_*` secrets into MCP server config).
 *  Holds a `semcp_` machine token. */
export const COPILOT_MCP_TOKEN_SECRET = "COPILOT_MCP_SHIPEASY_CLI_TOKEN";

/** Origin of the hosted MCP server. Overridable for local/e2e via `mcpBaseUrl`. */
const MCP_BASE_URL = "https://mcp.shipeasy.ai";

/** Build the `.github/agents/shipeasy.agent.md` contents for a project. */
export function buildCopilotAgentFile(opts: { projectId: string; mcpBaseUrl?: string }): {
  path: string;
  content: string;
} {
  const projectId = opts.projectId;
  // Project-scoped endpoint — the `/p/<id>/mcp` path pins every tool call to this
  // project on the server, so the token's project and the URL's project agree.
  const mcpUrl = `${opts.mcpBaseUrl ?? MCP_BASE_URL}/p/${projectId}/mcp`;
  const frontmatter = [
    "---",
    `name: ${COPILOT_AGENT_NAME}`,
    "description: >-",
    "  Shipeasy autonomous maintenance agent. Works the Shipeasy ops queue (bugs,",
    "  feature requests, auto-filed error/alert tickets) one item at a time, opening",
    "  one pull request per item. Never merges.",
    "target: github-copilot",
    "mcp-servers:",
    "  shipeasy:",
    "    type: http",
    // Self-contained: the project-scoped URL is not a credential, inline it.
    `    url: '${mcpUrl}'`,
    "    tools: ['*']",
    "    headers:",
    // The only secret — a `semcp_` machine token from the repo Copilot secret store.
    `      Authorization: 'Bearer \${{ secrets.${COPILOT_MCP_TOKEN_SECRET} }}'`,
    "---",
  ].join("\n");

  const body = [
    "You are the Shipeasy autonomous maintenance agent for this repository.",
    "",
    `You have the \`shipeasy\` MCP server connected and already authenticated for`,
    `project \`${projectId}\` — use its tools to read and act on the ops queue. Do`,
    "not run `shipeasy login`; the MCP server carries its own credentials.",
    "",
    "Follow the `shipeasy-ops-work` workflow verbatim:",
    "",
    "1. List the open ops queue (bugs, feature requests, auto-filed error/alert",
    "   tickets) via the Shipeasy MCP tools and pick the highest-priority item.",
    "2. Fix exactly one item as a single atomic diff on its own branch off the",
    "   repository's default branch.",
    "3. Open ONE pull request for that item. Add `Closes #<issue>` when the item has",
    "   a connected GitHub issue.",
    "4. Flip the item to `ready_for_qa` via the MCP tools.",
    "5. Never merge, and never touch more than one item per pull request. If the",
    "   queue is empty, stop cleanly.",
  ].join("\n");

  return { path: COPILOT_AGENT_FILE_PATH, content: `${frontmatter}\n\n${body}\n` };
}

/** The repository root (git top-level), falling back to `cwd` when not a repo. */
function repoRoot(cwd: string): string {
  try {
    const top = execSync("git rev-parse --show-toplevel", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return top || cwd;
  } catch {
    return cwd;
  }
}

export interface WriteAgentFileResult {
  action: "wrote" | "skipped" | "error";
  /** Absolute path of the (would-be) written file. */
  path: string;
  detail?: string;
}

/**
 * Write `.github/agents/shipeasy.agent.md` at the repo root. Idempotent: an
 * existing file is left untouched unless `force`. Best-effort — a write failure
 * returns an `error` result rather than throwing (the wizard still shows the
 * contents for a manual copy).
 */
export function writeCopilotAgentFile(opts: {
  projectId: string;
  cwd?: string;
  force?: boolean;
  dryRun?: boolean;
}): WriteAgentFileResult {
  const cwd = opts.cwd ?? process.cwd();
  const { content } = buildCopilotAgentFile({ projectId: opts.projectId });
  const abs = join(repoRoot(cwd), COPILOT_AGENT_FILE_PATH);
  if (existsSync(abs) && !opts.force) {
    return { action: "skipped", path: abs, detail: "already exists (use --force to overwrite)" };
  }
  if (opts.dryRun) return { action: "wrote", path: abs };
  try {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, { encoding: "utf8" });
    return { action: "wrote", path: abs };
  } catch (e) {
    return { action: "error", path: abs, detail: (e as Error).message.split("\n")[0] };
  }
}
