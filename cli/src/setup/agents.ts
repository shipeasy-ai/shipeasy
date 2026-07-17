import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { mergeMcpServer, readJsonConfig, writeJsonConfig } from "../util/json-config";

/**
 * The coding agents `shipeasy setup` knows how to wire up. Detection mirrors
 * what wrangler does — look for the agent's binary on PATH and/or its
 * well-known config directory. Jules is now locally powered by Google
 * Antigravity (the `agy` binary), so it is auto-detected like the other local
 * agents (`agy` on PATH / `~/.antigravity`) instead of being cloud-only.
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
 *  client against the hosted endpoint on first use. The streamable-HTTP
 *  transport lives at `/mcp` (the worker serves discovery + tool calls there);
 *  a bare `https://mcp.shipeasy.ai` POSTs to `/` and 404s ("No handler for
 *  POST /"), which is what a client sees when the path is dropped. */
export const MCP_URL = "https://mcp.shipeasy.ai/mcp";

/** The project-scoped MCP endpoint. The `/p/<id>/mcp` path pins every tool call
 *  to that project (same semantics as the `X-Project-Id` header, which wins if
 *  both are present) — and because OAuth clients echo the configured server URL
 *  as the RFC 8707 `resource` parameter, the browser consent screen pre-selects
 *  this exact project instead of the user's session default. */
export function mcpUrl(projectId?: string): string {
  return projectId ? `https://mcp.shipeasy.ai/p/${projectId}/mcp` : MCP_URL;
}

/**
 * The MCP server entry an assistant registers (streamable-HTTP remote). When a
 * bound project is known we pin it BOTH ways: the project-scoped `/p/<id>/mcp`
 * URL (which also pre-selects the project on the OAuth consent screen via the
 * `resource` parameter) and the `X-Project-Id` header (kept as the explicit,
 * hand-editable override — it wins over the path on the server). This is what
 * makes a per-repo `.mcp.json` target its own project. Neither is a credential:
 * the server still authenticates you via OAuth and the admin API re-checks your
 * membership of the pinned project on every call.
 */
export function serverSpec(projectId?: string): {
  type: "http";
  url: string;
  "//list-guard": string;
  headers: Record<string, string>;
} {
  // Guard header is written DISABLED (`off`, the hosted-server default) so it's
  // present and discoverable — flip to `on` to require a *_list before each
  // *_create. `//list-guard` is a JSON-safe comment key (strict JSON has no `//`
  // comments); it sits beside `headers`, never inside it, so it's never sent as
  // an HTTP header (a `/` in a header name is invalid anyway).
  const headers: Record<string, string> = {};
  if (projectId) headers["X-Project-Id"] = projectId;
  headers["X-Shipeasy-List-Guard"] = "off";
  return {
    type: "http",
    url: mcpUrl(projectId),
    "//list-guard":
      'Set the "X-Shipeasy-List-Guard" header below to "on" to require a *_list before each ' +
      "*_create — a dedup guard so the agent confirms a resource doesn't already exist before " +
      'making one. "off" (default) disables it.',
    headers,
  };
}

/** The projectless default entry, kept for callers that don't scope a project. */
export const SERVER_SPEC = serverSpec();

export const MARKETPLACE_SLUG = "shipeasy-ai/shipeasy";

/**
 * How each agent is named to the `skills` CLI (`skills add … -a <name>`).
 * Claude is intentionally absent: it receives skills via the native plugin
 * (marketplace + `plugin install`), so we never double-install through `skills`.
 * Jules (Antigravity) receives skills via its own Gemini/`agy` channel, not the
 * `skills` CLI, so it stays absent here too.
 */
export const SKILLS_CLI_AGENT: Partial<Record<AgentId, string>> = {
  cursor: "cursor",
  codex: "codex",
  // The `skills` CLI names GitHub Copilot `github-copilot` (bare `copilot`
  // errors "Invalid agents: copilot"). Our own AgentId stays `copilot`.
  copilot: "github-copilot",
};

/**
 * Per-agent one-liners for the one-time MCP OAuth authorization. The hosted
 * server (mcp.shipeasy.ai) authenticates via OAuth 2.1 — on first use each
 * client opens a browser sign-in; there's no key to paste. The trigger is
 * client-driven (the CLI can't complete another app's OAuth for it), so setup
 * just tells the user/agent exactly where to start it.
 */
export const MCP_AUTH_INSTRUCTIONS: Record<AgentId, string> = {
  claude: "Claude Code: run `/mcp`, select `shipeasy`, choose Authenticate, then approve in the browser.",
  cursor: "Cursor: Settings → Tools & MCP → `shipeasy` → Login, then approve in the browser.",
  codex: "Codex: the `shipeasy` server prompts to authenticate on first tool use — approve in the browser.",
  copilot:
    "VS Code (Copilot): open the MCP Servers view, start `shipeasy`, then approve in the browser.",
  jules: "Antigravity (Jules): open MCP settings, authorize `shipeasy`, then approve in the browser.",
};

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
  // Jules is now locally powered by Google Antigravity — its binary is `agy`.
  const julesBin = onPath("agy");

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
      label: "Jules (Antigravity)",
      // Jules is locally powered by Google Antigravity (the `agy` binary), so we
      // detect it like the other local agents — `agy` on PATH or ~/.antigravity.
      detected: julesBin || homePathExists(".antigravity"),
      reason: julesBin
        ? "`agy` on PATH (Antigravity)"
        : homePathExists(".antigravity")
          ? "~/.antigravity present"
          : existsSync(join(cwd, "AGENTS.md"))
            ? "AGENTS.md present — install Antigravity (`agy`) to run Jules locally"
            : "Antigravity (`agy`) not found",
    },
  ];
}

/**
 * Env markers that mean "a coding agent / AI harness is driving this shell",
 * not a human at an interactive terminal. Used to decide whether `shipeasy
 * setup` should address its final hand-off to a machine (an actionable prompt)
 * or a person (plain instructions). Set `SHIPEASY_AGENT=1` to force the agent
 * path in a harness we don't yet recognise; `SHIPEASY_AGENT=0` to force human.
 */
const HARNESS_ENV: Array<[string, string]> = [
  ["CLAUDECODE", "Claude Code"],
  ["CLAUDE_CODE_ENTRYPOINT", "Claude Code"],
  ["CURSOR_AGENT", "Cursor"],
  ["CURSOR_TRACE_ID", "Cursor"],
  ["CODEX_SANDBOX", "OpenAI Codex"],
  ["GITHUB_COPILOT_CLI", "GitHub Copilot"],
  ["AIDER_CHAT", "Aider"],
  ["REPL_ID", "Replit Agent"],
];

export interface HarnessInfo {
  /** True when a coding agent (not a human terminal) is running the CLI. */
  inside: boolean;
  /** The detected agent's name, or null when unknown/human. */
  label: string | null;
}

/** Detect whether an AI coding agent is driving this invocation. */
export function detectHarness(env: NodeJS.ProcessEnv = process.env): HarnessInfo {
  const override = env.SHIPEASY_AGENT;
  if (override === "0" || override === "false") return { inside: false, label: null };
  if (override === "1" || override === "true") return { inside: true, label: "coding agent" };
  for (const [key, label] of HARNESS_ENV) {
    if (env[key]) return { inside: true, label };
  }
  return { inside: false, label: null };
}

export interface InstallCtx {
  cwd: string;
  scope: "user" | "project";
  force: boolean;
  dryRun: boolean;
  /** Bound project id to pin via `X-Project-Id` in the written MCP config, so the
   *  connection targets this project without relying on the OAuth consent pick.
   *  Omitted → the entry carries no header and the project is chosen at consent. */
  projectId?: string;
}

export interface McpResult {
  /** What happened: a written/updated file, a shell-out, or a manual step. */
  action: "wrote" | "updated" | "skipped" | "shell" | "manual" | "error";
  detail: string;
}

/** The exact `[mcp_servers.shipeasy]` block for a hand-edited `~/.codex/config.toml`.
 *  A bound project rides in the URL path — Codex's HTTP MCP config carries no
 *  headers, so the project-scoped URL is its only pin. */
export function codexTomlSnippet(projectId?: string): string {
  return ["[mcp_servers.shipeasy]", `url = "${mcpUrl(projectId)}"`].join("\n");
}

/** Where Codex keeps its (TOML) config — no JSON helper covers this one. */
export function codexConfigPath(): string {
  return join(homedir(), ".codex", "config.toml");
}

/**
 * Resolve the JSON MCP config path + wrapper key for the file-based agents.
 * Exported so `shipeasy mcp status`/`uninstall` can check the same paths
 * `registerMcp` writes, instead of re-deriving them independently.
 */
export function jsonMcpTarget(
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

/**
 * The project a previously written MCP entry pins, read back from the agent's
 * JSON config: the `X-Project-Id` header (legacy pin) or a project-scoped
 * `/p/<id>/mcp` URL. Lets `shipeasy upgrade` force-rewrite the entry into the
 * current format without dropping — and while upgrading — an existing pin.
 * Null for header-less agents (Codex TOML), an absent entry, or no pin.
 */
export function existingMcpProjectPin(agent: AgentId, ctx: InstallCtx): string | null {
  const target = jsonMcpTarget(agent, ctx);
  if (!target) return null;
  const cfg = readJsonConfig<Record<string, Record<string, unknown>>>(target.path);
  const entry = cfg?.[target.key]?.shipeasy as
    | { url?: unknown; headers?: Record<string, unknown> }
    | undefined;
  if (!entry) return null;
  const header = entry.headers?.["X-Project-Id"];
  if (typeof header === "string" && header) return header;
  const match =
    typeof entry.url === "string" ? /\/p\/([A-Za-z0-9_-]+)\/mcp$/.exec(entry.url) : null;
  return match ? match[1] : null;
}

function registerJsonMcp(
  target: { path: string; key: "mcpServers" | "servers" },
  ctx: InstallCtx,
): McpResult {
  const existing = readJsonConfig(target.path);
  const { config, replaced } = mergeMcpServer(
    existing,
    "shipeasy",
    serverSpec(ctx.projectId),
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
 * (else returns the TOML snippet to paste); Jules is connected from Antigravity's
 * (`agy`) MCP settings.
 */
export function registerMcp(agent: AgentId, ctx: InstallCtx): McpResult {
  const jsonTarget = jsonMcpTarget(agent, ctx);
  if (jsonTarget) return registerJsonMcp(jsonTarget, ctx);

  if (agent === "codex") {
    // Codex's HTTP MCP config only carries a URL (+ optional bearer-token env
    // var) — `codex mcp add` has no header flag — so the project-scoped URL is
    // how a bound project gets pinned (and pre-selected at OAuth consent).
    const url = mcpUrl(ctx.projectId);
    if (!onPath("codex")) {
      return {
        action: "manual",
        detail: `add to ~/.codex/config.toml:\n\n${codexTomlSnippet(ctx.projectId)}`,
      };
    }
    if (ctx.dryRun) {
      return {
        action: "shell",
        detail: `would run: codex mcp add shipeasy --url ${url}`,
      };
    }
    const res = spawnSync("codex", ["mcp", "add", "shipeasy", "--url", url], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (res.status !== 0) {
      return {
        action: "error",
        detail: `codex mcp add failed (${res.status ?? "?"}). Add manually:\n\n${codexTomlSnippet(ctx.projectId)}`,
      };
    }
    return { action: "shell", detail: `codex mcp add shipeasy` };
  }

  if (agent === "jules") {
    return {
      action: "manual",
      detail: `Jules runs locally in Google Antigravity (\`agy\`) — add the MCP server from Antigravity's settings pointing at ${mcpUrl(ctx.projectId)}. AGENTS.md covers the workflows in the meantime.`,
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
 * `claude` binary is available — this is the native, user-global path that
 * brings the MCP server, skills, and slash commands in one step. Reached only at
 * user scope (project scope keeps Claude in-repo via `.mcp.json`, see
 * `applyAgent`). Falls back to registering the scope's MCP config and printing
 * the manual commands when the `claude` binary isn't present.
 */
export function installClaudePlugin(ctx: InstallCtx): ClaudePluginResult {
  if (!onPath("claude")) {
    const mcp = registerMcp("claude", ctx);
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
