import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { mergeMcpServer, readJsonConfig, writeJsonConfig } from "../util/json-config";

/**
 * The coding agents `shipeasy setup` knows how to wire up. Detection mirrors
 * what wrangler does — look for the agent's binary on PATH and/or its
 * well-known config directory. Jules is a cloud agent with no local install,
 * so it is never auto-detected but is still offered in the picker.
 */
export type AgentId = "claude" | "cursor" | "codex" | "copilot" | "jules";

export interface AgentInfo {
  id: AgentId;
  label: string;
  /** True when we found a local signal that the agent is installed. */
  detected: boolean;
  /** Human-readable detection signal (or why we couldn't detect it). */
  reason: string;
}

/** The hosted, remote Shipeasy MCP server. Assistants connect over HTTP — no
 *  local `npx` process, no per-machine install; auth is negotiated by the
 *  client against the hosted endpoint on first use. */
export const MCP_URL = "https://mcp.shipeasy.ai";

/** The MCP server entry every assistant registers (streamable-HTTP remote). */
export const SERVER_SPEC = { type: "http", url: MCP_URL };

const MARKETPLACE_SLUG = "shipeasy-ai/shipeasy";

/** Is `bin` resolvable on PATH? Cross-platform (honors PATHEXT on win32). */
export function onPath(bin: string): boolean {
  const PATH = process.env.PATH ?? "";
  if (!PATH) return false;
  const exts =
    process.platform === "win32" ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";") : [""];
  for (const dir of PATH.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        if (statSync(join(dir, bin + ext)).isFile()) return true;
      } catch {
        // not in this dir — keep looking
      }
    }
  }
  return false;
}

/** Does `<home>/<...segments>` exist? */
export function homePathExists(...segments: string[]): boolean {
  return existsSync(join(homedir(), ...segments));
}

/** Detect every known agent in the current environment. */
export function detectAgents(cwd: string): AgentInfo[] {
  const claudeBin = onPath("claude");
  const cursorBin = onPath("cursor");
  const codexBin = onPath("codex");
  const copilotBin = onPath("copilot");

  return [
    {
      id: "claude",
      label: "Claude Code",
      detected: claudeBin || homePathExists(".claude"),
      reason: claudeBin
        ? "`claude` on PATH"
        : homePathExists(".claude")
          ? "~/.claude present"
          : "not found",
    },
    {
      id: "cursor",
      label: "Cursor",
      detected: cursorBin || homePathExists(".cursor"),
      reason: cursorBin
        ? "`cursor` on PATH"
        : homePathExists(".cursor")
          ? "~/.cursor present"
          : "not found",
    },
    {
      id: "codex",
      label: "OpenAI Codex",
      detected: codexBin || homePathExists(".codex"),
      reason: codexBin
        ? "`codex` on PATH"
        : homePathExists(".codex")
          ? "~/.codex present"
          : "not found",
    },
    {
      id: "copilot",
      label: "GitHub Copilot",
      detected: copilotBin || homePathExists(".config", "github-copilot"),
      reason: copilotBin
        ? "`copilot` on PATH"
        : homePathExists(".config", "github-copilot")
          ? "~/.config/github-copilot present"
          : "not found",
    },
    {
      id: "jules",
      label: "Google Jules",
      // Cloud agent — no reliable local signal. Offered, never pre-checked.
      detected: false,
      reason: existsSync(join(cwd, "AGENTS.md"))
        ? "AGENTS.md present (cloud agent)"
        : "cloud agent — connect MCP in Jules settings",
    },
  ];
}

export interface InstallCtx {
  cwd: string;
  scope: "user" | "project";
  force: boolean;
  dryRun: boolean;
}

export interface McpResult {
  /** What happened: a written/updated file, a shell-out, or a manual step. */
  action: "wrote" | "updated" | "skipped" | "shell" | "manual" | "error";
  detail: string;
}

/** The exact `[mcp_servers.shipeasy]` block for a hand-edited `~/.codex/config.toml`. */
export function codexTomlSnippet(): string {
  return ["[mcp_servers.shipeasy]", `url = "${MCP_URL}"`].join("\n");
}

/** Resolve the JSON MCP config path + wrapper key for the file-based agents. */
function jsonMcpTarget(
  agent: AgentId,
  ctx: InstallCtx,
): { path: string; key: "mcpServers" | "servers" } | null {
  const home = homedir();
  switch (agent) {
    case "claude":
      return ctx.scope === "user"
        ? { path: join(home, ".claude", "settings.json"), key: "mcpServers" }
        : { path: join(ctx.cwd, ".mcp.json"), key: "mcpServers" };
    case "cursor":
      return ctx.scope === "user"
        ? { path: join(home, ".cursor", "mcp.json"), key: "mcpServers" }
        : { path: join(ctx.cwd, ".cursor", "mcp.json"), key: "mcpServers" };
    case "copilot":
      // VS Code / Copilot reads `.vscode/mcp.json` under a `servers` key. This
      // is repo-scoped regardless of --scope (there is no clean user-scope file).
      return { path: join(ctx.cwd, ".vscode", "mcp.json"), key: "servers" };
    default:
      return null;
  }
}

function registerJsonMcp(
  target: { path: string; key: "mcpServers" | "servers" },
  ctx: InstallCtx,
): McpResult {
  const existing = readJsonConfig(target.path);
  const { config, replaced } = mergeMcpServer(
    existing,
    "shipeasy",
    SERVER_SPEC,
    ctx.force,
    target.key,
  );
  if (replaced && !ctx.force) {
    return {
      action: "skipped",
      detail: `${target.path} already has a 'shipeasy' entry (use --force to replace)`,
    };
  }
  if (ctx.dryRun) {
    return { action: replaced ? "updated" : "wrote", detail: target.path };
  }
  writeJsonConfig(target.path, config);
  return { action: replaced ? "updated" : "wrote", detail: target.path };
}

/**
 * Register the Shipeasy MCP server for one agent. JSON-config agents are merged
 * idempotently; Codex shells out to `codex mcp add` when the binary is present
 * (else returns the TOML snippet to paste); Jules is connected in its UI.
 */
export function registerMcp(agent: AgentId, ctx: InstallCtx): McpResult {
  const jsonTarget = jsonMcpTarget(agent, ctx);
  if (jsonTarget) return registerJsonMcp(jsonTarget, ctx);

  if (agent === "codex") {
    if (!onPath("codex")) {
      return {
        action: "manual",
        detail: `add to ~/.codex/config.toml:\n\n${codexTomlSnippet()}`,
      };
    }
    if (ctx.dryRun) {
      return {
        action: "shell",
        detail: `would run: codex mcp add shipeasy --url ${MCP_URL}`,
      };
    }
    const res = spawnSync("codex", ["mcp", "add", "shipeasy", "--url", MCP_URL], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (res.status !== 0) {
      return {
        action: "error",
        detail: `codex mcp add failed (${res.status ?? "?"}). Add manually:\n\n${codexTomlSnippet()}`,
      };
    }
    return { action: "shell", detail: "codex mcp add shipeasy" };
  }

  if (agent === "jules") {
    return {
      action: "manual",
      detail: `Jules connects MCP servers from its Settings page (cloud) — point it at ${MCP_URL}. AGENTS.md covers the workflows in the meantime.`,
    };
  }

  return { action: "error", detail: `no MCP target for ${agent}` };
}

export interface ClaudePluginResult {
  action: "installed" | "manual" | "error";
  lines: string[];
}

/**
 * Install the Shipeasy Claude Code plugin (marketplace + plugin) when the
 * `claude` binary is available — this is the native path that brings the MCP
 * server, skills, and slash commands in one step. Falls back to registering the
 * project `.mcp.json` and printing the manual commands when it isn't.
 */
export function installClaudePlugin(ctx: InstallCtx): ClaudePluginResult {
  if (!onPath("claude")) {
    const mcp = registerMcp("claude", { ...ctx, scope: "project" });
    return {
      action: "manual",
      lines: [
        `MCP: ${mcp.action === "skipped" ? mcp.detail : `${mcp.action} ${mcp.detail}`}`,
        "`claude` not on PATH — install the plugin once Claude Code is available:",
        `  claude plugin marketplace add ${MARKETPLACE_SLUG}`,
        "  claude plugin install shipeasy@shipeasy",
      ],
    };
  }
  if (ctx.dryRun) {
    return {
      action: "installed",
      lines: [
        `would run: claude plugin marketplace add ${MARKETPLACE_SLUG}`,
        "would run: claude plugin install shipeasy@shipeasy",
      ],
    };
  }
  const add = spawnSync("claude", ["plugin", "marketplace", "add", MARKETPLACE_SLUG], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  // `marketplace add` is idempotent-ish; a non-zero here is usually "already added".
  const install = spawnSync("claude", ["plugin", "install", "shipeasy@shipeasy"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (install.status !== 0) {
    return {
      action: "error",
      lines: [
        `claude plugin install failed (${install.status ?? "?"}). Run manually:`,
        `  claude plugin marketplace add ${MARKETPLACE_SLUG}`,
        "  claude plugin install shipeasy@shipeasy",
        ...(add.stderr ? [`(marketplace add: ${add.stderr.toString().trim()})`] : []),
      ],
    };
  }
  return { action: "installed", lines: ["plugin installed (marketplace + shipeasy@shipeasy)"] };
}
