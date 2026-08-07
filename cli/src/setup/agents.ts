import { spawnSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve, sep } from "node:path";
import { mergeMcpServer, readJsonConfig, writeJsonConfig } from "../util/json-config";

/**
 * The coding agents `shipeasy setup` knows how to wire up. Detection mirrors
 * what wrangler does — look for the agent's binary on PATH and/or its
 * well-known config directory.
 *
 * Google ships THREE separate things and they are not interchangeable:
 *
 *  - **Antigravity** (`agy`) — the local agent CLI/IDE. Config under
 *    `~/.gemini/antigravity*`, MCP servers in `~/.gemini/config/mcp_config.json`.
 *  - **Gemini CLI** (`gemini`) — the local CLI, MCP servers in its own
 *    `settings.json` and manageable through `gemini mcp add`.
 *  - **Jules** (`jules`) — the ASYNC CLOUD agent. It has no local MCP surface to
 *    wire, so it is not an agent here at all; it is a *trigger* platform (see
 *    `triggers.ts`, where it is the `gemini` platform).
 *
 * This list used to carry a single `jules` entry that detected `agy` and then
 * wired nothing — all three conflated into one id that wrote no config. `jules`
 * survives only as an {@link AGENT_ALIASES} alias onto `antigravity`, which is
 * what that entry actually detected.
 */
export type AgentId = "claude" | "cursor" | "codex" | "copilot" | "antigravity" | "gemini";

/**
 * Accepted `--agents` spellings that aren't {@link AgentId}s. `jules` pointed at
 * the `agy` binary before Antigravity was its own entry, so it keeps resolving
 * to what it always detected rather than breaking a documented flag.
 */
export const AGENT_ALIASES: Record<string, AgentId> = { jules: "antigravity", agy: "antigravity" };

/** Resolve a raw `--agents` token to an {@link AgentId}, or null when unknown. */
export function normalizeAgentId(raw: string): AgentId | null {
  const v = raw.trim().toLowerCase();
  if (AGENT_ALIASES[v]) return AGENT_ALIASES[v];
  return (ALL_AGENT_IDS as readonly string[]).includes(v) ? (v as AgentId) : null;
}

/** Every wireable agent, in the order the picker lists them. */
export const ALL_AGENT_IDS = [
  "claude",
  "cursor",
  "codex",
  "copilot",
  "antigravity",
  "gemini",
] as const satisfies readonly AgentId[];

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
export function serverSpec(
  projectId?: string,
  bearer?: string,
): {
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
  // The bearer, when the caller passes one, is what makes the connection work
  // WITHOUT the OAuth browser round-trip — see `mcpBearer`. Never set for a
  // committable config: `mcpBearer` is the only thing allowed to decide that.
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return { type: "http", url: mcpUrl(projectId), "//list-guard": LIST_GUARD_NOTE, headers };
}

/**
 * Antigravity's remote-server entry. Same idea as {@link serverSpec}, different
 * spelling: its `mcp_config.json` names the endpoint **`serverUrl`** and has no
 * `type` discriminator (the transport is inferred from the URL). `headers` IS
 * supported, which is what lets the bearer and the project pin ride along —
 * `~/.gemini/config/mcp_config.json` is off-repo and private, so
 * {@link bearerForPath} allows the credential there.
 */
export function antigravityServerSpec(
  projectId?: string,
  bearer?: string,
): { serverUrl: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  if (projectId) headers["X-Project-Id"] = projectId;
  headers["X-Shipeasy-List-Guard"] = "off";
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  // NO `//list-guard` explainer here, unlike every other agent: `agy` is a Go
  // binary that uses `DisallowUnknownFields` somewhere in its decoders, and we
  // can't tell from outside whether `mcp_config.json` is one of them. A strict
  // decode would reject the WHOLE file over a comment key, taking the server
  // with it — the header still works, it's only the inline hint we give up.
  return { serverUrl: mcpUrl(projectId), headers };
}

/** The server entry to write for `agent`, in that agent's own schema. Gemini CLI
 *  writes the same `{type,url,headers}` shape as Claude/Cursor (verified against
 *  what `gemini mcp add -t http` itself writes), so only Antigravity differs. */
export function specForAgent(agent: AgentId, projectId?: string, bearer?: string): unknown {
  return agent === "antigravity"
    ? antigravityServerSpec(projectId, bearer)
    : serverSpec(projectId, bearer);
}

/**
 * Which agents get an `Authorization: Bearer <admin key>` header written into
 * their MCP entry, pre-authenticating the connection so nobody has to complete
 * the OAuth browser sign-in.
 *
 * The hosted server accepts a project admin key as a plain bearer (auth mode 1 —
 * it forwards the key to the admin API, which scopes it to the project), so a
 * registered header is a complete credential on its own.
 *
 * **That is exactly why this is gated on where the entry lands.** A bearer may
 * only be written into a file that is private to this machine's user:
 *
 *  - user/local scope (`~/.claude.json`, `~/.cursor/mcp.json`) — private ✓
 *  - the Copilot CLI's own `~/.copilot/mcp-config.json` — private ✓
 *  - project scope (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`) —
 *    **committable**, so a key written there would land in git and be shared
 *    with every teammate ✗
 *
 * Project scope therefore keeps the OAuth flow. Env-var indirection
 * (`Bearer ${SHIPEASY_MCP_TOKEN}`) was the obvious way around that and is a
 * trap: Claude stores the reference literally (good), but expands it from the
 * ambient shell — and when the variable is missing the server answers an
 * in-band "Unauthenticated" error rather than a 401 challenge, so the client
 * never falls back to OAuth. The user is left with a server that is configured,
 * trusted, and silently broken. A missing bearer is strictly better than a
 * dangling one.
 */
export function bearerForPath(path: string, ctx: InstallCtx): string | undefined {
  if (!ctx.mcpToken) return undefined;
  // The decision is made on the PATH, not the agent: anything under the repo is
  // committable by definition, and an agent can write more than one config
  // (Copilot writes both its private CLI config and the repo's .vscode one).
  // Keying off the agent instead let the token into `.vscode/mcp.json`.
  const root = resolve(ctx.cwd);
  const target = resolve(path);
  const inRepo = target === root || target.startsWith(root + sep);
  return inRepo ? undefined : ctx.mcpToken;
}

/**
 * Does this agent end up with a pre-authenticated surface? Drives the "skip the
 * browser sign-in" decision in setup's authorization step. The per-file
 * {@link bearerForPath} is what actually decides each write.
 */
export function mcpBearer(agent: AgentId, ctx: InstallCtx): string | undefined {
  if (!ctx.mcpToken) return undefined;
  // Both of Copilot's surfaces are private files now: the CLI's own
  // `~/.copilot/mcp-config.json`, and VS Code's user-profile `mcp.json`
  // ({@link vscodeUserMcpPath}). Neither is committable, so both carry the
  // bearer and neither needs the browser sign-in.
  if (agent === "copilot") return ctx.mcpToken;
  // Codex's TOML has no header field.
  if (agent === "codex") return undefined;
  const target = jsonMcpTarget(agent, ctx);
  return target ? bearerForPath(target.path, ctx) : undefined;
}

/** The `//list-guard` explainer, split out so the native-`claude mcp add` path
 *  can put it back: `claude mcp add`/`add-json` keep only the keys they know
 *  (verified against claude 2.1.220 — an unrecognised `//`-prefixed key is
 *  silently dropped), so the comment has to be re-merged after the shell-out. */
export const LIST_GUARD_NOTE =
  'Set the "X-Shipeasy-List-Guard" header to "on" to require a *_list before each ' +
  "*_create — a dedup guard so the agent confirms a resource doesn't already exist before " +
  'making one. "off" (default) disables it.';

/** The projectless default entry, kept for callers that don't scope a project. */
export const SERVER_SPEC = serverSpec();

export const MARKETPLACE_SLUG = "shipeasy-ai/shipeasy";

/**
 * How each agent is named to the `skills` CLI (`skills add … -a <name>`). One
 * agent can map to several names — Antigravity's IDE and its CLI keep separate
 * skill directories, and the `skills` CLI addresses them separately.
 *
 * Claude is intentionally absent: it receives skills via the native plugin
 * (marketplace + `plugin install`), so we never double-install through `skills`.
 * Antigravity can't take that route — `agy plugin install` resolves only
 * Google's own registered marketplaces (ours answers `unknown marketplace`), so
 * the `skills` CLI is its only path.
 */
export const SKILLS_CLI_AGENT: Partial<Record<AgentId, string[]>> = {
  cursor: ["cursor"],
  codex: ["codex"],
  // The `skills` CLI names GitHub Copilot `github-copilot` (bare `copilot`
  // errors "Invalid agents: copilot"). Our own AgentId stays `copilot`.
  copilot: ["github-copilot"],
  antigravity: ["antigravity", "antigravity-cli"],
  gemini: ["gemini-cli"],
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
  codex:
    "Codex: run `codex mcp login shipeasy` and approve in the browser (on a Codex without that subcommand, the server prompts on first tool use instead).",
  // Only ever printed when the bearer write didn't happen (no CLI session key
  // to hand over) — with one, both Copilot surfaces are pre-authenticated and
  // this step says nothing at all. See {@link vscodeUserMcpPath}.
  copilot:
    "VS Code (Copilot): open the MCP Servers view, start `shipeasy`, then approve in the browser.",
  // Both Google surfaces take the bearer in their `headers` object, so these are
  // only ever printed when setup had no CLI session key to hand over.
  antigravity:
    "Antigravity: Additional Options (…) → MCP Servers → `shipeasy`, then approve in the browser.",
  gemini: "Gemini CLI: run `gemini mcp list` to connect `shipeasy`, then approve in the browser.",
};

/**
 * Agents whose CLI can complete the MCP OAuth handshake for us, so setup runs
 * the authorization itself instead of telling the user to go click through a
 * settings pane. Each command opens the browser sign-in and exits when it's
 * approved. `pre` runs first (best-effort) to get the server out of "pending
 * approval" so `login` has something to authenticate against.
 *
 * Codex was listed as "authorizes itself on first tool use" — true of old
 * builds, and it meant setup printed a hint and opened nothing, leaving the user
 * to discover the sign-in at the first 401. `codex mcp login <name>` has shipped
 * since (0.142.5 here), and setup already registers the server with `codex mcp
 * add`, so there is something to log into by the time this runs. A Codex too old
 * for the subcommand exits non-zero and falls back to the printed instruction.
 *
 * Copilot, Antigravity and Gemini stay absent: Copilot authorizes from its own
 * UI, and the two Google clients have no `mcp login` at all — they don't need
 * one, because both take the bearer in their config's `headers` object and are
 * pre-authenticated by the time this step runs.
 */
export const MCP_AUTH_COMMANDS: Partial<Record<AgentId, { bin: string; pre?: string[][]; argv: string[] }>> =
  {
    claude: { bin: "claude", argv: ["mcp", "login", "shipeasy"] },
    cursor: {
      bin: "cursor-agent",
      pre: [["mcp", "enable", "shipeasy"]],
      argv: ["mcp", "login", "shipeasy"],
    },
    codex: { bin: "codex", argv: ["mcp", "login", "shipeasy"] },
  };

export interface McpAuthResult {
  /** authorized: the CLI completed OAuth (or was already authenticated).
   *  failed: it ran and errored. manual / unavailable: nothing we can run here,
   *  so the caller's instruction stands. */
  action: "authorized" | "failed" | "unavailable" | "manual";
  detail: string;
}

/**
 * Claude Code will not connect to — or log into — a `.mcp.json` server until the
 * user has approved it for that project ("⏸ Pending approval"), so a fresh
 * `claude mcp login shipeasy` exits 1 with *"is from .mcp.json and awaiting
 * approval"*. Approval is recorded per project in `.claude/settings.local.json`
 * as `enabledMcpjsonServers`, so setup writes it: the user already opted into
 * this server by choosing Claude here.
 *
 * `settings.local.json` (personal, gitignored) rather than the committed
 * `settings.json` on purpose — trusting a server is each developer's own call,
 * so a teammate cloning the repo still approves it themselves. Merges: other
 * keys and any already-enabled servers are preserved.
 */
export function approveProjectMcpServer(ctx: InstallCtx, name = "shipeasy"): McpResult {
  const path = join(ctx.cwd, ".claude", "settings.local.json");
  const cfg = readJsonConfig<Record<string, unknown>>(path) ?? {};
  const enabled = Array.isArray(cfg.enabledMcpjsonServers)
    ? (cfg.enabledMcpjsonServers as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  if (enabled.includes(name)) {
    return { action: "skipped", detail: `${name} already approved in ${path}` };
  }
  if (ctx.dryRun) return { action: "updated", detail: path };
  writeJsonConfig(path, { ...cfg, enabledMcpjsonServers: [...enabled, name] });
  return { action: "updated", detail: `approved ${name} in ${path}` };
}

/**
 * Claude's view of a configured server: pending approval, or already connected
 * (approved AND authenticated)? Null when we can't tell.
 *
 * NOTE this is resolved from the CWD — Claude reads its settings for the folder
 * you are standing in, so the same `.mcp.json` server reads `Connected` at the
 * repo root and `Pending approval` from a subdirectory. Always probe from the
 * folder we wrote `.mcp.json` into.
 */
export function claudeServerState(name: string): "pending" | "connected" | "other" | null {
  if (!onPath("claude")) return null;
  const res = spawnSync("claude", ["mcp", "get", name], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  return parseClaudeServerState(`${res.stdout ?? ""}${res.stderr ?? ""}`);
}

/** Parse `claude mcp get <name>` output. Split out from the spawn so the match
 *  against Claude's exact wording is testable without a `claude` binary. */
export function parseClaudeServerState(
  output: string,
): "pending" | "connected" | "other" | null {
  if (!output.trim()) return null;
  // "⏸ Pending approval (run `claude` to approve)" — check first: that line also
  // carries a "not connected"-ish status we must not read as connected.
  if (/pending approval|awaiting approval/i.test(output)) return "pending";
  if (/✔|connected/i.test(output)) return "connected"; // "✔ Connected"
  return "other";
}

/**
 * Authorize one agent's MCP connection by running that agent's own CLI. The
 * hosted server (mcp.shipeasy.ai) speaks OAuth 2.1, and each client owns its own
 * token store — so the only way to script this is to drive the client's login
 * command, which is exactly what this does. Inherits stdio: the login flow
 * prints a URL and waits for the browser approval.
 */
export function runMcpAuth(agent: AgentId, opts: { dryRun?: boolean } = {}): McpAuthResult {
  const cmd = MCP_AUTH_COMMANDS[agent];
  if (!cmd) return { action: "manual", detail: MCP_AUTH_INSTRUCTIONS[agent] };
  if (!onPath(cmd.bin)) {
    return { action: "unavailable", detail: `\`${cmd.bin}\` not on PATH — do it manually instead` };
  }
  const line = `${cmd.bin} ${cmd.argv.join(" ")}`;
  if (opts.dryRun) return { action: "authorized", detail: `would run: ${line}` };

  // Ask the client where it stands before driving a login at it — but skip the
  // login ONLY for a probe that proves authorization (`ready`). `reachable` must
  // not skip it: "✔ Connected" / "111 tools" hold for a server that has never
  // been authorized, and treating that as done is exactly how a session ends up
  // 401ing on its first tool call. Claude's still-pending `.mcp.json` entry is
  // the other way round — `claude mcp login` exits 1 against it (the project has
  // never been opened in Claude, so our approval write can't apply), so that
  // login must not run at all.
  const probe = probeMcpReady(agent);
  if (probe.state === "ready") {
    return { action: "authorized", detail: `already authorized — ${probe.detail}` };
  }
  if (probe.code === "pending-trust") return CLAUDE_PENDING;
  for (const pre of cmd.pre ?? []) {
    spawnSync(cmd.bin, pre, { stdio: ["ignore", "ignore", "ignore"] });
  }
  const res = spawnSync(cmd.bin, cmd.argv, { stdio: "inherit" });
  if (res.status === 0) return { action: "authorized", detail: line };
  // The login itself can be what discovers the pending state (`claude mcp login`
  // exits 1 with *"is from .mcp.json and awaiting approval"*). Its stdio is
  // inherited — we can't read that text without swallowing the OAuth URL the
  // user needs to see — so re-probe instead and report the fixable cause rather
  // than a bare exit code.
  if (agent === "claude" && claudeServerState("shipeasy") === "pending") return CLAUDE_PENDING;
  return { action: "failed", detail: `${line} exited ${res.status ?? "?"}` };
}

/**
 * Per-agent probe that answers the only question that matters after a login:
 * does this client actually resolve shipeasy tools right now?
 *
 * `runMcpAuth` can only report that a login command exited 0. This goes one step
 * further and asks the client to list the server's tools, which exercises the
 * whole chain — config entry, local approval, OAuth token, connection to
 * mcp.shipeasy.ai. Cheap enough to run inline (~0.7s).
 *
 * Codex reports a per-server `auth_status` — the only client whose CLI answers
 * the auth question at all. Cursor's tool listing and Claude's "Connected" both
 * report success for a server that has never been authorized (verified against
 * a throwaway entry: `ready` + all 111 tools, `✔ Connected`), because our own
 * discovery is anonymous — so those two can only ever reach `reachable`.
 * Gemini's `mcp list` reports a per-server connection state AND is the one place
 * its folder-trust gate becomes visible — see {@link parseGeminiMcpList}.
 * Copilot and Antigravity expose nothing scriptable and stay `unknown`.
 *
 * `parse` returns the verdict, or null to mean "this output isn't an answer" —
 * the caller then reports not-ready with the client's own first line.
 */
export const MCP_PROBE_COMMANDS: Partial<
  Record<AgentId, { bin: string; argv: string[]; parse: (out: string) => McpProbeResult | null }>
> = {
  cursor: {
    bin: "cursor-agent",
    argv: ["mcp", "list-tools", "shipeasy"],
    parse: (out) => {
      const count = parseCursorToolList(out);
      // `reachable`, NOT `ready`: this listing comes back identical whether or
      // not Cursor holds a token, so it can never stand in for authorization.
      return count === null
        ? null
        : { state: "reachable", detail: `${count} tools listed (auth not reported)`, toolCount: count };
    },
  },
  codex: {
    bin: "codex",
    argv: ["mcp", "list", "--json"],
    parse: (out) => {
      const status = parseCodexAuthStatus(out, "shipeasy");
      if (status === "o_auth") return { state: "ready", detail: "signed in (OAuth)" };
      if (status === "not_logged_in") return { state: "not-ready", detail: "not logged in" };
      // No `--json`, no such server, or a transport Codex marks `unsupported`:
      // nothing here is evidence the connection is broken.
      return { state: "unknown", detail: "Codex reports no OAuth state for this server" };
    },
  },
  gemini: {
    bin: "gemini",
    argv: ["mcp", "list"],
    parse: (out) => parseGeminiMcpList(out),
  },
};

/**
 * `gemini mcp list` for our server. Two things to read out of it:
 *
 *  1. Whether `shipeasy` is listed at all (`● shipeasy: <url> (http) - Connected`).
 *  2. Whether this folder is TRUSTED. Gemini suppresses MCP servers in an
 *     untrusted folder — *including user-scope ones* — and says so in a banner
 *     ("configured but disabled because this folder is untrusted"). The entry we
 *     just wrote is then present, correct, and inert, which reads as a broken
 *     install unless we name the real cause. We don't write
 *     `~/.gemini/trustedFolders.json` ourselves: trusting a folder is broader
 *     than approving one server (it bypasses tool-call confirmation for
 *     everything in it), so that stays the user's call — Gemini prompts for it
 *     on first run.
 *
 * `reachable`, never `ready`: like Cursor and Claude, the listing says nothing
 * about whether an OAuth credential is held.
 */
export function parseGeminiMcpList(output: string, name = "shipeasy"): McpProbeResult | null {
  if (!/configured MCP servers|no MCP servers configured/i.test(output)) return null;
  const untrusted = /folder is untrusted/i.test(output);
  const listed = new RegExp(`^\\s*\\S?\\s*${name}\\s*:`, "mi").test(output);
  if (!listed) return { state: "not-ready", detail: "not listed by `gemini mcp list`" };
  if (untrusted) {
    return {
      state: "not-ready",
      detail: "configured but disabled — this folder is untrusted (run `gemini` once to trust it)",
    };
  }
  return { state: "reachable", detail: "listed by Gemini (auth not reported)" };
}

export interface McpProbeResult {
  /**
   * - `ready` — the client says it holds an OAuth credential. The ONLY state
   *   that proves a tool call will work.
   * - `reachable` — the client connects and can list tools, which proves
   *   nothing about auth: mcp.shipeasy.ai answers `initialize`/`tools/list`
   *   anonymously and 401s only on `tools/call`, so an unauthorized server
   *   still reads "ready"/"Connected" and lists all 111 tools.
   * - `not-ready` — the client says it is not authorized.
   * - `unknown` — nothing here can tell (no probe, or the binary isn't on PATH).
   */
  state: "ready" | "reachable" | "not-ready" | "unknown";
  detail: string;
  /** Tools the client listed, when the probe reports a count. */
  toolCount?: number;
  /** A cause the caller acts on rather than reports. `pending-trust` is Claude's
   *  untrusted folder: a login against it cannot succeed, so it must not run. */
  code?: "pending-trust";
}

/** `cursor-agent mcp list-tools shipeasy` opens with `Tools for shipeasy (111):`.
 *  Split out from the spawn so the match against Cursor's wording is testable
 *  without the binary. Null when the output isn't a tool listing. */
export function parseCursorToolList(output: string): number | null {
  const m = /^\s*Tools for \S+ \((\d+)\)/m.exec(output);
  return m ? Number(m[1]) : null;
}

/**
 * `auth_status` for one server out of `codex mcp list --json` — `o_auth` once
 * signed in, `not_logged_in` before that, `unsupported` for a transport with no
 * OAuth (a local stdio server). Null when the output isn't the JSON we expect,
 * which is how an older `codex` without `--json` reads.
 */
export function parseCodexAuthStatus(output: string, name = "shipeasy"): string | null {
  const start = output.search(/[[{]/);
  if (start < 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.slice(start));
  } catch {
    return null;
  }
  const servers = Array.isArray(parsed)
    ? parsed
    : ((parsed as { servers?: unknown[] } | null)?.servers ?? []);
  const hit = servers.find(
    (s): s is { auth_status?: unknown } =>
      typeof s === "object" && s !== null && (s as { name?: unknown }).name === name,
  );
  return typeof hit?.auth_status === "string" ? hit.auth_status : null;
}

/**
 * Is `agent`'s shipeasy MCP connection live? Run right after authorization so
 * setup can state a fact instead of a hope — and so a session it launches next
 * can be told the tools are there rather than deciding for itself.
 */
export function probeMcpReady(agent: AgentId, opts: { dryRun?: boolean } = {}): McpProbeResult {
  if (opts.dryRun) return { state: "unknown", detail: "dry run — not probed" };

  if (agent === "claude") {
    const state = claudeServerState("shipeasy");
    // "✔ Connected" survives on a server that was never authorized, so it is
    // reachability, not authorization.
    if (state === "connected") return { state: "reachable", detail: "server connected" };
    if (state === "pending") {
      return { state: "not-ready", detail: "awaiting folder trust", code: "pending-trust" };
    }
    if (state === null) return { state: "unknown", detail: "`claude` not on PATH" };
    return { state: "not-ready", detail: "server not connected" };
  }

  const cmd = MCP_PROBE_COMMANDS[agent];
  if (!cmd) return { state: "unknown", detail: "no scriptable probe for this client" };
  if (!onPath(cmd.bin)) return { state: "unknown", detail: `\`${cmd.bin}\` not on PATH` };

  const res = spawnSync(cmd.bin, cmd.argv, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const verdict = cmd.parse(out);
  if (verdict) return verdict;
  return {
    state: "not-ready",
    detail: out.trim().split("\n")[0] || `exited ${res.status ?? "?"}`,
  };
}

/**
 * Not fixable from here: `.mcp.json` servers stay pending until the FOLDER is
 * trusted, and the trust dialog only exists in an interactive session.
 * `mcpAuthHandoff` offers to open one; this is the fallback wording.
 */
const CLAUDE_PENDING: McpAuthResult = {
  action: "manual",
  detail:
    "Claude hasn't trusted this folder yet, so its .mcp.json server is pending.\n" +
    "      Open `claude` here once and accept the trust prompt — the `shipeasy` server is\n" +
    "      pre-approved, so it connects; then `/mcp` → shipeasy → Authenticate.",
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

/** Detect every known agent in the current environment. `_cwd` is kept so
 *  callers keep passing the folder being set up — every signal we read today is
 *  machine-level (PATH + home config), none is repo-level. */
export function detectAgents(_cwd?: string): AgentInfo[] {
  const claudeBin = onPath("claude");
  const cursorBin = onPath("cursor");
  const codexBin = onPath("codex");
  const copilotBin = onPath("copilot");
  const agyBin = onPath("agy");
  const geminiBin = onPath("gemini");
  // Antigravity keeps its state under `~/.gemini/`, NOT `~/.antigravity` (which
  // an earlier version of this probed and which does not exist on any install
  // we've seen) — `antigravity-cli` for `agy`, `antigravity` for the IDE.
  const agyHome =
    homePathExists(".gemini", "antigravity-cli") || homePathExists(".gemini", "antigravity");
  // `~/.gemini` alone would ALSO be true for an Antigravity-only machine, since
  // that's where Antigravity lives too. `settings.json` is Gemini CLI's own.
  const geminiHome = homePathExists(".gemini", "settings.json");

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
      id: "antigravity",
      label: "Antigravity",
      detected: agyBin || agyHome,
      reason: agyBin
        ? "`agy` on PATH"
        : agyHome
          ? "~/.gemini/antigravity present"
          : "`agy` not found",
    },
    {
      id: "gemini",
      label: "Gemini CLI",
      detected: geminiBin || geminiHome,
      reason: geminiBin
        ? "`gemini` on PATH"
        : geminiHome
          ? "~/.gemini/settings.json present"
          : "`gemini` not found",
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
  /** The live CLI session key (`sdk_admin_…`), when setup has one. Registered as
   *  an `Authorization: Bearer` header — but ONLY into configs that stay private
   *  to this user; see {@link mcpBearer} for the rule and why it exists. */
  mcpToken?: string;
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
 * VS Code's **user-profile** `mcp.json` — the file behind *MCP: Open User
 * Configuration*, and the reason Copilot no longer needs a manual browser
 * sign-in.
 *
 * We used to write the repo's `.vscode/mcp.json`. That file is committable, so
 * {@link bearerForPath} (correctly) refuses to put a token in it — which left
 * VS Code with a credential-free entry, a 401 on first use, and a printed
 * "open the MCP Servers view and approve in the browser" instruction as the
 * only way through. The user-profile file is off-repo and private, exactly like
 * the Copilot CLI's `~/.copilot/mcp-config.json`, so the bearer is allowed
 * there: VS Code authenticates on the header, never sees a 401, and never
 * starts an OAuth flow at all.
 *
 * Dropping the repo file is also what clears the Copilot CLI's deprecation
 * banner — it removed `.vscode/mcp.json` support and warns on every session
 * that finds one (`gh.io/copilotcli-mcpmigrate`). The CLI is served by its own
 * user config, and a team-shared entry by the repo's `.mcp.json`, which the
 * CLI reads and Claude already writes — so nothing is lost with it gone.
 *
 * Default-profile path only. VS Code stores a non-default profile's servers in
 * `User/profiles/<id>/mcp.json`; on such a machine `code --add-mcp '<json>'`
 * is the profile-correct escape hatch (it takes the same `{name, type, url,
 * headers}` shape this writes).
 */
export function vscodeUserMcpPath(): string {
  const home = homedir();
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Code", "User", "mcp.json");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(appData, "Code", "User", "mcp.json");
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "Code", "User", "mcp.json");
}

/**
 * Drop a `shipeasy` entry left in the repo's `.vscode/mcp.json` by an older
 * setup run. Not housekeeping — a *correctness* step: VS Code layers workspace
 * config over the user profile, so a leftover credential-free entry would
 * shadow the pre-authenticated one {@link vscodeUserMcpPath} just wrote and put
 * the browser sign-in straight back. Removes the whole file when `shipeasy` was
 * the only server in it; otherwise keeps the others. Null when there is nothing
 * to clean.
 */
export function pruneVscodeWorkspaceMcp(ctx: InstallCtx): McpResult | null {
  const path = join(ctx.cwd, ".vscode", "mcp.json");
  const cfg = readJsonConfig<Record<string, unknown>>(path);
  const servers = cfg?.servers as Record<string, unknown> | undefined;
  if (!servers || !("shipeasy" in servers)) return null;
  if (ctx.dryRun) return { action: "updated", detail: `would drop shipeasy from ${path}` };
  const { shipeasy: _dropped, ...rest } = servers;
  if (Object.keys(rest).length === 0 && Object.keys(cfg!).length === 1) {
    rmSync(path, { force: true });
    return { action: "updated", detail: `removed ${path} (superseded by the user profile)` };
  }
  writeJsonConfig(path, { ...cfg, servers: rest });
  return { action: "updated", detail: `dropped shipeasy from ${path}` };
}

/**
 * Antigravity's GLOBAL MCP config. Documented at
 * https://antigravity.google/docs/mcp — a `{ "mcpServers": { … } }` map, same
 * wrapper key as Claude/Cursor, with per-server `serverUrl` + `headers`.
 *
 * Global only, regardless of `--scope`: Antigravity's other tier is
 * per-*plugin* (`plugins/<name>/mcp_config.json`), not per-repo, and we don't
 * ship a plugin — `agy plugin install` resolves only Google's own registered
 * marketplaces. Being off-repo is also what lets the entry carry the bearer.
 */
export function antigravityMcpPath(): string {
  return join(homedir(), ".gemini", "config", "mcp_config.json");
}

/**
 * Gemini CLI's settings file — user scope (`~/.gemini/settings.json`) or the
 * repo's own (`<cwd>/.gemini/settings.json`), matching `gemini mcp add --scope`.
 * Servers live under `mcpServers`, in the SAME `{type,url,headers}` shape Claude
 * and Cursor use (verified against what `gemini mcp add -t http` writes), so the
 * standard merge covers it.
 */
export function geminiSettingsPath(ctx: InstallCtx): string {
  return ctx.scope === "user"
    ? join(homedir(), ".gemini", "settings.json")
    : join(ctx.cwd, ".gemini", "settings.json");
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
      // VS Code's USER-profile `mcp.json`, under a `servers` key — NOT the
      // repo's `.vscode/mcp.json`. See {@link vscodeUserMcpPath} for why the
      // move; it is user-scope regardless of --scope, because the repo file
      // can't hold a credential and a *credential-free* entry is what forced
      // the manual browser sign-in this step exists to avoid.
      return { path: vscodeUserMcpPath(), key: "servers" };
    case "antigravity":
      return { path: antigravityMcpPath(), key: "mcpServers" };
    case "gemini":
      return { path: geminiSettingsPath(ctx), key: "mcpServers" };
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
    | { url?: unknown; serverUrl?: unknown; headers?: Record<string, unknown> }
    | undefined;
  if (!entry) return null;
  const header = entry.headers?.["X-Project-Id"];
  if (typeof header === "string" && header) return header;
  // `serverUrl` is Antigravity's spelling of `url` — see {@link antigravityServerSpec}.
  const url = typeof entry.url === "string" ? entry.url : entry.serverUrl;
  const match = typeof url === "string" ? /\/p\/([A-Za-z0-9_-]+)\/mcp$/.exec(url) : null;
  return match ? match[1] : null;
}

function registerJsonMcp(
  agent: AgentId,
  target: { path: string; key: "mcpServers" | "servers" },
  ctx: InstallCtx,
): McpResult {
  const existing = readJsonConfig(target.path);
  const { config, replaced } = mergeMcpServer(
    existing,
    "shipeasy",
    specForAgent(agent, ctx.projectId, bearerForPath(target.path, ctx)),
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
 * Register Claude's project-scope MCP entry through `claude mcp add` — the
 * native path, so the on-disk shape is whatever the installed Claude writes
 * today rather than our guess at it. Returns null when we can't take it
 * (`claude` off PATH, or user scope: `claude mcp add --scope user` writes
 * `~/.claude.json`, NOT the `~/.claude/settings.json` the rest of this file
 * reads and `shipeasy mcp status`/`uninstall` operate on).
 *
 * Idempotency is ours to enforce: `claude mcp add` **exits 1** on an existing
 * entry and leaves it untouched (there is no `--force`), so we check first and
 * only `claude mcp remove` when the caller asked to replace it.
 */
/** Render argv for display so a dry-run line is copy-pasteable — `--header`
 *  values carry a space (`X-Project-Id: p-1`) and would otherwise split. */
export function shellJoin(argv: string[]): string {
  return argv.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ");
}

/**
 * `claude mcp add …` for the pinned entry, as argv — the documented remote-server
 * form (`--transport http <name> <url> --header "<K>: <V>"`). Split out so tests
 * can assert the exact command without shelling out to a real Claude.
 *
 * Every header the entry needs rides on `--header`, including the
 * `Authorization: Bearer …` one when {@link mcpBearer} allows it for this scope.
 */
export function claudeMcpAddArgv(ctx: InstallCtx): string[] {
  const spec = serverSpec(ctx.projectId, mcpBearer("claude", ctx));
  return [
    "mcp",
    "add",
    "--transport",
    "http",
    "shipeasy",
    spec.url,
    // Always project: `addClaudeMcpNative` only takes this path at project
    // scope (user scope goes through the JSON merge, which targets the file
    // `shipeasy mcp status`/`uninstall` read).
    "--scope",
    "project",
    // Both pins ride along: the `/p/<id>/mcp` URL above and the explicit header.
    ...Object.entries(spec.headers).flatMap(([k, v]) => ["--header", `${k}: ${v}`]),
  ];
}

/**
 * `copilot mcp add …` for the same entry — the GitHub Copilot CLI takes the same
 * shape as Claude's (`--transport http <name> <url> --header "<K>: <V>"`,
 * verified against the shipped `copilot mcp add --help`).
 *
 * It has no scope flag: it always writes the CLI's own user config
 * (`~/.copilot/mcp-config.json`), which is off-repo and private — which is why
 * {@link mcpBearer} lets Copilot carry the bearer at either scope.
 */
export function copilotMcpAddArgv(ctx: InstallCtx): string[] {
  const spec = serverSpec(ctx.projectId, mcpBearer("copilot", ctx));
  return [
    "mcp",
    "add",
    "--transport",
    "http",
    "shipeasy",
    spec.url,
    ...Object.entries(spec.headers).flatMap(([k, v]) => ["--header", `${k}: ${v}`]),
  ];
}

/**
 * Register Copilot's server through its own CLI, so the Copilot **CLI** sees it
 * — it reads `~/.copilot/mcp-config.json`, `.mcp.json` or `.github/mcp.json`,
 * and (since it dropped `.vscode/mcp.json` support) nothing VS Code reads. The
 * two surfaces need two writes, so this runs in ADDITION to the JSON merge into
 * {@link vscodeUserMcpPath}, not instead of it. Null when `copilot` isn't on
 * PATH — the VS Code profile entry still lands.
 */
export function addCopilotMcpNative(ctx: InstallCtx): McpResult | null {
  if (!onPath("copilot")) return null;
  const argv = copilotMcpAddArgv(ctx);
  if (ctx.dryRun) return { action: "shell", detail: `would run: copilot ${shellJoin(argv)}` };
  // `add` refuses an existing name; a forced re-pin is remove-then-add. The
  // remove is best-effort — the add below reports the real outcome.
  if (ctx.force) {
    spawnSync("copilot", ["mcp", "remove", "shipeasy"], { stdio: ["ignore", "pipe", "pipe"] });
  }
  const res = spawnSync("copilot", argv, { cwd: ctx.cwd, stdio: ["ignore", "pipe", "pipe"] });
  if (res.status !== 0) {
    const why = `${res.stderr ?? ""}${res.stdout ?? ""}`.trim().split("\n")[0];
    // Already registered is the common non-zero here, and it isn't a failure.
    if (/already exists|already configured/i.test(why)) {
      return { action: "skipped", detail: "copilot CLI: already registered" };
    }
    return { action: "error", detail: `copilot mcp add failed (${res.status ?? "?"})${why ? `: ${why}` : ""}` };
  }
  return { action: "shell", detail: "copilot mcp add shipeasy (CLI user config)" };
}

/** The two `claude plugin …` invocations, as argv. Scope-parameterised: the
 *  same pair runs at project scope (declared in the repo's
 *  `.claude/settings.json`) and at user scope (`~/.claude`). */
export function claudePluginArgv(scope: "user" | "project"): {
  marketplace: string[];
  install: string[];
  marketplaceUpdate: string[];
  update: string[];
} {
  return {
    marketplace: ["plugin", "marketplace", "add", MARKETPLACE_SLUG, "--scope", scope],
    install: ["plugin", "install", "shipeasy@shipeasy", "--scope", scope],
    // The refresh pair. `marketplace add` + `plugin install` are both no-ops
    // once the plugin is present, so on their own they leave an ALREADY
    // INSTALLED plugin pinned at its cached version — which is how a Claude
    // user who ran `shipeasy upgrade` still ended up without a skill added to
    // the plugin since. `marketplace update` re-pulls the repo; `plugin update`
    // moves the install onto it.
    marketplaceUpdate: ["plugin", "marketplace", "update", "shipeasy"],
    update: ["plugin", "update", "shipeasy@shipeasy", "--scope", scope],
  };
}

/**
 * The `claude plugin …` invocations for one run, in order. A plain setup does
 * add + install; a forced run (`shipeasy upgrade`) interleaves the two refresh
 * commands, because add + install alone no-op on an existing install and leave
 * the plugin — and its skills — at the cached revision.
 */
export function claudePluginSteps(scope: "user" | "project", force: boolean): string[][] {
  const argv = claudePluginArgv(scope);
  return force
    ? [argv.marketplace, argv.marketplaceUpdate, argv.install, argv.update]
    : [argv.marketplace, argv.install];
}

export function addClaudeMcpNative(ctx: InstallCtx): McpResult | null {
  // User scope stays on the JSON merge: `claude mcp add --scope user` writes
  // `~/.claude.json`, NOT the `~/.claude/settings.json` that the rest of this
  // file — and `shipeasy mcp status`/`uninstall` — read.
  if (ctx.scope !== "project" || !onPath("claude")) return null;
  const target = jsonMcpTarget("claude", ctx);
  if (!target) return null;

  const existing = readJsonConfig<Record<string, Record<string, unknown>>>(target.path);
  const present = !!existing?.[target.key]?.shipeasy;
  if (present && !ctx.force) {
    return {
      action: "skipped",
      detail: `${target.path} already has a 'shipeasy' entry (use --force to replace)`,
    };
  }

  const argv = claudeMcpAddArgv(ctx);
  // `shell`, not wrote/updated: those prefix the detail with their own verb
  // ("wrote would run: …"). Same shape codex's dry-run returns.
  if (ctx.dryRun) return { action: "shell", detail: `would run: claude ${shellJoin(argv)}` };

  // `add` refuses to overwrite, so a forced re-pin is remove-then-add. A failing
  // remove is not fatal on its own — the add below reports the real outcome.
  if (present) {
    spawnSync("claude", ["mcp", "remove", "shipeasy", "--scope", "project"], {
      cwd: ctx.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  // cwd matters: `--scope project` resolves `.mcp.json` against the process's
  // working directory, not ours.
  const res = spawnSync("claude", argv, { cwd: ctx.cwd, stdio: ["ignore", "pipe", "pipe"] });
  if (res.status !== 0) {
    const why = `${res.stderr ?? ""}${res.stdout ?? ""}`.trim().split("\n")[0];
    return {
      action: "error",
      detail: `claude mcp add failed (${res.status ?? "?"})${why ? `: ${why}` : ""}`,
    };
  }

  // Put the `//list-guard` explainer back — `claude mcp add` keeps only the keys
  // it knows about, and that comment is how a reader discovers the header.
  const written = readJsonConfig<Record<string, Record<string, Record<string, unknown>>>>(
    target.path,
  );
  const entry = written?.[target.key]?.shipeasy;
  if (entry && entry["//list-guard"] !== LIST_GUARD_NOTE) {
    entry["//list-guard"] = LIST_GUARD_NOTE;
    writeJsonConfig(target.path, written!);
  }
  return { action: present ? "updated" : "wrote", detail: `${target.path} (claude mcp add)` };
}

/**
 * `gemini mcp add` argv. Gemini is the one client whose CLI takes BOTH the
 * transport and arbitrary headers on the command line (`-t http`, repeated
 * `-H "Name: value"`), so the native path can express everything the JSON merge
 * can — including the bearer and the project pin.
 *
 * Exported for the dry-run line and so the header shape is testable without the
 * binary. `--scope` mirrors our own: user scope writes `~/.gemini/settings.json`
 * (private → keeps the bearer), project scope writes the repo's
 * `.gemini/settings.json` (committable → {@link bearerForPath} withholds it).
 */
export function geminiMcpAddArgv(ctx: InstallCtx): string[] {
  const argv = ["mcp", "add", "shipeasy", mcpUrl(ctx.projectId), "-t", "http", "-s", ctx.scope];
  if (ctx.projectId) argv.push("-H", `X-Project-Id: ${ctx.projectId}`);
  argv.push("-H", "X-Shipeasy-List-Guard: off");
  const bearer = bearerForPath(geminiSettingsPath(ctx), ctx);
  if (bearer) argv.push("-H", `Authorization: Bearer ${bearer}`);
  return argv;
}

/**
 * Register Gemini's server through `gemini mcp add` — the native path, so the
 * on-disk shape is whatever the installed Gemini writes today. Unlike `claude
 * mcp add`, this one is idempotent (re-adding replaces the entry and exits 0),
 * so there's nothing to remove first. Null when `gemini` isn't on PATH, so the
 * caller falls back to merging the settings file itself.
 */
function addGeminiMcpNative(ctx: InstallCtx): McpResult | null {
  if (!onPath("gemini")) return null;
  const argv = geminiMcpAddArgv(ctx);
  if (ctx.dryRun) return { action: "shell", detail: `would run: gemini ${shellJoin(argv)}` };
  const res = spawnSync("gemini", argv, { cwd: ctx.cwd, stdio: ["ignore", "pipe", "pipe"] });
  if (res.status !== 0) {
    const why = `${res.stderr ?? ""}${res.stdout ?? ""}`.trim().split("\n")[0];
    return { action: "error", detail: `gemini mcp add failed (${res.status ?? "?"})${why ? `: ${why}` : ""}` };
  }
  return { action: "shell", detail: `gemini mcp add shipeasy (${ctx.scope} scope)` };
}

/**
 * Register the Shipeasy MCP server for one agent. Claude at project scope goes
 * through `claude mcp add` (falling back to the JSON merge when that isn't
 * available); the other JSON-config agents are merged idempotently; Codex
 * shells out to `codex mcp add` when the binary is present (else returns the
 * TOML snippet to paste); Gemini shells out to `gemini mcp add` and falls back
 * to the same merge; Antigravity is merged into its global `mcp_config.json`
 * (it has no `agy mcp` subcommand to drive).
 */
export function registerMcp(agent: AgentId, ctx: InstallCtx): McpResult {
  if (agent === "claude") {
    // Native first; a hard failure still falls through to the JSON merge below
    // rather than leaving the repo without an entry.
    const native = addClaudeMcpNative(ctx);
    if (native && native.action !== "error") return native;
  }
  if (agent === "copilot") {
    // Two consumers, two private configs: the VS Code extension reads the
    // user-profile `mcp.json` we merge below, the Copilot CLI reads its own
    // `~/.copilot/mcp-config.json`. Do both — and because both are off-repo,
    // both carry the bearer, so neither surface needs the OAuth round-trip.
    const jsonTarget = jsonMcpTarget(agent, ctx);
    const file = jsonTarget ? registerJsonMcp(agent, jsonTarget, ctx) : null;
    // Must run AFTER the profile write: a stale workspace entry would shadow it.
    const pruned = pruneVscodeWorkspaceMcp(ctx);
    const native = addCopilotMcpNative(ctx);
    const parts = [file?.detail, native?.detail, pruned?.detail].filter(Boolean);
    if (!file && !native) return { action: "error", detail: "no MCP target for copilot" };
    return {
      action: native?.action === "error" ? "error" : (file?.action ?? native!.action),
      detail: parts.join(" · "),
    };
  }
  if (agent === "gemini") {
    // Native first; a hard failure still falls through to the JSON merge below
    // rather than leaving the machine without an entry.
    const native = addGeminiMcpNative(ctx);
    if (native && native.action !== "error") return native;
  }

  const jsonTarget = jsonMcpTarget(agent, ctx);
  if (jsonTarget) return registerJsonMcp(agent, jsonTarget, ctx);

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

  return { action: "error", detail: `no MCP target for ${agent}` };
}

export interface ClaudePluginResult {
  action: "installed" | "manual" | "error";
  lines: string[];
}

/**
 * Install the Shipeasy Claude Code plugin (marketplace + plugin) when the
 * `claude` binary is available — the native path that brings skills and slash
 * commands in one step.
 *
 * Runs at BOTH scopes. `--scope project` declares the marketplace + plugin in
 * the repo's `.claude/settings.json`, so it stays as committable as the rest of
 * project scope; `--scope user` writes the same declaration under `~/.claude`.
 * Both commands are idempotent (re-running exits 0), so this is safe on a
 * repeat `shipeasy setup`.
 *
 * With `ctx.force` (what `shipeasy upgrade` passes) it also REFRESHES: both
 * commands above no-op on an existing install, so an upgrade would otherwise
 * leave the plugin — and every skill inside it — pinned at the cached version.
 *
 * Falls back to registering the scope's MCP config and printing the manual
 * commands when the `claude` binary isn't present.
 */
export function installClaudePlugin(ctx: InstallCtx): ClaudePluginResult {
  const argv = claudePluginArgv(ctx.scope);
  const manual = [`claude ${shellJoin(argv.marketplace)}`, `claude ${shellJoin(argv.install)}`];
  if (!onPath("claude")) {
    const mcp = registerMcp("claude", ctx);
    return {
      action: "manual",
      lines: [
        `MCP: ${mcp.action === "skipped" ? mcp.detail : `${mcp.action} ${mcp.detail}`}`,
        "`claude` not on PATH — install the plugin once Claude Code is available:",
        ...manual.map((l) => `  ${l}`),
      ],
    };
  }
  if (ctx.dryRun) {
    return {
      action: "installed",
      lines: claudePluginSteps(ctx.scope, Boolean(ctx.force)).map(
        (s) => `would run: claude ${shellJoin(s)}`,
      ),
    };
  }
  // cwd matters at project scope: both commands resolve `.claude/settings.json`
  // against the process's working directory.
  const opts: Parameters<typeof spawnSync>[2] = {
    cwd: ctx.cwd,
    stdio: ["ignore", "pipe", "pipe"],
  };
  const add = spawnSync("claude", argv.marketplace, opts);
  // `marketplace add` is idempotent-ish; a non-zero here is usually "already added".
  // Re-pull the marketplace BEFORE installing so a first install resolves the
  // latest revision rather than a stale clone from an earlier `add`.
  if (ctx.force) spawnSync("claude", argv.marketplaceUpdate, opts);
  const install = spawnSync("claude", argv.install, opts);
  if (install.status !== 0) {
    return {
      action: "error",
      lines: [
        `claude plugin install failed (${install.status ?? "?"}). Run manually:`,
        ...manual.map((l) => `  ${l}`),
        ...(add.stderr ? [`(marketplace add: ${add.stderr.toString().trim()})`] : []),
      ],
    };
  }
  const lines = [`plugin installed at ${ctx.scope} scope (marketplace + shipeasy@shipeasy)`];
  if (ctx.force) {
    // The bump for an ALREADY-installed plugin — `install` above exits 0
    // without moving it. Best-effort: a failure here still leaves a working
    // (if older) plugin, so it reports rather than fails the upgrade.
    const bump = spawnSync("claude", argv.update, opts);
    lines.push(
      bump.status === 0
        ? "plugin updated to the latest marketplace revision (restart Claude Code to apply)"
        : `plugin update failed (${bump.status ?? "?"}) — run: claude ${shellJoin(argv.update)}`,
    );
  }
  return { action: "installed", lines };
}
