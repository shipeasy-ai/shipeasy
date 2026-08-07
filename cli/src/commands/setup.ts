import { Command, Option } from "commander";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import prompts from "prompts";
import { login } from "../auth/login";
import {
  APP_BASE_URL,
  credentialsPath,
  credentialsSource,
  loadCredentials,
  type ShipeasyConfig,
} from "../auth/storage";
import { bindProject, getBoundProjectId } from "../util/project-config";
import { ApiError, getApiClient } from "../api/client";
import {
  type AgentId,
  type InstallCtx,
  type McpResult,
  MCP_AUTH_INSTRUCTIONS,
  ALL_AGENT_IDS,
  approveProjectMcpServer,
  claudeServerState,
  mcpBearer,
  normalizeAgentId,
  SKILLS_CLI_AGENT,
  detectAgents,
  detectHarness,
  installClaudePlugin,
  onPath,
  probeMcpReady,
  registerMcp,
  runMcpAuth,
} from "../setup/agents";
import {
  fetchSdkDoc,
  fetchSdkSkill,
  installMarketplaceSkills,
  installSkill,
} from "../setup/sdk-docs";
import {
  DOCS_DIRNAME,
  fetchDocBundle,
  planTopics,
  toReferenceDocs,
  writeDocBundle,
} from "../setup/doc-bundle";
import { ensureSkillsCli, setupSkillNames } from "../setup/skills-registry";
import {
  type FileResult,
  writeAgentsMd,
  writeCopilotInstructions,
  writeCursorRule,
} from "../setup/instructions";
import {
  actionableTargets,
  bindTargetDirs,
  checkPreconditions,
  clientKeyVar,
  ensureGitignored,
  envFileFor,
  gitInit,
  type InstallOutcome,
  keyLabel,
  maskKey,
  needsStoreMove,
  persistEnv,
  projectIdVar,
  relPath,
  RN_DEVTOOLS_PACKAGE,
  rnDevtoolsInstallArgv,
  runRnDevtoolsInstall,
  runSdkInstall,
  SERVER_KEY_VAR,
} from "../setup/onboard";
import {
  buildWiringDoc,
  type DevtoolsSurface,
  type WiringTarget,
} from "../setup/wiring-doc";
import { promptAndSend, reportConfigured } from "../setup/report-issue";
import { runPlanStep, type PlanStepResult } from "../setup/plan";
import { runTriggerStep, type TriggerStepResult, type CliSession } from "../setup/triggers";

/** Project the loaded CLI credentials onto the minimal session the trigger step
 *  needs (token + admin-API origin). Null-safe: no creds → no session. */
function sessionFromCreds(creds: ShipeasyConfig | null): CliSession | null {
  return creds
    ? { token: creds.cli_token, appBaseUrl: creds.app_base_url, userEmail: creds.user_email }
    : null;
}
import {
  BROWSER_FRAMEWORKS,
  detectTargets,
  targetSurface,
  type TargetRecommendation,
} from "./scan";
import { recordDetection } from "./detect";
import { enableModuleGroup, type EnableResult } from "./install";
import { withExamples, withDetails } from "../util/examples";
import { getPlatformModuleGates } from "../util/platform-gates";
import { bold, bullet, cyan, dim, format, wrapText, type WrapOpts } from "../util/format";

const ALL_AGENTS: readonly AgentId[] = ALL_AGENT_IDS;
const FEATURE_GROUPS = ["flags", "i18n", "ops"] as const;
type FeatureGroup = (typeof FEATURE_GROUPS)[number];

export const WIRING_FILENAME = "shipeasy-wiring.md";

interface SetupOpts {
  yes?: boolean;
  agents?: string;
  domain?: string;
  scope?: "user" | "project";
  env?: string;
  devtools?: boolean; // undefined → ask
  features?: string;
  skipInstall?: boolean;
  dryRun?: boolean;
  agentRun?: boolean; // commander --no-agent-run → false
  claudeRun?: boolean; // legacy alias of --no-agent-run
  bootstrap?: boolean; // commander --no-bootstrap → false (skip the instrumentation session)
  triggers?: boolean; // commander --triggers → true, --no-triggers → false, unset → ask
  triggerPlatform?: string;
  plan?: boolean; // commander --plan → true, --no-plan → false, unset → ask
}

/** App base URL of the admin dashboard we route the trigger wizard to.
 *
 *  The fallback must be `APP_BASE_URL` — the dashboard is served from the apex
 *  `shipeasy.ai`, and `app.shipeasy.ai` has never existed (NXDOMAIN, so the link
 *  doesn't even reach a 404 page). A run with no stored session — the common
 *  case, since the trigger step is reachable before anyone logs in — took that
 *  fallback and handed out a dead link. */
export function appBaseUrl(): string {
  return loadCredentials()?.app_base_url?.replace(/\/$/, "") ?? APP_BASE_URL;
}

// ── small print helpers ─────────────────────────────────────────────────────

/**
 * Every line setup prints goes through here: inline markdown (`**bold**`,
 * `` `code` ``, links) is rendered to ANSI and the leading ✓/✗/•/→ glyph is
 * coloured, so a long log can be scanned down its left margin.
 *
 * On a non-TTY — a pipe, CI, or a coding agent reading stdout — `format` is the
 * identity function, so the output stays exactly the plain markdown it was
 * authored as. That's what keeps the harness-facing text stable.
 */
function say(text = ""): void {
  console.log(format(text));
}

/** A wrapped explanation paragraph: authored as one string per paragraph and
 *  re-flowed to the terminal's width, instead of hard-wrapped at whatever
 *  column the source file happened to use. */
function explain(text: string, opts?: WrapOpts): void {
  say(wrapText(text, opts));
}

function heading(title: string): void {
  // Cyan step number + bold label, so steps stand out from body text without
  // needing extra blank lines. The rule measures the unstyled title.
  const m = /^(\d+[a-z]?\.)\s+(.*)$/.exec(title);
  const styled = m ? `${cyan(m[1]!)} ${bold(m[2]!)}` : bold(title);
  console.log(`\n${styled}\n${dim("─".repeat(title.length))}`);
}

/** First sentence of a skill description, capped so the install list stays scannable. */
function summarize(desc: string, max = 160): string {
  const firstSentence = desc.split(/(?<=[.!?])\s/)[0].trim();
  const s = firstSentence || desc.trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function formatMcp(r: McpResult): string {
  switch (r.action) {
    case "wrote":
      return `  ✓ MCP: wrote ${r.detail}`;
    case "updated":
      return `  ✓ MCP: updated ${r.detail}`;
    case "skipped":
      return `  • MCP: ${r.detail}`;
    case "shell":
      return `  ✓ MCP: ${r.detail}`;
    case "manual":
      return `  → MCP (manual): ${r.detail}`;
    case "error":
      return `  ✗ MCP: ${r.detail}`;
  }
}

function formatFile(label: string, r: FileResult): string {
  const verb = r.action === "skipped" ? "already current" : r.action;
  return `  ${r.action === "skipped" ? "•" : "✓"} ${label}: ${verb} ${r.action === "skipped" ? "" : r.path}`.trimEnd();
}

// ── per-agent wiring (exported for tests) ───────────────────────────────────

/**
 * Wire one agent: register its MCP server and write any agent-specific rules
 * file. Claude takes the native path at BOTH scopes — `claude plugin
 * marketplace add` + `claude plugin install` for skills and slash commands,
 * `claude mcp add` for the server — rather than us hand-writing the configs.
 * Returns the log lines to surface. Pure w.r.t. its inputs except for the file
 * writes / shell-outs the ctx requests (suppressed under dryRun).
 */
export function applyAgent(agent: AgentId, ctx: InstallCtx): string[] {
  const lines: string[] = [];
  if (agent === "claude") {
    const r = installClaudePlugin(ctx);
    lines.push(
      ...r.lines.map(
        (l) => `  ${r.action === "error" ? "✗" : r.action === "manual" ? "→" : "✓"} ${l}`,
      ),
    );
    // At project scope the plugin declaration lands in the repo's
    // `.claude/settings.json`, so it stays committable — but the plugin bundles
    // the UNPINNED `mcp.shipeasy.ai/mcp`, which would make the user pick a
    // project at OAuth consent. Register the project-pinned `/p/<id>/mcp` entry
    // alongside it so tools act on the bound project. (Trade-off: Claude then
    // lists both, `shipeasy` and `plugin:shipeasy:shipeasy` — the pinned one is
    // what we probe and authenticate.)
    if (ctx.scope === "project") {
      lines.push(formatMcp(registerMcp("claude", ctx)));
      // A `.mcp.json` server stays "⏸ Pending approval" until the user approves
      // it for this project — which blocks `claude mcp login` outright — so
      // record the approval they already gave by picking Claude here.
      lines.push(formatMcp(approveProjectMcpServer(ctx)));
    }
    return lines;
  }

  lines.push(formatMcp(registerMcp(agent, ctx)));
  if (agent === "cursor") lines.push(formatFile("rule", writeCursorRule(ctx)));
  if (agent === "copilot") lines.push(formatFile("instructions", writeCopilotInstructions(ctx)));
  return lines;
}

// ── auth + project binding ──────────────────────────────────────────────────

async function fetchProjectName(projectId: string): Promise<string | undefined> {
  try {
    const client = getApiClient();
    const p = await client.request<{ name?: string }>("GET", `/api/admin/projects/${projectId}`);
    return p.name;
  } catch {
    return undefined;
  }
}

/** Write `.shipeasy` for cwd to `projectId` and log it, calling out an override
 *  of a stale/ancestor binding. Used when a fresh cli-auth result must win: the
 *  project the user just picked/created is authoritative for this folder, and we
 *  bind it BEFORE minting keys so a stale binding can't shadow it. */
async function bindAuthoritative(projectId: string): Promise<string> {
  const name = await fetchProjectName(projectId);
  const prev = getBoundProjectId(process.cwd());
  const { path } = bindProject(process.cwd(), projectId, name);
  if (prev && prev !== projectId) {
    say(`  ✓ rebound ${path} → ${name ?? projectId} (was ${prev})`);
  } else {
    say(`  ✓ bound ${path} → ${name ?? projectId}`);
  }
  return projectId;
}

/**
 * Guarantee we end authenticated AND with `.shipeasy` bound for this folder, and
 * return the project id everything downstream (key minting, target binding) must
 * use. When the cli-auth browser flow runs, its result is the user's explicit,
 * final choice for this folder — we (re)write `.shipeasy` to it immediately,
 * overriding any stale or ancestor binding, so nothing downstream can resolve to
 * a different project. When `login` short-circuits (already authed), we honour an
 * existing binding and only prompt when the folder is still unbound.
 */
/**
 * Confirm the CLI session `login` left behind is one the NEXT process can read —
 * a stored `config.json`, not just this shell's env — and say where it is.
 *
 * Setup hands off to a coding agent that runs `shipeasy whoami`, `sdk keys list`
 * and `projects current` as its final gate. Those read credentials from disk, so
 * "we authenticated" has to mean "the file exists", not "the API call worked
 * once". `login` persists an env-only session for exactly this reason; this is
 * the check that it did.
 */
function reportCliSession(): void {
  const source = credentialsSource();
  if (source === "file") {
    say(`  ✓ CLI session stored → ${credentialsPath()}`);
    return;
  }
  explain(
    `authenticated, but nothing is stored at ${credentialsPath()} — \`shipeasy whoami\` ` +
      "will fail in any other shell. Run `shipeasy login` to store a session.",
    { first: "  ⚠ ", indent: "    " },
  );
}

/**
 * Verification-gate probe for the CLI session, branching on WHY it failed.
 *
 * Nothing expires here — a minted admin key is good for 90 days and step 2 ran a
 * minute ago — so a failure at this point is one of two very different things:
 *
 *  - **401/403**: the credential itself is rejected. Realistically that means it
 *    was revoked out from under the run (dashboard, `shipeasy logout` in another
 *    shell, or the per-(project,email) active-key cap reaping it). Signing in
 *    again genuinely fixes it, and the agent we hand off to can't run a browser
 *    flow, so do it here — but only when someone can complete it.
 *  - **anything else** (404 on a project this session can't see, a 5xx, a
 *    dropped connection): re-authenticating changes nothing. Report the actual
 *    status. The old code printed "run `shipeasy login`" for every one of these,
 *    which sent people through a browser flow to fix a 404.
 */
async function verifySession(projectId: string, canPrompt: boolean): Promise<[string, boolean]> {
  const probe = async (): Promise<unknown> => {
    try {
      await getApiClient().request("GET", `/api/admin/projects/${projectId}`);
      return null;
    } catch (err) {
      return err ?? new Error("unknown error");
    }
  };

  const failure = await probe();
  if (!failure) return [`session valid, project ${projectId} reachable`, true];

  const status = failure instanceof ApiError ? failure.status : 0;
  if (status !== 401 && status !== 403) {
    const detail = failure instanceof ApiError ? `${status}: ${failure.message}` : String(failure);
    return [`project ${projectId} unreachable (${detail}) — not an auth failure`, false];
  }
  if (!canPrompt) return ["CLI session rejected (401/403) — run `shipeasy login`", false];

  say("  • CLI session was rejected — re-authenticating so the hand-off works");
  try {
    await login({ force: true, projectId });
  } catch (err) {
    return [`re-login failed (${String(err)}) — run \`shipeasy login\``, false];
  }
  return (await probe())
    ? ["session still rejected after re-login — run `shipeasy login`", false]
    : [`session re-authenticated, project ${projectId} reachable`, true];
}

async function ensureAuthAndBind(interactive: boolean): Promise<string> {
  const first = await login({}); // idempotent; runs device flow + picker when no session
  if (first.ranBrowserFlow) return bindAuthoritative(first.projectId);

  const bound = getBoundProjectId(process.cwd());
  if (bound) return bound; // already authed + bound (pre-existing binding wins)

  const creds = loadCredentials();
  if (!creds) throw new Error("Authentication did not produce credentials.");

  if (!interactive) {
    const { path } = bindProject(process.cwd(), creds.project_id);
    say(`Bound this folder to project ${creds.project_id} → ${path}`);
    return creds.project_id;
  }

  const name = await fetchProjectName(creds.project_id);
  const { choice } = await prompts({
    type: "select",
    name: "choice",
    message: "This folder isn't bound to a Shipeasy project yet.",
    choices: [
      {
        title: `Use my current project${name ? ` (${name})` : ""} [${creds.project_id}]`,
        value: "current",
      },
      { title: "Pick a different project or create a new one (opens browser)", value: "pick" },
    ],
    initial: 0,
  });

  if (choice === "pick") {
    const picked = await login({ ensureBound: true });
    return bindAuthoritative(picked.projectId);
  }
  // default / "current"
  const { path } = bindProject(process.cwd(), creds.project_id, name);
  say(`Bound this folder to ${name ?? creds.project_id} → ${path}`);
  return creds.project_id;
}

// ── agent selection ─────────────────────────────────────────────────────────

async function selectAgents(opts: SetupOpts, interactive: boolean): Promise<AgentId[]> {
  const detected = detectAgents(process.cwd());

  for (const a of detected) {
    say(`  ${a.detected ? "✓" : "·"} ${a.label.padEnd(16)} ${a.reason}`);
  }

  // Explicit --agents wins. Resolved through `normalizeAgentId` so documented
  // aliases keep working (`jules` → `antigravity`, which is the agent that entry
  // always detected), and deduped so an alias plus its canonical id wire once.
  if (opts.agents) {
    const requested = opts.agents
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const unknown = requested.filter((r) => normalizeAgentId(r) === null);
    if (unknown.length) {
      throw new Error(`Unknown agent(s): ${unknown.join(", ")}. Known: ${ALL_AGENTS.join(", ")}`);
    }
    return [...new Set(requested.map((r) => normalizeAgentId(r)!))];
  }

  if (!interactive) {
    const auto = detected.filter((a) => a.detected).map((a) => a.id);
    say(
      auto.length
        ? `\nNon-interactive: wiring detected agents → ${auto.join(", ")}`
        : "\nNon-interactive: no agents detected; pass --agents to choose explicitly.",
    );
    return auto;
  }

  // Nothing preselected: wiring an agent writes real files into the repo (MCP
  // config, rules, skills), so it's an explicit choice, not something detection
  // opts you into. `min: 1` keeps enter-on-an-empty-list from silently wiring
  // nothing — the detected ones are still labelled, so picking is quick.
  const { picked } = await prompts({
    type: "multiselect",
    name: "picked",
    message: "Which coding agents should I wire Shipeasy into?",
    choices: detected.map((a) => ({
      title: a.detected ? `${a.label}  (detected)` : a.label,
      value: a.id,
      selected: false,
    })),
    min: 1,
    hint: "space to toggle, enter to confirm — pick at least one",
    instructions: false,
  });
  return (picked as AgentId[] | undefined) ?? [];
}

// ── scope selection (MCP + skills: in-repo vs user-global) ──────────────────

/**
 * Resolve where MCP config + skills land. An explicit `--scope` wins; otherwise
 * we default to in-repo `project` scope and, when interactive, confirm it and
 * offer user-global. Project scope keeps every artifact committable — for
 * Claude that means the plugin is declared in the repo's `.claude/settings.json`
 * and the project-pinned MCP entry in `.mcp.json`, rather than under `~/.claude`.
 */
async function resolveScope(
  opts: SetupOpts,
  interactive: boolean,
  dryRun: boolean,
): Promise<"user" | "project"> {
  if (opts.scope && opts.scope !== "user" && opts.scope !== "project") {
    throw new Error(`Invalid --scope '${opts.scope}'. Must be 'project' or 'user'.`);
  }
  if (opts.scope === "user" || opts.scope === "project") return opts.scope;
  if (!interactive || dryRun) return "project";
  const { scope } = await prompts({
    type: "select",
    name: "scope",
    message: "Where should the MCP server + skills be installed?",
    choices: [
      { title: "This project — in-repo, committable (recommended)", value: "project" },
      { title: "User-level — global, applies to all your repos", value: "user" },
    ],
    initial: 0,
  });
  return (scope as "user" | "project" | undefined) ?? "project";
}

// ── key minting ─────────────────────────────────────────────────────────────

interface KeyCreated {
  id: string;
  type: string;
  env?: string;
  key: string;
}

const VALID_ENVS = ["dev", "staging", "prod"] as const;

/**
 * Environment the minted keys read. `prod` unless `--env` says otherwise — we
 * don't ask: it's the right answer for a first install (the SDK reads live flag
 * state), and a wrong pick here is invisible until evaluations mysteriously
 * return defaults. Switching later is `shipeasy keys create --env <env>`.
 */
function resolveKeyEnv(opts: SetupOpts): string {
  if (opts.env) {
    if (!(VALID_ENVS as readonly string[]).includes(opts.env)) {
      throw new Error(`Invalid --env '${opts.env}'. Must be one of: ${VALID_ENVS.join(", ")}`);
    }
    return opts.env;
  }
  return "prod";
}

async function mintKey(
  type: "server" | "client",
  env: string,
  projectId: string,
  name: string,
): Promise<KeyCreated> {
  // Pass the resolved project id explicitly so the key is minted against the
  // project setup bound to cwd — never a re-walk of `.shipeasy` that could
  // resolve to an ancestor binding on a different (already-full) project.
  //
  // `name` carries provenance (stack · package · date · operator). Without it
  // the API falls back to a generic "minted via API by <email>" label, which
  // leaves a multi-app repo with a column of indistinguishable keys.
  const client = getApiClient(projectId, { requireBinding: true });
  return client.request<KeyCreated>("POST", "/api/admin/keys", { type, env, name });
}

// ── generic coding-agent handoff (any harness) ──────────────────────────────

const WIRING_PROMPT = `Read ${WIRING_FILENAME} at the repo root and complete every unchecked step, following its operating rules exactly.`;

/** CLI-launchable coding agents and how each takes a one-shot prompt. `id` ties
 *  the runnable back to the `AgentId` the user selected in step 3 so we only
 *  offer to launch what they chose.
 *
 *  Each launch passes the agent's "skip permission prompts" flag so it can
 *  complete the wiring steps (read the checklist, edit entry points, write env)
 *  unattended — the user already opted into this by choosing to launch an agent
 *  on the wiring file, and without it every file read/edit blocks on an approval
 *  prompt and the run stalls. Per-agent equivalent of Claude's
 *  `--dangerously-skip-permissions`:
 *    claude      → --dangerously-skip-permissions
 *    codex       → --dangerously-bypass-approvals-and-sandbox
 *    cursor      → --force
 *    copilot     → --allow-all-tools (kept with `-i`: interactive-with-prompt,
 *                  since `-p`/non-interactive can't be granted tool/path access)
 *    antigravity → --dangerously-skip-permissions (`agy` spells it the same)
 *    gemini      → --yolo
 *
 *  Copilot additionally launches in `--autopilot`. Permissions are only half of
 *  unattended: with tools allowed it still stops and hands the turn back after
 *  each step, and the wiring checklist is a dozen of them. Autopilot keeps it
 *  continuing on its own (up to `--max-autopilot-continues`, default 5) so the
 *  run works the file down instead of parking after the first edit.
 *
 *  The two Google clients take the prompt through `-i` (`--prompt-interactive`)
 *  rather than as a positional, the same shape Copilot needs: run this prompt,
 *  then stay in the session. Gemini also gets `--skip-trust`, which trusts the
 *  workspace FOR THIS SESSION only — without it the launched run stops on the
 *  folder-trust prompt, and until the folder is trusted Gemini suppresses every
 *  MCP server, including the `shipeasy` one step 10 just authorized. Session
 *  scope is the point: we still never write `~/.gemini/trustedFolders.json`,
 *  which would trust the folder for every future run. */
export const RUNNABLE_AGENTS: Array<{
  id: AgentId;
  label: string;
  bin: string;
  argv: (p: string) => string[];
}> = [
  {
    id: "claude",
    label: "Claude Code",
    bin: "claude",
    argv: (p) => ["--dangerously-skip-permissions", p],
  },
  {
    id: "codex",
    label: "OpenAI Codex",
    bin: "codex",
    argv: (p) => ["--dangerously-bypass-approvals-and-sandbox", p],
  },
  { id: "cursor", label: "Cursor", bin: "cursor-agent", argv: (p) => ["--force", p] },
  {
    id: "copilot",
    label: "GitHub Copilot",
    bin: "copilot",
    argv: (p) => ["--allow-all-tools", "--autopilot", "-i", p],
  },
  {
    id: "antigravity",
    label: "Antigravity",
    bin: "agy",
    argv: (p) => ["--dangerously-skip-permissions", "-i", p],
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    bin: "gemini",
    argv: (p) => ["--yolo", "--skip-trust", "-i", p],
  },
];

function spawnAgent(bin: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", () => resolve(1));
  });
}

/**
 * The hand-off block addressed to a coding agent that is CURRENTLY driving the
 * CLI: a self-contained, actionable prompt (not "here's how to launch one").
 * The agent reads this on stdout and acts on it directly. Kept in sync with
 * the wiring doc's own rules but condensed — the file is the full spec.
 */
export function agentDirective(root: string): string {
  return [
    "════════════════════════════════════════════════════════════════",
    "▶ CODING AGENT — finish the onboarding now.",
    "",
    `The remaining, judgement-requiring steps are written to:`,
    `  ${join(root, WIRING_FILENAME)}`,
    "",
    "Read that file and complete EVERY unchecked item, in order, following",
    "its operating rules. In brief:",
    "  • Do the work yourself — run the shell commands; don't delegate to the user.",
    "  • Never print, log, or commit a key value (sdk_server_* / sdk_client_*).",
    "  • Exactly one configure(...) per runtime at the entry point; no wrapper files.",
    `  • The SDK docs for what you enabled were pulled into ${DOCS_DIRNAME}/ — read the`,
    "    page for a step before doing it; it is newer than these notes and wins.",
    "  • Anything else: `shipeasy docs get --sdk <lang> <page>`.",
    "  • Honour every verification gate; self-heal once, then stop and report.",
    "  • Never push. Don't commit either, until the Cleanup step asks the user.",
    `  • Finish at Cleanup: ask whether to delete ${WIRING_FILENAME} +`,
    `    ${DOCS_DIRNAME}/ and commit — then do exactly what they answer.`,
    "════════════════════════════════════════════════════════════════",
  ].join("\n");
}

/** What this run actually asked for, in the terms the wiring doc will act on.
 *  Feeds the plain-English "here's what the agent is about to do" block. */
export interface WiringPlan {
  targets: WiringTarget[];
  /** Devtools surfaces accepted this run — empty when declined. */
  devtools: DevtoolsSurface[];
  features: string[];
}

/**
 * The plain-English list of what the wiring agent will do, derived from THIS
 * run's choices (targets, overlay, enabled modules) rather than a canned blurb —
 * so the confirmation before we hand over the terminal is honest about the edits
 * that are coming. Mirrors the sections `buildWiringDoc` emits.
 */
export function wiringPlanLines(plan: WiringPlan): string[] {
  const lines: string[] = [];
  const dirs = plan.targets.map((t) => (t.relPath === "." ? "the repo root" : `${t.relPath}/`));
  const pending = plan.targets.filter((t) => !t.sdkInstalled && t.installCmd);
  if (pending.length) {
    lines.push(
      `finish the SDK package install in ${pending
        .map((t) => (t.relPath === "." ? "the repo root" : `${t.relPath}/`))
        .join(", ")}`,
    );
  }
  if (plan.targets.length) {
    lines.push(
      `configure the SDK once at the startup entry point in ${dirs.join(", ")} (server key from env)`,
      "wire your user identity + targeting attributes into the SDK, read from your own auth/session model",
    );
  }
  if (plan.targets.some((t) => t.browser && !t.native)) {
    lines.push(
      "add the browser <head> tags — the runtime tag that carries this request's evaluated flags to the page, emitted by your SDK's own tag helper",
    );
  }
  // Only a JS/TS target has a browser bundle to initialise — elsewhere the head
  // tag above IS the browser side, and there is no npm client to call.
  if (
    plan.targets.some(
      (t) => t.browser && !t.native && (t.sdk === "typescript" || t.sdk === "javascript"),
    )
  ) {
    lines.push("initialise the browser SDK with the public client key");
  }
  if (plan.targets.some((t) => t.secretStoreMove)) {
    lines.push("move the minted keys into this project's idiomatic secret store");
  }
  if (plan.devtools.includes("browser")) {
    lines.push(
      "include the devtools overlay tag in that same <head> block (the ?se=1 panel + end-user bug reports)",
    );
  }
  if (plan.devtools.includes("react-native")) {
    lines.push(
      "mount the React Native devtools overlay at your app root, wired to a deep-link scheme this app registers (shake to open + in-app bug reports)",
    );
  }
  if (plan.features.includes("ops")) {
    lines.push("report caught errors through the SDK's see() primitive so they reach your ops queue");
  }
  if (plan.features.includes("i18n")) {
    lines.push("wrap user-facing copy as translatable i18n keys");
  }
  lines.push(
    "check the app still builds, then ask whether to clean up the setup artifacts and commit — it never pushes, and never commits unless you say yes",
  );
  return lines;
}

/**
 * Offer to hand `prompt` to one of the agents the user wired in step 3, then
 * run it in this terminal. Shared by the wiring hand-off (step 11) and the
 * instrumentation bootstrap (step 12) — both hand a written brief to a harness
 * that runs with permission prompts disabled, so both need the same gate: say
 * what it will do, ask once, and let the user pick which agent.
 *
 * Returns true when an agent actually ran.
 */
async function offerAgentRun(
  selected: AgentId[],
  prompt: string,
  opts: SetupOpts,
  interactive: boolean,
  message: string,
): Promise<boolean> {
  const available = RUNNABLE_AGENTS.filter((a) => selected.includes(a.id) && onPath(a.bin));
  const noRun = opts.agentRun === false || opts.claudeRun === false || opts.dryRun;
  if (!interactive || noRun || available.length === 0) return false;

  const { ok } = await prompts({ type: "confirm", name: "ok", message, initial: true });
  if (!ok) return false;

  // One available agent → just run it; several → let the user say which.
  let chosen = available[0]!;
  if (available.length > 1) {
    const { pick } = await prompts({
      type: "select",
      name: "pick",
      message: "Which agent should run it?",
      choices: [
        ...available.map((a) => ({ title: `${a.label} (${a.bin})`, value: a.bin })),
        { title: "None — I'll run it myself later", value: "" },
      ],
      initial: 0,
    });
    const picked = available.find((a) => a.bin === pick);
    if (!picked) return false;
    chosen = picked;
  }

  say(`\nLaunching: ${chosen.bin} …\n`);
  const code = await spawnAgent(chosen.bin, chosen.argv(prompt));
  if (code !== 0) say(`\n${chosen.bin} exited with code ${code}. You can re-run it anytime.`);
  return code === 0;
}

/**
 * The hand-off addressed to a HUMAN at a terminal: plain instructions. The
 * code edits are best done by an assistant, so we show how to hand the file
 * off — and (interactively) explain exactly what it will change, then offer to
 * launch one that's on PATH.
 */
async function humanHandoff(
  root: string,
  opts: SetupOpts,
  interactive: boolean,
  selected: AgentId[],
  plan: WiringPlan,
): Promise<void> {
  // Only offer to launch agents the user chose in step 3 that are also on PATH.
  const available = RUNNABLE_AGENTS.filter((a) => selected.includes(a.id) && onPath(a.bin));
  explain(
    `The remaining steps edit your code (entry-point SDK init, and so on), so they're best ` +
      `handed to a coding assistant. Either open \`${WIRING_FILENAME}\` and work the checklist ` +
      `yourself, or pass it to an assistant:`,
  );
  say();
  for (const a of RUNNABLE_AGENTS) {
    const argv = a
      .argv(WIRING_PROMPT)
      .map((s) => (s.startsWith("-") ? s : JSON.stringify(s)))
      .join(" ");
    say(`    \`${a.bin} ${argv}\``);
  }
  say();
  explain(`…or paste \`${WIRING_FILENAME}\` into your IDE's assistant`);

  const noRun = opts.agentRun === false || opts.claudeRun === false || opts.dryRun;
  if (!interactive || noRun || available.length === 0) return;

  // Say what the agent is about to change BEFORE we hand it the terminal — it
  // runs with permission prompts disabled, so this is the user's one gate.
  say();
  explain(
    "We'll now launch your coding agent to wire Shipeasy into the app, using the settings " +
      "you chose here, to complete the installation. **It would:**",
  );
  say();
  for (const line of wiringPlanLines(plan)) say(bullet(line));
  say();

  await offerAgentRun(selected, WIRING_PROMPT, opts, interactive, "OK to launch it now?");
}

/**
 * The one-time MCP OAuth authorization step. The hosted MCP server
 * (mcp.shipeasy.ai) authenticates with OAuth 2.1 — a browser sign-in per client,
 * no key to paste. Where the agent ships a login command (`claude mcp login`,
 * `cursor-agent mcp login`) setup RUNS it, so the user never has to go find a
 * settings pane; the rest get the printed one-liner. A coding agent driving the
 * CLI gets a directive to authorize its OWN connection instead (we must not
 * hijack its terminal with a browser flow). Runs BEFORE the wiring hand-off so
 * the credential is in place for whichever session picks up shipeasy-wiring.md.
 *
 * What authorizing CANNOT do is inject the tools into a session that is already
 * open: every client reads its MCP servers once, at startup. So the copy here
 * promises the *next* session, and the wiring doc opens by having the agent
 * probe for the tools rather than assume either way.
 */
/**
 * The prompt queued behind Claude's trust dialog, exactly as the wiring hand-off
 * passes {@link WIRING_PROMPT}.
 *
 * It is `/exit` on purpose. Trust is the ONE thing no config file can grant — it
 * only appears in an interactive session — so the session exists to collect that
 * single keystroke and nothing else. Claude runs a positional prompt as soon as
 * the dialog clears, so `/exit` closes the session the instant trust is
 * accepted: the user answers one prompt and lands back in `shipeasy setup`,
 * instead of being parked in a chat REPL they have to know how to leave.
 *
 * (It used to be `/mcp`, which opened the MCP panel and left the user inside
 * Claude — the authorization it was there to start is now its own step, driven
 * from here by `claude mcp login`, so the session has no reason to stay open.)
 */
export const TRUST_SESSION_PROMPT = "/exit";

/**
 * Whether Claude still needs this folder trusted. Until the user accepts that
 * dialog, a `.mcp.json` server reads "⏸ Pending approval" no matter what
 * `enabledMcpjsonServers` says — and `claude mcp login` exits 1 against it — so
 * this is the gate that decides whether the trust step has anything to do.
 */
export function claudeNeedsTrust(selected: AgentId[]): boolean {
  if (!selected.includes("claude") || !onPath("claude")) return false;
  return claudeServerState("shipeasy") === "pending";
}

/**
 * Step 9 — trust this folder in Claude, on its own.
 *
 * It was previously a detour inside the authorization step, triggered only when
 * a `claude mcp login` came back pending. That buried a hand-the-terminal-over
 * moment inside another step's output, and made the ordering confusing: you
 * can't authorize a server that isn't trusted yet, so trust is a *precondition*
 * of authorization, not a fallback from it.
 *
 * The session auto-exits ({@link TRUST_SESSION_PROMPT}), so all the user does is
 * accept one dialog. Returns true when the folder ends up trusted.
 */
async function trustClaudeStep(interactive: boolean, dryRun: boolean): Promise<boolean> {
  explain(
    "Claude only shows its **trust this folder** prompt inside an interactive session, and " +
      "until you accept it the repo's `.mcp.json` server stays pending — which blocks the " +
      "sign-in in the next step. I can open Claude here to collect exactly that one answer:",
  );
  say();
  say(bullet("accept the trust prompt (the `shipeasy` server is already approved)"));
  say(bullet(`the session runs \`${TRUST_SESSION_PROMPT}\` and closes itself — you come straight back here`));
  say();

  if (dryRun) {
    say(`  (dry run — would run \`claude ${TRUST_SESSION_PROMPT}\` to collect the trust prompt)`);
    return false;
  }
  if (!interactive) {
    say("  • non-interactive — open `claude` here once and accept the trust prompt, then re-run");
    return false;
  }

  const { open } = await prompts({
    type: "confirm",
    name: "open",
    message: "Open Claude here now to trust the folder?",
    initial: true,
  });
  if (!open) {
    say("  • skipped — the `shipeasy` server stays pending until this folder is trusted");
    return false;
  }

  say(`\nLaunching: claude ${TRUST_SESSION_PROMPT} …\n`);
  await spawnAgent("claude", [TRUST_SESSION_PROMPT]);

  if (claudeServerState("shipeasy") === "pending") {
    say("  ✗ still pending — the trust prompt wasn't accepted");
    return false;
  }
  say("  ✓ folder trusted — the `shipeasy` server is out of pending approval");
  return true;
}

export interface McpAuthOutcome {
  /**
   * Agents whose shipeasy MCP connection setup could confirm is live — either
   * pre-authenticated by a bearer header, or probed with the client's own tool
   * listing. Handed to the wiring doc so a session launched next is told the
   * tools are there instead of deciding for itself (and defaulting to the CLI).
   */
  verified: AgentId[];
}

export async function mcpAuthHandoff(
  selected: AgentId[],
  interactive: boolean,
  opts: { dryRun?: boolean; ctx?: InstallCtx } = {},
): Promise<McpAuthOutcome> {
  // Caller owns the step heading — this is step 10 of `shipeasy setup`, and the
  // "no agents wired" case still needs the heading printed above it.
  if (selected.length === 0) return { verified: [] };

  // Anything whose entry already carries `Authorization: Bearer …` is done — the
  // header IS the credential, so there is no browser round-trip to make.
  //
  // Copilot used to get the note but stay on the list: the bearer went into its
  // CLI's user config, while the `.vscode/mcp.json` written for the VS Code
  // extension is committable and therefore credential-free — CLI authorized,
  // IDE still signing in by hand. Setup now writes VS Code's *user-profile*
  // mcp.json instead (off-repo, so it carries the bearer too), so both surfaces
  // are done here and there is no browser step left to instruct.
  const preAuthed = opts.ctx ? selected.filter((id) => mcpBearer(id, opts.ctx!)) : [];
  const needsOauth = selected.filter((id) => !preAuthed.includes(id));
  for (const id of preAuthed) {
    say(
      id === "copilot"
        ? "  ✓ copilot: pre-authenticated — the CLI and VS Code configs both carry your session key"
        : `  ✓ ${id}: pre-authenticated — its MCP entry carries your CLI session key`,
    );
  }
  if (!needsOauth.length) return { verified: preAuthed };

  explain(
    "The hosted Shipeasy MCP server (mcp.shipeasy.ai) authenticates with **OAuth** — a " +
      "one-time browser sign-in per client, no key to paste. Authorizing it now, so the next " +
      "session each client starts has the MCP tools. A session that is ALREADY open (including " +
      "one driving this terminal) reads its MCP servers at startup — it has to be restarted " +
      "before the shipeasy tools show up in it.",
  );
  say();

  if (detectHarness().inside) {
    // A coding agent is driving this terminal — we must not seize it with a
    // browser flow, so it authorizes its own connection from the instructions.
    //
    // Probe first: the client's token store is per-machine, so it is often
    // ALREADY authorized from an earlier run, and the honest instruction then is
    // "restart to pick the tools up", not "go do OAuth again". Only the ones we
    // can't confirm get the Authenticate one-liner — printed verbatim, one per
    // line, because a coding agent reads these back and acts on them.
    const live = needsOauth.filter((id) => {
      const p = probeMcpReady(id, { dryRun: opts.dryRun });
      if (p.state === "ready") say(`  ✓ ${id}: already authorized — ${p.detail}`);
      return p.state === "ready";
    });
    const pending = needsOauth.filter((id) => !live.includes(id));
    for (const id of pending) say(`    • ${MCP_AUTH_INSTRUCTIONS[id]}`);
    say();
    explain(
      pending.length
        ? "▶ **CODING AGENT: authorize your OWN shipeasy MCP connection now** — run your " +
            "client's MCP Authenticate step (above) and approve in the browser BEFORE starting " +
            "the wiring steps, or every shipeasy_* tool call will 401. Authorizing does NOT add " +
            "the tools to the session you are in right now: MCP servers load at session start, " +
            "so if you still have no shipeasy tools, ask the user to restart this session — and " +
            "use the `shipeasy` CLI for the steps meanwhile if they'd rather not."
        : "▶ **CODING AGENT: your client is already authorized** — no browser step to run. If " +
            "this session lists no shipeasy tools, it started before the server was wired (MCP " +
            "servers load at session start): ask the user to restart it, and use the `shipeasy` " +
            "CLI for the steps meanwhile if they'd rather not.",
    );
    return { verified: [...preAuthed, ...live] };
  }

  // Drive each agent's own login command where one exists — that's the whole
  // point: no hand-configuration. Only what's left over (Copilot, or
  // a binary that isn't on PATH) gets an instruction to follow by hand.
  const manual: AgentId[] = [];
  for (const id of needsOauth) {
    // A pending Claude server means the folder still isn't trusted. That's the
    // previous step's job now — `runMcpAuth` reports it as a manual step with
    // the wording to fix it, rather than this loop opening a Claude session
    // mid-authorization.
    const r = runMcpAuth(id, { dryRun: opts.dryRun });
    if (r.action === "authorized") {
      say(`  ✓ ${id}: ${r.detail}`);
      continue;
    }
    if (r.action === "failed") say(`  ✗ ${id}: ${r.detail} — do it by hand:`);
    else if (r.action === "unavailable") say(`  • ${id}: ${r.detail}:`);
    else if (id === "claude") say(`  • claude: ${r.detail}`);
    else say(`    • ${MCP_AUTH_INSTRUCTIONS[id]}`);
    manual.push(id);
  }

  if (interactive && !opts.dryRun && manual.length) {
    await prompts({
      type: "confirm",
      name: "done",
      message: `Press Enter once you've authorized ${manual.join(", ")} (or skip to do it later)`,
      initial: true,
    });
  }

  // Verify rather than assume, while there is still a user here to fix it. A
  // login command exiting 0 is not proof the connection resolves, and the next
  // step launches a session that has to trust this — so ask each client to list
  // the server's tools and report what came back.
  const verified: AgentId[] = [...preAuthed];
  for (const id of needsOauth) {
    const p = probeMcpReady(id, { dryRun: opts.dryRun });
    if (p.state === "ready") {
      verified.push(id);
      say(`  ✓ ${id}: shipeasy MCP authorization verified — ${p.detail}`);
    } else if (p.state === "not-ready") {
      say(`  ✗ ${id}: shipeasy MCP not authorized (${p.detail})`);
      say(`      ${MCP_AUTH_INSTRUCTIONS[id]}`);
    } else if (p.state === "reachable") {
      // Say what was and wasn't established. This client answers "connected"
      // and lists every tool without holding a token — so a ✓ here would be a
      // lie, and silence would read as a pass.
      say(`  • ${id}: server reachable (${p.detail}) — this client reports no auth state,`);
      say(`      so authorization can't be confirmed here. If a tool call comes back`);
      say(`      Unauthorized: ${MCP_AUTH_INSTRUCTIONS[id]}`);
    }
    // `unknown` stays silent: no probe exists for that client, and a line
    // reading "couldn't check" only adds noise to a step that already told the
    // user what to do.
  }
  return { verified };
}

/**
 * Branch the wiring hand-off on WHO is reading stdout: a coding agent driving
 * the CLI gets an actionable directive it can execute; a human at a terminal
 * gets plain instructions plus an optional launch picker.
 */
async function wiringHandoff(
  root: string,
  opts: SetupOpts,
  interactive: boolean,
  selected: AgentId[],
  plan: WiringPlan,
): Promise<void> {
  if (detectHarness().inside) {
    say(agentDirective(root));
    return;
  }
  await humanHandoff(root, opts, interactive, selected, plan);
}

// ── instrumentation bootstrap (step 12) ─────────────────────────────────────

/**
 * One thing the bootstrap session can instrument, gated on the module that
 * makes it work server-side. Enabling a module only turns the *backend* on —
 * the events, `see()` calls and thresholds it needs still have to be derived
 * from this specific codebase, which is exactly the judgement a harness with
 * the repo in front of it can do and a CLI cannot.
 */
export interface BootstrapTask {
  key: "errors" | "metrics";
  /** The module group (from `--features` / step 7) this task needs. */
  requires: string;
  /** One line shown to the user before the terminal is handed over. */
  summary: string;
  /** Skills carrying the required call forms — installed in steps 5b/7. */
  skills: string[];
  /** The task's section of the prompt. */
  instructions: string;
}

const BOOTSTRAP_TASKS: BootstrapTask[] = [
  {
    key: "errors",
    requires: "ops",
    summary:
      "find every place this app already handles or swallows a failure, and report the ones that matter through see() so they reach your ops queue",
    skills: ["shipeasy-see", "shipeasy-ops"],
    instructions: `TASK — error tracking (the ops module is enabled)

Load the **shipeasy-see** skill BEFORE you edit any code: it carries the required
call form and the consequence grammar, and getting those wrong is worse than not
instrumenting at all.

1. Inventory how this app currently deals with failure. Look for every catch /
   rescue / except block, error middleware, unhandled-rejection or panic handler,
   and every place an error is swallowed outright or dumped to console.error /
   logger.error / print. List what you found before changing anything.
2. Instrument the ones that matter, with the language-correct call from the skill
   (\`shipeasy docs get --sdk <lang> error-reporting\` for the exact signature).
   Prioritise, in order: paths that lose user data or money; auth, payment and
   checkout flows; background jobs and queue consumers whose failures are silent;
   anything currently swallowed with an empty catch.
3. Do NOT instrument control flow that merely looks like an error — an expected
   404, validation the user is supposed to see, a retry that then succeeds. Noise
   here costs more than the missing signal.
4. Say WHY each failure matters using the skill's consequence grammar, not a
   restatement of the exception message.
5. Gate: the app still builds, and \`shipeasy ops list --type error\` runs clean.`,
  },
  {
    key: "metrics",
    requires: "flags",
    summary:
      "name this product's critical moments, emit events at the points they actually happen, define metrics over them, and set alert rules on the few worth waking someone for",
    skills: ["shipeasy-metrics", "shipeasy-alerts"],
    instructions: `TASK — metrics + alerts (the release module is enabled)

Load the **shipeasy-metrics** and **shipeasy-alerts** skills first. The backend is
the source of truth for what already exists: start from \`shipeasy metrics list\`
— never grep the codebase for what is being measured, it cannot tell you.

1. Read this codebase and name the handful of moments that define whether the
   product is working — the ones whose failure someone would want to hear about.
   Derive them from what the app actually does (its routes, jobs, checkout or
   signup paths), not from a generic SaaS checklist.
2. Emit an event at the point each moment REALLY happens — server-side, where the
   truth is, not in a component that may never render. Use the version-correct
   track call from the metrics skill.
3. Define a metric over each event (the DSL grammar is \`shipeasy metrics grammar\`).
   Metrics over an event nothing emits return zero, so wire the event first.
4. Add alert rules only for the few worth interrupting a human for. Where a
   sensible threshold cannot be derived from the code, ASK the user for the
   number rather than inventing an SLO you can't justify.
5. Gate: \`shipeasy metrics list\` and \`shipeasy ops alerts list\` show what you
   created, and the app still builds.`,
  },
];

/** The tasks worth offering for THIS run — a module the user didn't enable has
 *  no backend behind it, so its task is not offered at all. */
export function bootstrapTasks(enabledFeatures: string[]): BootstrapTask[] {
  return BOOTSTRAP_TASKS.filter((t) => enabledFeatures.includes(t.requires));
}

/**
 * The brief handed to the harness. Self-contained and harness-agnostic (same
 * contract as the wiring doc): it names the skills to load, states the
 * prerequisite, and ends at "ready to commit" without committing.
 */
export function bootstrapPrompt(tasks: BootstrapTask[], projectId: string): string {
  const skills = [...new Set(tasks.flatMap((t) => t.skills))];
  return [
    `Instrument this repository with Shipeasy. The SDK is already installed and this repo is bound to project ${projectId}.`,
    "",
    "Work from the codebase: READ it first, then instrument what you actually found. Do not",
    "invent behaviour the app doesn't have, and do not instrument everything — a wrong or noisy",
    "signal costs more than a missing one.",
    "",
    `PREREQUISITE: the SDK must already be configured at the entry point. If it is not (no`,
    `configure(...) call), complete ${WIRING_FILENAME} at the repo root first, then continue.`,
    "",
    `Load these skills before you start: ${skills.join(", ")}.`,
    "Prefer the shipeasy-mcp tools when they are available, otherwise use the `shipeasy` CLI.",
    "",
    ...tasks.map((t) => `${t.instructions}\n`),
    "RULES",
    "- Never print, log, echo, or commit a key value (sdk_server_* / sdk_client_*).",
    "- Make the smallest change that instruments the path; do not refactor around it.",
    "- Run the shell commands yourself; do not hand them back to the user.",
    "- Stop at 'ready to commit': show the `git add` list plus a summary of every event,",
    "  metric, alert rule and see() call you added. Do NOT commit.",
  ].join("\n");
}

/**
 * Step 12 — offer to bootstrap the instrumentation that only a codebase read can
 * produce. Everything before this point is mechanical or wiring; this is the
 * step that turns an installed SDK into an app that actually reports something.
 */
async function bootstrapStep(
  opts: SetupOpts,
  interactive: boolean,
  dryRun: boolean,
  selected: AgentId[],
  projectId: string,
  enabledFeatures: string[],
): Promise<boolean> {
  const tasks = bootstrapTasks(enabledFeatures);
  if (!tasks.length) {
    say("  • no ops or release module enabled — nothing to instrument");
    return false;
  }

  explain(
    "Enabling a module turns the **backend** on; it can't know what your code does. This step " +
      "hands your coding agent a written brief to go read this repo and instrument it. **It would:**",
  );
  say();
  for (const t of tasks) say(bullet(t.summary));
  say();
  explain(
    `Skills it will load: ${[...new Set(tasks.flatMap((t) => t.skills))].join(", ")} — installed earlier in this run`,
  );

  if (dryRun) {
    say(`  (dry run — would offer to launch a session for: ${tasks.map((t) => t.key).join(", ")})`);
    return false;
  }
  if (opts.bootstrap === false) {
    say("  • declined (--no-bootstrap)");
    return false;
  }
  // Inside a harness we must not hijack its terminal with a second session —
  // hand it the brief to run itself, exactly like the wiring directive does.
  if (detectHarness().inside) {
    say("\n" + bootstrapPrompt(tasks, projectId) + "\n");
    return false;
  }

  const ran = await offerAgentRun(
    selected,
    bootstrapPrompt(tasks, projectId),
    opts,
    interactive,
    "OK to launch a session to instrument the codebase now?",
  );
  if (!ran) {
    say("  • skipped — re-run this anytime by asking your agent to load the skills above");
  }
  return ran;
}

// ── command ─────────────────────────────────────────────────────────────────

async function runSetup(opts: SetupOpts): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY) && !opts.yes;
  const dryRun = Boolean(opts.dryRun);
  const cwd = process.cwd();

  say("**Shipeasy setup** — full onboarding");

  // 0. Preconditions
  heading("0. Preconditions");
  const pre = checkPreconditions(cwd);
  say(
    `  ${pre.nodeOk ? "✓" : "✗"} node ${pre.nodeVersion}` +
      (pre.nodeOk ? "" : "  — Shipeasy requires Node >= 20; continuing, but expect failures"),
  );
  if (pre.gitRepo) {
    say("  ✓ git repository");
  } else if (interactive && !dryRun) {
    const { init } = await prompts({
      type: "confirm",
      name: "init",
      message: "This folder isn't a git repository. Initialize one now?",
      initial: true,
    });
    if (init) say(gitInit(cwd) ? "  ✓ git init" : "  ✗ git init failed — continuing");
    else say("  • continuing without git (nothing will be committable)");
  } else {
    say("  • not a git repository — run `git init` if you want the changes committable");
  }

  // 1. Detect install targets (monorepo-aware)
  heading("1. Detect install targets");
  const detected = await detectTargets();
  const root = detected.root;
  if (!dryRun) recordDetection(detected.targets); // seed each target's .shipeasy with sdk/language
  for (const t of detected.targets) {
    const fw = t.frameworks.length ? ` · ${t.frameworks.join(", ")}` : "";
    say(
      `  ${t.recommendation.action.startsWith("skip") ? "·" : "▸"} ${relPath(root, t.path)}/  [${t.language}${fw}]  → ${t.recommendation.action}`,
    );
  }
  const actionable = actionableTargets(detected.targets);
  say(
    actionable.length
      ? `\n  ${actionable.length} target(s) to onboard.`
      : "\n  Nothing to install — all detected targets are already onboarded.",
  );

  // 2. Authenticate + bind (repo root + each target)
  heading("2. Authenticate + bind project");
  let projectId = "";
  let projectName: string | undefined;
  let cliSession: CliSession | null = null;
  if (dryRun) {
    say("  (dry run — would run `shipeasy login`, bind cwd + each target)");
  } else {
    // Authoritative for the rest of setup: the project cli-auth resolved to and
    // that we just bound to cwd. Everything below (key minting, target binding)
    // uses this id — never a re-walk of `.shipeasy` that could drift.
    projectId = await ensureAuthAndBind(interactive);
    reportCliSession();
    projectName = await fetchProjectName(projectId);
    // Capture the authenticated session now — creds are guaranteed valid here
    // (ensureAuthAndBind throws otherwise). The trigger step reuses this token
    // to mint the Copilot ops key instead of re-resolving creds later (which can
    // be gone by then and would hard-exit the run).
    cliSession = sessionFromCreds(loadCredentials());

    const outcomes = bindTargetDirs(
      actionable.map((t) => t.path),
      projectId,
      projectName,
      bindProject,
    );
    for (const o of outcomes) {
      if (o.action === "bound") say(`  ✓ bound ${relPath(root, o.dir)}/ → ${o.projectId}`);
      else if (o.action === "already") say(`  • ${relPath(root, o.dir)}/ already bound`);
      else
        say(
          `  → ${relPath(root, o.dir)}/ stays on ${o.projectId} (different project — ` +
            `run \`shipeasy bind\` there to change it)`,
        );
    }
  }

  // 3. Wire coding agents (MCP + instruction files)
  heading("3. Wire coding agents");
  const selected = await selectAgents(opts, interactive);
  const scope: "user" | "project" = selected.length
    ? await resolveScope(opts, interactive, dryRun)
    : "project";
  // Pin the resolved project into each written MCP config (X-Project-Id header)
  // so the repo's connection targets its own project, not the OAuth-consent pick.
  // `mcpToken` is the session key we just authenticated with — registered as an
  // `Authorization: Bearer` header wherever the config stays private to this
  // user, which skips that agent's OAuth sign-in entirely (see `mcpBearer`).
  const ctx: InstallCtx = {
    cwd,
    scope,
    force: false,
    dryRun,
    projectId: projectId || undefined,
    mcpToken: cliSession?.token,
  };
  // The `skills` CLI names for the agents that take skills via `npx skills add`
  // (not the plugin): cursor/codex/copilot. Claude is excluded at BOTH scopes —
  // it now installs the plugin either way, and the plugin already ships these
  // skills, so routing Claude through the skills CLI as well would write a second
  // copy of every one of them into `./.claude/skills`. Fallback: when `claude`
  // isn't on PATH the plugin can't install, and `installClaudePlugin` prints the
  // two commands to run once it is. The skills CLI names Claude Code
  // `claude-code` — bare `claude` errors "Invalid agents: claude".
  const skillsCliAgents = [
    ...new Set(selected.flatMap((a) => (a === "claude" ? [] : (SKILLS_CLI_AGENT[a] ?? [])))),
  ];
  if (selected.length === 0) {
    say("  (no agents selected — skipping)");
  } else {
    say(
      `  scope: ${scope === "project" ? "this project (in-repo)" : "user-level (global)"}`,
    );
    for (const agent of selected) {
      say(`\n  **${agent}**:`);
      for (const line of applyAgent(agent, ctx)) say(line);
    }
    // Universal instructions — benefits every agent (and any we don't special-case).
    say("");
    say(formatFile("AGENTS.md", writeAgentsMd(ctx)));
  }

  // 4. Mint SDK keys (env-locked; values persisted in step 5, never logged)
  heading("4. Mint SDK keys");
  let serverKey: KeyCreated | null = null;
  let clientKey: KeyCreated | null = null;
  const browserTarget = (t: TargetRecommendation): boolean =>
    t.recommendation.keys.includes("client");
  // The targets each key is actually minted for: they asked for that key type
  // and don't already have one in env. Kept as lists rather than booleans so
  // the provenance label names exactly the targets that drove the mint — a
  // separate re-filter could drift from the decision it's supposed to describe.
  // Native targets ask for a client key ONLY — never mint a server key just
  // because a React Native app happens to lack one.
  const serverTargets = actionable.filter(
    (t) =>
      t.recommendation.keys.includes("server") &&
      !t.shipeasy.env_keys_detected.includes(SERVER_KEY_VAR),
  );
  const clientTargets = actionable.filter(
    (t) => browserTarget(t) && !t.shipeasy.env_keys_detected.some((k) => k.includes("CLIENT")),
  );
  const needServer = serverTargets.length > 0;
  const needClient = clientTargets.length > 0;
  const labelFor = (type: "server" | "client", email: string | undefined, now: Date): string =>
    keyLabel({ type, targets: type === "server" ? serverTargets : clientTargets, email, now });
  if (!actionable.length) {
    say("  • no targets need keys — skipping");
  } else if (dryRun) {
    // Name the keys this repo actually asks for — a native-only repo gets the
    // public client key and no server key at all.
    const kinds = [needServer ? "server" : null, needClient ? "client" : null].filter(Boolean);
    say(`  (dry run — would mint ${kinds.length ? kinds.join(" + ") : "no"} key(s))`);
    // Show the provenance label too — it's the part worth reviewing before a
    // real run, and it's fully determined by what detect already found.
    const now = new Date();
    const email = loadCredentials()?.user_email;
    if (needServer) say(`    ${dim(labelFor("server", email, now))}`);
    if (needClient) say(`    ${dim(labelFor("client", email, now))}`);
  } else if (!needServer && !needClient) {
    say("  • every target already has its keys in env — skipping");
  } else {
    // Say which project the keys land in — the plan limit is per-project, so a
    // mismatch here is exactly what produces a confusing "reached the free plan
    // limit of 5 SDK keys" on what the user thinks is a brand-new project.
    say(`  → minting into project ${projectName ?? projectId} [${projectId}]`);
    const session = loadCredentials();
    if (session && session.project_id !== projectId) {
      explain(
        `your CLI session is on ${session.project_id}, but keys go to the bound project ` +
          `${projectId}. Run \`shipeasy bind ${session.project_id}\` if that's wrong.`,
        { first: "  ⚠ ", indent: "    " },
      );
    }
    const keyEnv = resolveKeyEnv(opts);
    say(`  → keys read the \`${keyEnv}\` environment (change with --env)`);
    // One timestamp for the whole mint step so a server/client pair created in
    // the same run can't straddle midnight and disagree on the date.
    const mintedAt = new Date();
    const mintedBy = session?.user_email;
    if (needServer) {
      const name = labelFor("server", mintedBy, mintedAt);
      serverKey = await mintKey("server", keyEnv, projectId, name);
      say(`  ✓ server key minted (${keyEnv}): ${maskKey(serverKey.key)}`);
      say(`    ${dim(name)}`);
    }
    if (needClient) {
      const name = labelFor("client", mintedBy, mintedAt);
      clientKey = await mintKey("client", keyEnv, projectId, name);
      say(`  ✓ client key minted (${keyEnv}): ${maskKey(clientKey.key)} (public)`);
      say(`    ${dim(name)}`);
    }
  }

  // 5. Per target: install the SDK package + persist the keys + pull docs
  heading("5. Install SDK + persist keys (per target)");
  const installOutcome = new Map<string, { status: string; cmd: string }>();
  const persistedVars = new Map<string, string[]>();
  const installDocs = new Map<string, string | null>(); // target path → installation doc
  // Targets the user explicitly unchecked in the install multiselect below. These
  // drop out of onboarding entirely — no key persist, no wiring-doc section — so
  // the harness never walks a folder the user opted out of.
  const deselectedTargets = new Set<string>();
  if (!actionable.length) {
    say("  • nothing to do");
  } else {
    const runInstalls = !opts.skipInstall && !dryRun;
    // Which targets to actually install into now. By default every target that
    // needs an install; interactively the user picks a subset (same multiselect
    // as the agent picker). Unpicked targets fall through to the deferred path.
    const needing = actionable.filter((t) => t.recommendation.action === "install");
    const installTargets = new Set(needing.map((t) => t.path));
    // One target = no choice to make: the multiselect would ask the user to
    // confirm the only thing setup can do. Skip it and say what we picked.
    if (runInstalls && interactive && needing.length === 1) {
      const only = needing[0]!;
      say(
        `  → onboarding ${relPath(root, only.path)}/  (${only.recommendation.sdk ?? only.language})`,
      );
    } else if (runInstalls && interactive && needing.length > 1) {
      const { picked } = await prompts({
        type: "multiselect",
        name: "picked",
        message: `Onboard which of ${needing.length} target(s)?`,
        choices: needing.map((t) => ({
          title: `${relPath(root, t.path)}/  →  ${t.recommendation.sdk ?? t.language}${
            t.recommendation.install ? `  (${t.recommendation.install})` : ""
          }`,
          value: t.path,
          selected: true,
        })),
        hint: "space to toggle, enter to confirm — unchecked folders are left out of onboarding + the wiring plan",
        instructions: false,
      });
      installTargets.clear();
      for (const p of (picked as string[] | undefined) ?? []) installTargets.add(p);
      // Anything the user unchecked is opted out entirely — record it so it never
      // reaches the wiring doc (step 11) and the harness never walks it.
      for (const t of needing) if (!installTargets.has(t.path)) deselectedTargets.add(t.path);
    }

    for (const t of actionable) {
      const rp = relPath(root, t.path);
      if (deselectedTargets.has(t.path)) {
        say(`\n  ${rp}/: · skipped (de-selected) — left out of onboarding + wiring`);
        continue;
      }
      say(`\n  ${rp}/:`);

      if (t.recommendation.action === "install") {
        if (runInstalls && installTargets.has(t.path)) {
          const r = runSdkInstall(t);
          installOutcome.set(t.path, r);
          say(
            r.status === "ran"
              ? `    ✓ installed (${r.cmd})`
              : r.status === "failed"
                ? `    ✗ install failed (${r.cmd}) — added to the wiring steps`
                : `    → install deferred to the wiring steps: ${r.cmd}`,
          );
          if (r.frameworkStep) {
            say(
              r.frameworkStep.status === "ran"
                ? `    ✓ framework setup (${r.frameworkStep.cmd})`
                : `    ✗ framework setup failed (${r.frameworkStep.cmd}) — finish it from the wiring steps`,
            );
          }
        } else {
          installOutcome.set(t.path, {
            status: "deferred",
            cmd: t.recommendation.install ?? "(see docs)",
          });
          say(
            `    → install ${dryRun ? "(dry run) " : ""}deferred: ${t.recommendation.install}`,
          );
        }
      } else {
        say("    • SDK already installed");
      }

      if (dryRun) {
        say("    (dry run — would persist keys to env + guard .gitignore)");
        continue;
      }

      const entries: Record<string, string> = {};
      // Per-target, not per-run: a server key never lands in an app bundle's env.
      if (serverKey && t.recommendation.keys.includes("server"))
        entries[SERVER_KEY_VAR] = serverKey.key;
      if (clientKey && browserTarget(t)) entries[clientKeyVar(t.frameworks)] = clientKey.key;
      const file = envFileFor(t);
      if (Object.keys(entries).length) {
        const w = persistEnv(t.path, file, entries);
        persistedVars.set(t.path, [...w.added, ...w.existing]);
        if (w.added.length) say(`    ✓ ${file}: added ${w.added.join(", ")}`);
        if (w.existing.length)
          say(`    • ${file}: ${w.existing.join(", ")} already present (left untouched)`);
        const gi = ensureGitignored(t.path, file);
        say(`    ${gi.action === "added" ? "✓" : "•"} ${gi.detail}`);
      } else {
        persistedVars.set(t.path, t.shipeasy.env_keys_detected);
        say("    • keys already in env — nothing persisted");
      }

      // Pull the version-correct installation doc to embed in the wiring file.
      const doc = await fetchSdkDoc(
        t.recommendation.sdk ?? t.language,
        "installation",
        t.frameworks[0],
      );
      installDocs.set(t.path, doc);
      say(
        doc ? "    ✓ installation doc fetched" : "    • installation doc unavailable (offline?)",
      );
    }
  }

  // 5b. Install the SDK how-to skill(s) into the wired agents (runs `npx
  // skills`). Claude gets everything from its plugin at either scope; every
  // other agent gets the language-specific SDK how-to here. The feature workflow
  // skills (flags/i18n/ops sets) are installed after the feature selection in
  // step 7, so they follow what the user turns on.
  // User scope installs globally (`-g`); project scope keeps them in-repo.
  heading("5b. Install skills");
  const uniqueSdks = [
    ...new Set(actionable.map((t) => t.recommendation.sdk).filter(Boolean)),
  ] as string[];
  const skillsGlobal = scope === "user";
  // Language the marketplace how-to skills bake their snippets for (shared by 5b
  // and the feature-skill install in step 7).
  const skillSdk = uniqueSdks[0] ?? actionable[0]?.language ?? "typescript";
  if (dryRun) {
    say(
      `  (dry run — would ensure the \`skills\` CLI, then install the SDK how-to skills` +
        ` at ${skillsGlobal ? "user-global (-g)" : "project"} scope into: ${skillsCliAgents.join(", ") || "—"})`,
    );
  } else if (!skillsCliAgents.length) {
    say(
      selected.includes("claude")
        ? "  • Claude gets its skills from the plugin — nothing else to install"
        : "  • no skills-CLI agents — skipping (install later: shipeasy docs skill --sdk <lang> --install)",
    );
  } else {
    // Make sure the `skills` CLI can actually run before we lean on it (it's
    // installed here if it's missing) — otherwise every `skills add` below would
    // fail one at a time and silently fall back to writing `.claude/skills/`.
    const cli = ensureSkillsCli();
    say(`  ${cli.source === "missing" ? "✗" : "✓"} skills CLI: ${cli.detail}`);
    say(
      `  scope: ${skillsGlobal ? "-g (user-global)" : "project (in-repo)"} — passed through, not asked`,
    );
    // SDK how-to skill(s) — one per distinct SDK in the tree. Snippets are baked
    // in for that SDK's language at install.
    for (const sdk of uniqueSdks) {
      const content = await fetchSdkSkill(sdk);
      if (!content) {
        say(`  • ${sdk}: no published skill — skipped`);
        continue;
      }
      const res = await installSkill(content, sdk, {
        agents: skillsCliAgents,
        global: skillsGlobal,
      });
      say(`  ${res.action === "failed" ? "✗" : "✓"} ${sdk}: ${res.detail}`);
    }
  }

  // 6. Devtools (the flag/experiment panel + end-user feedback surface)
  heading("6. Devtools");
  // Non-skip targets (includes already-onboarded ones, which may still want the
  // overlay even though their recommendation.keys is empty).
  const nonSkipTargets = detected.targets.filter(
    (t) => !t.recommendation.action.startsWith("skip"),
  );
  // Which overlay this repo can actually host, from what step 1 detected. Native
  // wins over browser (every RN app also depends on `react`), and the two are
  // different deliverables: a `<script>` tag vs a package + a root mount.
  const nativeTargets = nonSkipTargets.filter(
    (t) => targetSurface(t.frameworks) === "react-native",
  );
  const frameworkBrowser = nonSkipTargets.filter(
    (t) => targetSurface(t.frameworks) === "browser",
  );

  // Lead with what it is so the customer can decide before we ask anything.
  explain(
    "**What it is:** a panel your team opens on top of the running app to see and toggle the " +
      "live flags/experiments the current user is getting, plus a widget end users can use to " +
      "file bug reports straight into your ops queue",
  );
  if (nativeTargets.length) {
    explain(
      "**React Native** — the `@shipeasy/react-native-devtools` package, mounted once at your " +
        "app root; shake the device to open it on-device",
      { first: "  • ", indent: "    " },
    );
  }
  if (frameworkBrowser.length || !nativeTargets.length) {
    explain(
      "**Browser** — a single opt-in `<script>` tag (`?se=1` or Shift+Alt+S); it loads only " +
        "when invoked, so there's no impact on your normal bundle",
      { first: "  • ", indent: "    " },
    );
  }
  explain("Docs: https://docs.shipeasy.ai/feedback/devtools");
  say();

  let browserCandidates = frameworkBrowser;
  const devtoolsSurfaces: DevtoolsSurface[] = [];
  // Per native target: what the overlay install actually did (drives the wiring doc).
  const nativeInstalls = new Map<string, InstallOutcome>();
  let opsEnabled: EnableResult | null = null;
  // Targets that need the project id in public env for whichever overlay they host.
  const devtoolsEnvTargets: TargetRecommendation[] = [];

  if (dryRun) {
    const surfaces = [
      nativeTargets.length ? "React Native (install the overlay package)" : null,
      frameworkBrowser.length || !nativeTargets.length ? "browser (<script> tag)" : null,
    ].filter(Boolean);
    say(`  (dry run — would offer ${surfaces.join(" + ")}, then enable the ops module)`);
  } else {
    // ── React Native ──────────────────────────────────────────────────────────
    // A phone app has no HTML surface, so it never gets the browser question.
    if (nativeTargets.length) {
      const dirs = nativeTargets.map((t) => `${relPath(root, t.path)}/`).join(", ");
      explain(
        `Detected **React Native**${nativeTargets.some((t) => t.frameworks.includes("expo")) ? " (Expo)" : ""} in ${dirs}`,
      );
      // An explicit --devtools / --no-devtools skips the question outright.
      let accept = opts.devtools ?? false;
      if (opts.devtools === undefined && interactive) {
        const { yes } = await prompts({
          type: "confirm",
          name: "yes",
          message:
            "Add the Shipeasy devtools to your React Native app? (installs the overlay package — shake to open the on-device panel + in-app bug reports)",
          initial: true,
        });
        accept = Boolean(yes);
      }

      if (!accept) {
        say(`  • declined — add later with \`${RN_DEVTOOLS_PACKAGE}\``);
      } else {
        devtoolsSurfaces.push("react-native");
        for (const t of nativeTargets) {
          if (deselectedTargets.has(t.path)) continue;
          const rp = relPath(root, t.path);
          // `--skip-install` means "don't run package managers" — it applies to
          // the overlay package just as much as to the SDK itself.
          const res: InstallOutcome = opts.skipInstall
            ? {
                status: "deferred",
                cmd: rnDevtoolsInstallArgv(t.package_manager, t.frameworks).main.join(" "),
              }
            : runRnDevtoolsInstall(t);
          nativeInstalls.set(t.path, res);
          say(
            res.status === "ran"
              ? `  ✓ ${rp}/: installed (${res.cmd})`
              : res.status === "failed"
                ? `  ✗ ${rp}/: install failed (${res.cmd}) — added to the wiring steps`
                : `  → ${rp}/: install deferred to the wiring steps: ${res.cmd}`,
          );
          if (res.frameworkStep) {
            say(
              res.frameworkStep.status === "ran"
                ? `  ✓ ${rp}/: optional peers (${res.frameworkStep.cmd})`
                : `  ✗ ${rp}/: optional peers failed — re-run: ${res.frameworkStep.cmd}`,
            );
          }
          devtoolsEnvTargets.push(t);
        }
        say("  → the root mount + deep-link scheme are in the wiring steps (needs your app root)");
      }
    }

    // ── Browser ───────────────────────────────────────────────────────────────
    // Skipped outright for a native-only repo — there is no HTML to mount into.
    // Otherwise: does the project render HTML? Default from detection; an
    // explicit --devtools / --no-devtools flag skips the question outright.
    if (nativeTargets.length && !frameworkBrowser.length) {
      say("  • native app — no HTML surface, skipping the browser overlay");
    } else {
      let servesHtml = frameworkBrowser.length > 0;
      if (opts.devtools !== undefined) {
        servesHtml = opts.devtools;
      } else if (interactive) {
        const detectedFw = [
          ...new Set(
            frameworkBrowser.flatMap((t) => t.frameworks.filter((f) => BROWSER_FRAMEWORKS.has(f))),
          ),
        ];
        explain(
          detectedFw.length
            ? `Detected **${detectedFw.join(", ")}** — renders pages in a browser, so the overlay can mount.`
            : "No browser framework detected — looks like a backend/API. The overlay still works in " +
                "any HTML you serve (server-rendered templates, an embedded SPA, a static frontend).",
        );
        const { html } = await prompts({
          type: "confirm",
          name: "html",
          message:
            "Does your project serve HTML to a browser? (yes → offer the in-page devtools overlay + end-user bug reports; no → headless service, skip it)",
          initial: servesHtml,
        });
        servesHtml = Boolean(html);
      }

      if (!servesHtml) {
        say("  • headless / no browser surface — skipping the overlay");
      } else {
        // Affirmed an HTML surface we didn't pattern-match → host it on every
        // actionable target rather than skipping. Native targets are excluded:
        // they cannot mount a <script> tag.
        if (!browserCandidates.length) {
          browserCandidates = nonSkipTargets.filter(
            (t) => targetSurface(t.frameworks) !== "react-native",
          );
        }

        let accept = false;
        if (opts.devtools !== undefined) {
          accept = opts.devtools;
        } else if (interactive) {
          const { yes } = await prompts({
            type: "confirm",
            name: "yes",
            message:
              "Add the Shipeasy devtools overlay? (in-page flag/experiment panel via ?se=1 + end-user bug reports)",
            initial: true,
          });
          accept = Boolean(yes);
        }

        if (accept) {
          devtoolsSurfaces.push("browser");
          devtoolsEnvTargets.push(...browserCandidates);
          say("  → the <script> tag injection is in the wiring steps (needs your layout)");
        } else {
          say(
            "  • declined — add later with `shipeasy install ops` (see the shipeasy-ops skill)",
          );
        }
      }
    }

    // Either overlay files into the ops queue, and both read the project id from
    // public env — so the server-side enable + the env write happen once, here.
    if (devtoolsSurfaces.length) {
      try {
        opsEnabled = await enableModuleGroup("ops");
        say(`  ✓ ops module enabled (${opsEnabled.enabled_modules.join(", ")})`);
      } catch (e) {
        say(`  ✗ ops module enable failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      for (const t of new Set(devtoolsEnvTargets)) {
        const w = persistEnv(t.path, envFileFor(t), {
          [projectIdVar(t.frameworks)]: projectId,
        });
        if (w.added.length)
          say(`  ✓ ${relPath(root, t.path)}/${w.file}: added ${w.added.join(", ")}`);
      }
    }
  }
  const devtoolsAccepted = devtoolsSurfaces.length > 0;

  // 7. Feature installs (server-side module groups; pure API calls)
  heading("7. Feature installs");
  let features: FeatureGroup[] = [];
  // Translations ships behind the platform's `translation_module` rollout gate.
  // Until it's flipped on for this project, the module is neither offered nor
  // installable — the gate is evaluated through @shipeasy/sdk against shipeasy's
  // own project, so the rollout widens without republishing the CLI.
  // Unreachable ⇒ not offered.
  const { translations: i18nRolledOut } = await getPlatformModuleGates(projectId || undefined);
  const offered = FEATURE_GROUPS.filter((f) => f !== "i18n" || i18nRolledOut);
  if (dryRun) {
    say(
      `  (dry run — would offer ${offered.join(" / ")} module enables, then install each enabled feature's how-to skills + shipeasy-setup)`,
    );
    // Nothing is enabled in a dry run, but an explicit --features still says
    // which modules a real run would turn on — carry it so the later steps
    // preview honestly instead of reporting "nothing to instrument".
    if (opts.features) {
      features = opts.features
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((f) => (offered as readonly string[]).includes(f)) as FeatureGroup[];
    }
  } else {
    if (opts.features) {
      const requested = opts.features
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const unknown = requested.filter((f) => !(FEATURE_GROUPS as readonly string[]).includes(f));
      if (unknown.length) {
        throw new Error(
          `Unknown feature(s): ${unknown.join(", ")}. Known: ${FEATURE_GROUPS.join(", ")}`,
        );
      }
      features = requested.filter((f) =>
        (offered as readonly string[]).includes(f),
      ) as FeatureGroup[];
      for (const f of requested.filter((f) => !(offered as readonly string[]).includes(f))) {
        say(`  • ${f} — not available yet, skipped`);
      }
    } else if (interactive) {
      const choices = [
        {
          title: "Flags & experiments — gates, configs, kill switches, A/B, metrics",
          value: "flags",
          description:
            "Ship features behind flags, roll out by %/country/attribute, run A/B experiments with" +
            " stats, plus remote configs and one-flip kill switches. Docs: https://docs.shipeasy.ai/flags-experiments",
          selected: true,
        },
        {
          title: "Feedback, errors & alerts (ops)",
          value: "ops",
          description:
            "One queue for end-user bug reports and auto-captured production errors, plus" +
            " metric-threshold alerts that ping you when something moves. Docs: https://docs.shipeasy.ai/feedback",
          selected: true,
        },
        ...(i18nRolledOut
          ? [
              {
                title: "Translations (i18n)",
                value: "i18n",
                description:
                  "Manage every user-facing string as a translatable key, publish to the CDN, and" +
                  " machine-translate into new locales without a redeploy. Docs: https://docs.shipeasy.ai/translations",
                selected: true,
              },
            ]
          : []),
      ];
      const { picked } = await prompts({
        type: "multiselect",
        name: "picked",
        message:
          "Enable feature modules now? (all preselected — space to deselect any you don't want)",
        choices,
        hint: "space to toggle, enter to confirm",
        instructions: false,
      });
      features = (picked as FeatureGroup[] | undefined) ?? [];
    } else {
      // Non-interactive with no `--features`: take everything on offer, which is
      // exactly what the interactive prompt preselects. Silently enabling
      // nothing here was how an agent-driven setup ended up with only
      // `shipeasy-setup` on disk — no ops module, and no ops/see/alerts skills.
      features = [...offered] as FeatureGroup[];
      say(`  • non-interactive — enabling all offered modules: ${offered.join(", ")}`);
      say("    (pass --features <list> to narrow)");
    }

    if (!features.length) {
      say(
        `  • none selected — enable later with \`shipeasy install <${offered.join("|")}>\``,
      );
    }
    for (const f of features) {
      if (f === "ops" && opsEnabled) {
        say("  • ops — already enabled (devtools step)");
        continue;
      }
      try {
        const r = await enableModuleGroup(f);
        if (f === "ops") opsEnabled = r;
        say(
          `  ${r.ok ? "✓" : "✗"} ${f} — modules now: ${r.enabled_modules.join(", ")}` +
            (r.profile_created ? " (created en:prod profile)" : ""),
        );
      } catch (e) {
        say(`  ✗ ${f} enable failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Install the how-to skills for the enabled features (the SDK how-to went
    // in at 5b). `shipeasy-setup` always rides along; each enabled feature adds
    // its own skill set (overlap deduped). We key off what's actually ON — the
    // selected `features` plus `ops` if the devtools step turned it on — so the
    // agent gets exactly the workflow skills for what it can now do. Claude gets
    // all of this from its plugin at either scope, so there's nothing to add.
    const skillFeatures = [...new Set<string>([...features, ...(opsEnabled ? ["ops"] : [])])];
    const featureSkills = setupSkillNames(skillFeatures);
    if (!skillsCliAgents.length) {
      say(
        selected.includes("claude")
          ? "  • how-to skills come from the Claude plugin — nothing to add"
          : `  • no skills-CLI agents — install later: ${featureSkills.join(", ")}`,
      );
    } else {
      // One `skills add <dir> --skill …` for the whole set. List each skill with
      // its description first so the customer can see what each one is for.
      say(`  installing ${featureSkills.length} how-to skill(s):`);
      const batch = await installMarketplaceSkills(featureSkills, skillSdk, {
        agents: skillsCliAgents,
        global: skillsGlobal,
      });
      for (const s of batch.skills) {
        say(`  • ${s.name}${s.description ? ` — ${summarize(s.description)}` : ""}`);
      }
      for (const name of batch.missing) say(`  ✗ ${name}: could not fetch skill`);
      if (batch.skills.length) {
        say(`  ${batch.result.action === "failed" ? "✗" : "✓"} ${batch.result.detail}`);
      }
    }
  }

  // 8. Verification gate
  heading("8. Verification");
  if (dryRun) {
    say("  (dry run — skipped)");
  } else {
    const checks: Array<[string, boolean]> = [];
    checks.push(await verifySession(projectId, interactive || detectHarness().inside));
    try {
      const client = getApiClient();
      const res = await client.request<unknown[] | { data: unknown[] }>("GET", "/api/admin/keys");
      const n = (Array.isArray(res) ? res : res.data).length;
      checks.push([`${n} SDK key(s) on the project`, n > 0]);
    } catch {
      checks.push(["could not list keys", false]);
    }
    for (const t of actionable) {
      if (deselectedTargets.has(t.path)) continue;
      const bound = getBoundProjectId(t.path);
      checks.push([
        `${relPath(root, t.path)}/.shipeasy bound${bound ? ` → ${bound}` : ""}`,
        Boolean(bound),
      ]);
    }
    for (const [label, ok] of checks) say(`  ${ok ? "✓" : "✗"} ${label}`);
    if (checks.some(([, ok]) => !ok)) {
      say();
      explain("Fix the ✗ lines before handing off — do not advance past a failing gate.");
    }
  }

  // 9. Trust this folder in Claude.
  //
  // A precondition of step 10, not a fallback from it: a `.mcp.json` server is
  // "⏸ Pending approval" until the folder is trusted, and `claude mcp login`
  // exits 1 against a pending server. Trust only exists inside an interactive
  // session, so this is the one step that hands over the terminal — which is
  // reason enough for it to be its own, announced step. The session is prefilled
  // with `/exit` so it closes the moment the dialog is answered.
  if (claudeNeedsTrust(selected) || (dryRun && selected.includes("claude"))) {
    heading("9. Trust this folder in Claude");
    await trustClaudeStep(interactive, dryRun);
  }

  // 10. Authorize the hosted MCP connection (OAuth).
  //
  // Its own step, immediately after the verification gate and BEFORE the wiring
  // hand-off. Two reasons it can't ride along inside step 11 any more:
  //  - it's a browser round-trip the user has to complete — the one place setup
  //    hands over control — so it gets its own heading rather than appearing
  //    mid-way through another step's output;
  //  - step 11 only ran when there was something left to wire, which silently
  //    skipped authorization for a repo that needed no code changes but had just
  //    had its agents wired. Those runs ended with a 401 on the first tool call.
  heading("10. Authorize the MCP connection");
  let mcpVerified: AgentId[] = [];
  if (dryRun) {
    say("  (dry run — would run each agent's MCP sign-in, or print its manual step)");
  } else if (!selected.length) {
    say("  • no agents wired — nothing to authorize");
  } else {
    ({ verified: mcpVerified } = await mcpAuthHandoff(selected, interactive, { dryRun, ctx }));
  }

  // 11. Remaining (non-deterministic) wiring → instructions for ANY harness
  heading("11. Remaining wiring — instructions for your coding agent");
  const wiringTargets: WiringTarget[] = actionable
    .filter((t) => !deselectedTargets.has(t.path))
    .map((t) => {
      const inst = installOutcome.get(t.path);
      return {
        relPath: relPath(root, t.path),
        language: t.language,
        sdk: t.recommendation.sdk ?? t.language,
        frameworks: t.frameworks,
        packageManager: t.package_manager,
        entryPoints: t.entry_points,
        sdkInstalled: t.recommendation.action === "set_key" || inst?.status === "ran",
        installCmd:
          t.recommendation.action === "install" && inst?.status !== "ran"
            ? (t.recommendation.install ?? null)
            : null,
        installationDoc: installDocs.get(t.path) ?? null,
        envFile: envFileFor(t),
        envVars: persistedVars.get(t.path) ?? [],
        secretStoreMove: needsStoreMove(t.recommendation.secret_store)
          ? t.recommendation.secret_store
          : null,
        browser: browserTarget(t),
        native: targetSurface(t.frameworks) === "react-native",
        existingScripts: {
          current: t.shipeasy.loader_script_tag.scripts ?? [],
          legacy: t.shipeasy.loader_script_tag.legacy ?? [],
          ...(t.shipeasy.loader_script_tag.file
            ? { file: t.shipeasy.loader_script_tag.file }
            : {}),
        },
      };
    });

  const enabledFeatures = [
    ...new Set([...features, ...(opsEnabled && !features.includes("ops") ? ["ops"] : [])]),
  ];
  const anythingToWire = wiringTargets.length > 0 || devtoolsAccepted || enabledFeatures.length > 0;
  if (!anythingToWire) {
    say("  • nothing left — the codebase needs no wiring changes.");
  } else if (dryRun) {
    say(`  (dry run — would write ${WIRING_FILENAME} with the remaining steps)`);
    const topics = planTopics({
      sdks: wiringTargets.map((t) => ({ sdk: t.sdk, framework: t.frameworks[0] })),
      servesPages:
        wiringTargets.some((t) => t.browser && !t.native) ||
        devtoolsSurfaces.includes("browser"),
      devtoolsBrowser: devtoolsSurfaces.includes("browser"),
      devtoolsNative: devtoolsSurfaces.includes("react-native"),
      features: enabledFeatures,
    });
    say(
      `  (dry run — would pull the latest ${topics.join(", ")} docs for` +
        ` ${[...new Set(wiringTargets.map((t) => t.sdk))].join(", ") || "—"} into ${DOCS_DIRNAME}/)`,
    );
  } else {
    // Fetch language-correct feature snippets for the primary SDK so the wiring
    // doc embeds real calls, not framework-specific guesses.
    const primarySdk = wiringTargets[0]?.sdk;
    const featureDocs: { i18n?: string | null; errorReporting?: string | null } = {};
    if (primarySdk && enabledFeatures.includes("i18n")) {
      featureDocs.i18n =
        (await fetchSdkDoc(primarySdk, "i18n")) ?? (await fetchSdkDoc(primarySdk, "translations"));
    }
    if (primarySdk && enabledFeatures.includes("ops")) {
      featureDocs.errorReporting = await fetchSdkDoc(primarySdk, "error-reporting");
    }

    // The target the devtools section writes for: the native one when that's the
    // surface (its env prefix + install state differ), else a browser target.
    const sampleNative = devtoolsSurfaces.includes("react-native")
      ? nativeTargets.find((t) => !deselectedTargets.has(t.path))
      : undefined;
    const sampleBrowser = devtoolsSurfaces.includes("browser")
      ? (browserCandidates.find((t) => !deselectedTargets.has(t.path)) ??
        actionable.find((t) => browserTarget(t) && !deselectedTargets.has(t.path)))
      : undefined;
    const devtoolsTarget = sampleNative ?? sampleBrowser;
    // The RN overlay's own doc page — same embed treatment as the feature docs.
    const nativeDoc = sampleNative
      ? await fetchSdkDoc(
          sampleNative.recommendation.sdk ?? sampleNative.language,
          "react-native-devtools",
        )
      : null;
    // Pull the LATEST published docs for everything this run turned on, into
    // `shipeasy-wiring-docs/`. The wiring instructions age with the CLI; these
    // pages don't — they come from each SDK repo's live docs, so an outdated
    // CLI still hands the agent current wiring, and a bad snippet is fixable by
    // editing the SDK's docs instead of shipping a CLI release.
    const docBundle = await fetchDocBundle({
      sdks: wiringTargets.map((t) => ({ sdk: t.sdk, framework: t.frameworks[0] })),
      servesPages:
        wiringTargets.some((t) => t.browser && !t.native) ||
        devtoolsSurfaces.includes("browser"),
      devtoolsBrowser: devtoolsSurfaces.includes("browser"),
      devtoolsNative: devtoolsSurfaces.includes("react-native"),
      features: enabledFeatures,
    });
    if (docBundle.docs.length) {
      writeDocBundle(root, docBundle);
      say(`  ✓ pulled ${docBundle.docs.length} doc page(s) → ${DOCS_DIRNAME}/`);
    } else {
      say(`  • no docs could be pulled (offline?) — the wiring file falls back to \`docs get\``);
    }
    for (const m of docBundle.missing) say(`    • ${m.sdk}: no published '${m.topic}' page`);

    // The public identifiers the `<head>` tags carry. Needed whenever anything
    // here renders a page — the runtime tag is how a browser sees flags at all
    // — so this is resolved independently of the devtools answer, from the
    // first page-serving target (its framework decides the env var prefix).
    const headTarget =
      actionable.find(
        (t) => browserTarget(t) && targetSurface(t.frameworks) !== "react-native" && !deselectedTargets.has(t.path),
      ) ?? devtoolsTarget;
    const doc = buildWiringDoc({
      projectId,
      targets: wiringTargets,
      publicIds: headTarget
        ? {
            clientKey: clientKey?.key ?? null,
            clientKeyVar: clientKeyVar(headTarget.frameworks),
            projectIdVar: projectIdVar(headTarget.frameworks),
          }
        : undefined,
      devtools:
        devtoolsAccepted && devtoolsTarget
          ? {
              surfaces: devtoolsSurfaces,
              clientKeyVar: clientKeyVar(devtoolsTarget.frameworks),
              projectIdVar: projectIdVar(devtoolsTarget.frameworks),
              clientKey: clientKey?.key ?? null,
              native: sampleNative
                ? {
                    relPath: relPath(root, sampleNative.path),
                    installCmd:
                      nativeInstalls.get(sampleNative.path)?.status === "ran"
                        ? null
                        : (nativeInstalls.get(sampleNative.path)?.cmd ??
                          rnDevtoolsInstallArgv(
                            sampleNative.package_manager,
                            sampleNative.frameworks,
                          ).main.join(" ")),
                    expoPeersCmd:
                      rnDevtoolsInstallArgv(
                        sampleNative.package_manager,
                        sampleNative.frameworks,
                      ).expoPeers?.join(" ") ?? null,
                    doc: nativeDoc,
                  }
                : null,
            }
          : null,
      enabledFeatures,
      featureDocs,
      referenceDocs: toReferenceDocs(docBundle),
      buildTargets: wiringTargets
        .filter((t) => t.language === "typescript" || t.language === "javascript")
        .map((t) => t.relPath),
      // Harnesses we just registered the MCP server into — drives the reload notice.
      agents: selected,
      // ...and the subset whose connection step 10 actually verified, so the
      // notice can say the tools are known-good rather than leaving the reader
      // to guess (and guess "broken", which is what sent one to the CLI).
      mcpVerified,
    });
    const wiringPath = join(root, WIRING_FILENAME);
    writeFileSync(wiringPath, doc, "utf8");
    say(`  ✓ wrote ${wiringPath}\n`);
    await wiringHandoff(root, opts, interactive, selected, {
      targets: wiringTargets,
      devtools: devtoolsSurfaces,
      features: enabledFeatures,
    });
  }

  // 12. Bootstrap the instrumentation only a codebase read can produce —
  // see() error reporting (ops) and events → metrics → alert rules (release).
  // Sits after the wiring hand-off because both depend on a configured SDK.
  heading("12. Bootstrap error tracking + metrics");
  const bootstrapped = await bootstrapStep(
    opts,
    interactive,
    dryRun,
    selected,
    projectId,
    enabledFeatures,
  );

  // 13. Automation trigger (unattended auto-apply — the queue burn-down loop)
  heading("13. Automation trigger");
  let triggerResult: TriggerStepResult = { enabled: false };
  if (dryRun) {
    say("  (dry run — would offer the automation trigger + open the hosted setup)");
  } else if (!projectId) {
    say("  • no bound project — skipping");
  } else if (opts.triggers === false) {
    say("  • declined (--no-triggers)");
  } else {
    triggerResult = await runTriggerStep({
      projectId,
      appBaseUrl: appBaseUrl(),
      interactive,
      ask: opts.triggers !== true, // --triggers opts in and skips the yes/no gate
      platform: opts.triggerPlatform,
      preferredAgents: selected,
      dryRun,
      session: cliSession,
    });
  }

  // 14. Plan — the last thing setup can't decide for the user. Opens the hosted
  // wizard's CLI funnel (Plan → Finish), which is also where the Terms/Privacy
  // agreements are accepted, so this is what marks onboarding complete.
  heading("14. Choose your plan");
  let planResult: PlanStepResult = { opened: false, completed: false, url: "" };
  if (opts.plan === false) {
    say("  • skipped (--no-plan)");
  } else {
    planResult = await runPlanStep({
      appBaseUrl: appBaseUrl(),
      interactive,
      ask: opts.plan !== true, // --plan opts in and skips the yes/no gate
      dryRun,
    });
  }

  // Summary. Bold labels in a fixed column so the recap reads as a table — the
  // padding is computed from the UNSTYLED label, so it lines up with or without
  // colour.
  const row = (label: string, value: string): void =>
    say(`**${label}**${" ".repeat(Math.max(1, 11 - label.length))}${value}`);

  heading("Done");
  row("Project:", `${projectId || "(dry run)"}${projectName ? ` (${projectName})` : ""}`);
  if (serverKey || clientKey) {
    row(
      "Keys:",
      `${[
        serverKey ? `server ${maskKey(serverKey.key)}` : null,
        clientKey ? `client ${maskKey(clientKey.key)}` : null,
      ]
        .filter(Boolean)
        .join(", ")} — values in each target's gitignored env file`,
    );
  }
  row(
    "Targets:",
    actionable.length
      ? actionable.map((t) => relPath(root, t.path) + "/").join(", ")
      : "none needed work",
  );
  row("Agents:", selected.length ? `${selected.join(", ")} (${scope} scope)` : "none wired");
  row(
    "Devtools:",
    devtoolsAccepted
      ? `${devtoolsSurfaces.join(" + ")} — see the wiring steps${
          devtoolsSurfaces.includes("react-native") ? " (package installed, mount it)" : ""
        }`
      : "declined",
  );
  row("Features:", features.length ? features.join(", ") : "none enabled");
  {
    const tasks = bootstrapTasks(enabledFeatures);
    row(
      "Instrument:",
      !tasks.length
        ? "n/a — no ops/release module"
        : bootstrapped
          ? `${tasks.map((t) => t.key).join(" + ")} — session ran`
          : `${tasks.map((t) => t.key).join(" + ")} — not run; ask your agent to load ${[
              ...new Set(tasks.flatMap((t) => t.skills)),
            ].join(", ")}`,
    );
  }
  row(
    "Trigger:",
    triggerResult.platforms?.length
      ? `${triggerResult.platforms.join(", ")} — ${
          triggerResult.completed
            ? "done (finish any open wizard tabs)"
            : "finish setup in the browser"
        }`
      : triggerResult.completed
        ? "done — none opened"
        : "not set up — run `shipeasy setup triggers` later",
  );
  row(
    "Plan:",
    planResult.completed
      ? "picked — onboarding complete"
      : planResult.url
        ? `finish onboarding at ${planResult.url}`
        : "skipped — pick one from Settings → Billing",
  );
  if (anythingToWire && !dryRun) {
    row("Wiring:", `${WIRING_FILENAME} — hand it to any coding agent to finish`);
  }
  if (projectId) {
    // `/dashboard/<id>`, not `/projects/<id>` — the latter is a 404; the app has
    // no `/projects` route at all.
    row("Dashboard:", `${appBaseUrl()}/dashboard/${projectId}`);
  }
  say();
  explain(
    "When the wiring is done, commit — `setup` never commits for you, and the wiring " +
      "agent only does so if you say yes when it asks:",
    { indent: "" },
  );
  say("  `git add <each target>/.shipeasy <manifests+lockfiles> <entry files>`");
  say('  `git commit -m "chore: onboard Shipeasy base (SDK + auth + bind)"`');
  say();
  explain(
    "**Automation trigger:** the scheduled agent that burns down the bug/feature/error queue " +
      "as PRs on a cadence. Set it up any time with `shipeasy setup triggers`",
    { indent: "" },
  );
  if (dryRun) {
    say();
    say("(dry run — no files were written, nothing was minted)");
  }
}

/**
 * `shipeasy setup triggers` — the automation-trigger step run on its own (it
 * replaces the removed `shipeasy-ops-trigger` skill). Resolves the bound project
 * from `.shipeasy` (or the active session) and opens the hosted, guided setup
 * wizard preselected to the chosen platform.
 */
async function runSetupTriggers(opts: { platform?: string; dryRun?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const creds = loadCredentials();
  const projectId = getBoundProjectId(cwd) ?? creds?.project_id;
  if (!projectId) {
    console.error(
      "Not bound to a Shipeasy project. Run `shipeasy setup` (or `shipeasy login`) first.",
    );
    process.exit(1);
  }

  say("Shipeasy — automation trigger setup\n");
  await runTriggerStep({
    projectId,
    appBaseUrl: appBaseUrl(),
    interactive: Boolean(process.stdin.isTTY),
    ask: false, // running this command IS the opt-in
    platform: opts.platform,
    dryRun: opts.dryRun,
    session: sessionFromCreds(creds),
  });
}

/**
 * On an unexpected setup failure, offer to file a bug report to Shipeasy. Who's
 * watching decides how consent is gathered:
 *  - a human at a TTY (not --yes, not inside an agent harness) gets the
 *    interactive consent prompt — promptAndSend prints the EXACT payload + asks,
 *    and only sends on an explicit yes;
 *  - an agent-driven or non-interactive run is NEVER auto-sent — we print the one
 *    command the agent should run AFTER asking its user (the wiring doc spells
 *    this out). Nothing leaves the machine without explicit consent.
 */
async function offerSetupIssueReport(
  message: string,
  opts: SetupOpts,
  version: string,
): Promise<void> {
  if (!reportConfigured()) return; // reporter not wired into this build — stay silent
  const interactive = Boolean(process.stdin.isTTY) && !opts.yes;
  const insideHarness = detectHarness().inside;
  const projectId = getBoundProjectId(process.cwd()) ?? undefined;

  if (insideHarness || !interactive) {
    say(
      "\nIf this looks like a Shipeasy bug, you can report it — ASK THE USER FIRST, then run:\n" +
        `    shipeasy report-issue --consent --title ${JSON.stringify("Setup failed")} ` +
        `--error ${JSON.stringify(message.slice(0, 200))}\n` +
        "  (add --step/--description/--language/--frameworks for a cleaner report). " +
        "Never send without the user's consent.",
    );
    return;
  }

  const result = await promptAndSend(
    { title: "Setup failed", error: message, projectId, cliVersion: version },
    true,
  );
  if (result.ok) {
    say(
      `\n✓ Reported to Shipeasy${result.number ? ` (#${result.number})` : ""} — pending approval. Thank you.`,
    );
  } else if (result.error) {
    say(`\n• ${result.error}`);
  }
}

export function setupCommand(parent: Command, version = "unknown"): void {
  const setup = parent
    .command("setup")
    .description(
      "One-command onboarding for this repo. Logs you in and binds a project, detects and " +
        "wires your coding agents (Claude Code plugin, or MCP + instruction files for " +
        "Cursor/Codex/Copilot/Antigravity/Gemini), mints SDK keys, installs @shipeasy/sdk, and offers the " +
        "devtools overlay + feature modules — then writes self-contained SDK-wiring steps to " +
        "shipeasy-wiring.md for your agent to finish. Monorepo-aware and idempotent (safe to " +
        "re-run). Run `shipeasy setup --help` for every flag; `shipeasy setup triggers` sets up " +
        "the scheduled queue-fixing automation on its own.",
    )
    .option("--yes", "Non-interactive: accept defaults everywhere (bind, prod keys, run installs)")
    .option(
      "--agents <list>",
      "Comma list to wire (claude,cursor,codex,copilot,antigravity,gemini)",
    )
    .option("--domain <domain>", "Production domain (used when creating a new project at login)")
    .option(
      "--scope <scope>",
      "MCP + skills scope: project (in-repo, default) | user (global). Omit to be asked.",
    )
    .option("--env <env>", "Environment the minted SDK keys read: dev | staging | prod")
    .option(
      "--devtools",
      "Enable devtools without asking (browser <script> and/or the React Native overlay, per detection)",
    )
    .option("--no-devtools", "Skip devtools without asking")
    .option("--features <list>", "Module groups to enable non-interactively (flags,i18n,ops)")
    .option("--skip-install", "Don't run SDK package installs (they go into the wiring steps)")
    .option("--no-agent-run", "Don't offer to launch a coding agent on the wiring steps")
    .option(
      "--no-bootstrap",
      "Skip the instrumentation session (see() error tracking + events/metrics/alerts)",
    )
    .addOption(new Option("--no-claude-run", "(deprecated) alias of --no-agent-run").hideHelp())
    .option("--triggers", "Set up the automation trigger without asking (skips the yes/no gate)")
    .option("--no-triggers", "Skip the automation trigger step")
    .option(
      "--trigger-platform <id>",
      "Preselect the trigger platform (claude|codex|cursor|copilot|gemini|jules)",
    )
    .option("--plan", "Open the plan step without asking (skips the yes/no gate)")
    .option("--no-plan", "Skip the plan step (onboarding stays unfinished until it's done)")
    .option("--dry-run", "Show what would change without writing files or calling the API")
    .action(async (opts: SetupOpts) => {
      await runSetup(opts).catch(async (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\nSetup failed: ${message}`);
        await offerSetupIssueReport(message, opts, version);
        process.exit(1);
      });
    });

  // `shipeasy setup triggers` — the automation-trigger step on its own, for
  // returning users who skipped it (or want a different platform). Replaces the
  // deprecated `shipeasy-ops-trigger` skill's entry point.
  const triggers = setup
    .command("triggers")
    .description(
      "Set up an automation trigger — a scheduled agent that fixes queue items as " +
        "PRs, unattended. Opens the hosted, guided setup for your platform.",
    )
    .option("--platform <id>", "Preselect the platform (claude|codex|cursor|copilot|gemini|jules)")
    .option("--dry-run", "Print the URL without opening a browser")
    .action(async (opts: { platform?: string; dryRun?: boolean }) => {
      await runSetupTriggers(opts).catch((err: unknown) => {
        console.error(
          `\nTrigger setup failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      });
    });

  withDetails(
    triggers,
    "A trigger is a scheduled agent run that burns down your feedback queue " +
      "(bugs, feature requests, auto-filed error/alert tickets) and opens one pull " +
      "request per fixed item — nothing merges without you. This command explains " +
      "it, has you pick the platform you code with (Claude Code, Codex, Cursor, " +
      "Copilot, or Gemini/Jules), then opens the hosted, guided setup wizard " +
      "preselected to that platform, which walks you through the platform-specific " +
      "fields and secrets. `shipeasy setup` offers this same step inline.",
  );
  withExamples(triggers, [
    { run: "shipeasy setup triggers", note: "interactive: pick a platform, open the wizard" },
    { run: "shipeasy setup triggers --platform claude", note: "preselect Claude Code" },
    { run: "shipeasy setup triggers --dry-run", note: "just print the URL" },
  ]);

  withDetails(
    setup,
    "`setup` now runs the whole deterministic half of onboarding itself, " +
      "without needing an AI to drive it:\n\n" +
      "0. Preconditions (Node >= 20, git repo — offers `git init`).\n" +
      "1. `detect`-powered monorepo scan; every target gets its own `.shipeasy`.\n" +
      "2. Browser login, then binds the repo root AND each install target.\n" +
      "3. Wires your coding agents — each through its own `mcp add --transport http` "
      + "command where one exists (Claude, Copilot, Codex), else a merged config file "
      + "— plus instruction files + universal AGENTS.md, " +
      "installed in-repo by default (confirms interactively; offers user-global). At " +
      "project scope even Claude stays in-repo (.mcp.json + ./.claude/skills); user " +
      "scope takes the native Claude plugin. Base workflow skills go to every " +
      "non-plugin agent via `npx skills add`.\n" +
      "4. Mints env-locked server/client SDK keys.\n" +
      "5. Runs the SDK package install per target and persists the keys to each " +
      "target's gitignored env file.\n" +
      "6-7. Offers devtools — the browser `<script>` overlay, or, for a React " +
      "Native/Expo target, installs `@shipeasy/react-native-devtools` (+ its Expo " +
      "peers) for the shake-to-open on-device panel; the surface comes from step 1's " +
      "detection, not a question. Then the feature module enables (flags/i18n/ops).\n" +
      "8. Verification gate — session, keys, and every target's binding.\n" +
      "9. Trusts the folder in Claude when its `.mcp.json` server is still pending " +
      "— opens one interactive session prefilled with `/exit`, so it closes itself " +
      "the moment you accept the prompt.\n" +
      "10. Authorizes the hosted MCP connection: entries written to a config that " +
      "is private to your machine carry an `Authorization: Bearer` header (your CLI " +
      "session key) and need no sign-in at all — which is why Copilot's entries go " +
      "to its CLI config and VS Code's user profile, not the repo. Committable ones " +
      "(`.mcp.json`, `.cursor/mcp.json`) never hold a credential, so those take the " +
      "OAuth browser flow via each agent's own `mcp login`.\n" +
      "11. Everything that needs codebase judgement (entry-point `configure(...)` " +
      "wiring, idiomatic secret stores, overlay script injection) is written to " +
      "`shipeasy-wiring.md` — complete, self-contained instructions any coding " +
      "agent (Claude, Codex, Cursor, Copilot, or a human) can execute. Key values " +
      "never appear in that file. Alongside it, the SDK doc pages for exactly what " +
      "you enabled — installation always, plus the overlay, head-tag, flag, " +
      "experiment, metrics, error and i18n pages you turned on — are pulled from " +
      "each SDK's live docs into `shipeasy-wiring-docs/` and linked from the step " +
      "that needs them, so the wiring an agent writes tracks the SDK as it ships " +
      "today rather than whatever this CLI version remembers. Both are temporary — " +
      "once every gate passes the agent asks whether to delete them and commit the " +
      "wiring, and does neither unless you say yes.\n" +
      "12. Offers to bootstrap the instrumentation a module enable can't produce " +
      "on its own: with `ops` on, a session that finds this app's real failure " +
      "paths and reports them through see(); with the release module on, one that " +
      "names the product's critical moments and builds the event → metric → alert " +
      "chain over them. Runs on your own harness with a written brief (skills, " +
      "gates, and a stop-before-commit rule); `--no-bootstrap` skips it.\n" +
      "13. Offers the automation trigger (scheduled queue burn-down as PRs).\n" +
      "14. Opens the browser on the plan step — the two things setup will not " +
      "decide for you: which plan you're on, and the Terms/Privacy agreements. " +
      "Free needs no card; Pro/Business start a 14-day trial through Stripe. " +
      "Completing that screen is what marks onboarding done for the account (an " +
      "account that already finished it lands on Settings → Billing instead); " +
      "`--no-plan` skips it.\n\n" +
      "Idempotent — safe to re-run. In CI (non-TTY) it runs non-interactively with " +
      "`SHIPEASY_CLI_TOKEN` + `SHIPEASY_PROJECT_ID`.",
  );

  withExamples(setup, [
    { run: "shipeasy setup", note: "interactive: full onboarding, prompts as it goes" },
    { run: "shipeasy setup --yes --env prod --features flags", note: "non-interactive" },
    { run: "shipeasy setup --dry-run --no-agent-run", note: "preview without writing" },
    { run: "shipeasy setup --agents claude,cursor --no-devtools", note: "subset, skip overlay" },
  ]);
}
