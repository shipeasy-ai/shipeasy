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
  type McpAuthResult,
  type McpResult,
  MCP_AUTH_INSTRUCTIONS,
  approveProjectMcpServer,
  claudeServerState,
  SKILLS_CLI_AGENT,
  detectAgents,
  detectHarness,
  installClaudePlugin,
  onPath,
  registerMcp,
  runMcpAuth,
} from "../setup/agents";
import {
  fetchSdkDoc,
  fetchSdkSkill,
  installMarketplaceSkills,
  installSkill,
} from "../setup/sdk-docs";
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
  maskKey,
  needsStoreMove,
  persistEnv,
  projectIdVar,
  relPath,
  runSdkInstall,
  SERVER_KEY_VAR,
} from "../setup/onboard";
import { buildWiringDoc, type WiringTarget } from "../setup/wiring-doc";
import { promptAndSend, reportConfigured } from "../setup/report-issue";
import { runTriggerStep, type TriggerStepResult, type CliSession } from "../setup/triggers";

/** Project the loaded CLI credentials onto the minimal session the trigger step
 *  needs (token + admin-API origin). Null-safe: no creds → no session. */
function sessionFromCreds(creds: ShipeasyConfig | null): CliSession | null {
  return creds ? { token: creds.cli_token, appBaseUrl: creds.app_base_url } : null;
}
import { BROWSER_FRAMEWORKS, detectTargets, type TargetRecommendation } from "./scan";
import { recordDetection } from "./detect";
import { enableModuleGroup, type EnableResult } from "./install";
import { withExamples, withDetails } from "../util/examples";
import { getPlatformModuleGates } from "../util/platform-gates";
import { bold, bullet, cyan, dim, format, wrapText, type WrapOpts } from "../util/format";

const ALL_AGENTS: AgentId[] = ["claude", "cursor", "codex", "copilot", "jules"];
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
  triggers?: boolean; // commander --triggers → true, --no-triggers → false, unset → ask
  triggerPlatform?: string;
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

  // Explicit --agents wins.
  if (opts.agents) {
    const requested = opts.agents
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const unknown = requested.filter((r) => !ALL_AGENTS.includes(r as AgentId));
    if (unknown.length) {
      throw new Error(`Unknown agent(s): ${unknown.join(", ")}. Known: ${ALL_AGENTS.join(", ")}`);
    }
    return requested as AgentId[];
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
): Promise<KeyCreated> {
  // Pass the resolved project id explicitly so the key is minted against the
  // project setup bound to cwd — never a re-walk of `.shipeasy` that could
  // resolve to an ancestor binding on a different (already-full) project.
  const client = getApiClient(projectId, { requireBinding: true });
  return client.request<KeyCreated>("POST", "/api/admin/keys", { type, env });
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
 *    claude   → --dangerously-skip-permissions
 *    codex    → --dangerously-bypass-approvals-and-sandbox
 *    cursor   → --force
 *    copilot  → --allow-all-tools (kept with `-i`: interactive-with-prompt, since
 *               `-p`/non-interactive can't be granted tool/path access at all) */
const RUNNABLE_AGENTS: Array<{
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
    argv: (p) => ["--allow-all-tools", "-i", p],
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
    "  • Pull version-correct wiring with `shipeasy docs get --sdk <lang> <page>`.",
    "  • Honour every verification gate; self-heal once, then stop and report.",
    "  • Stop at 'ready to commit' — hand the user the `git add` list, don't commit.",
    `  • Delete ${WIRING_FILENAME} once all gates pass.`,
    "════════════════════════════════════════════════════════════════",
  ].join("\n");
}

/** What this run actually asked for, in the terms the wiring doc will act on.
 *  Feeds the plain-English "here's what the agent is about to do" block. */
export interface WiringPlan {
  targets: WiringTarget[];
  devtools: boolean;
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
  if (plan.targets.some((t) => t.browser)) {
    lines.push("initialise the browser SDK with the public client key");
  }
  if (plan.targets.some((t) => t.secretStoreMove)) {
    lines.push("move the minted keys into this project's idiomatic secret store");
  }
  if (plan.devtools) {
    lines.push(
      "add the devtools overlay <script> tag to your layout (the ?se=1 panel + end-user bug reports)",
    );
  }
  if (plan.features.includes("ops")) {
    lines.push("report caught errors through the SDK's see() primitive so they reach your ops queue");
  }
  if (plan.features.includes("i18n")) {
    lines.push("wrap user-facing copy as translatable i18n keys");
  }
  lines.push(
    "check the app still builds, then hand you the `git add` list — it stops short of committing",
  );
  return lines;
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

  const { ok } = await prompts({
    type: "confirm",
    name: "ok",
    message: "OK to launch it now?",
    initial: true,
  });
  if (!ok) return;

  // One available agent → just run it; several → let the user say which.
  let chosen = available[0];
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
    if (!picked) return;
    chosen = picked;
  }

  say(`\nLaunching: ${chosen.bin} …\n`);
  const code = await spawnAgent(chosen.bin, chosen.argv(WIRING_PROMPT));
  if (code !== 0) {
    say(`\n${chosen.bin} exited with code ${code}. You can re-run it anytime.`);
  }
}

/**
 * The one-time MCP OAuth authorization step. The hosted MCP server
 * (mcp.shipeasy.ai) authenticates with OAuth 2.1 — a browser sign-in per client,
 * no key to paste. Where the agent ships a login command (`claude mcp login`,
 * `cursor-agent mcp login`) setup RUNS it, so the user never has to go find a
 * settings pane; the rest get the printed one-liner. A coding agent driving the
 * CLI gets a directive to authorize its OWN connection instead (we must not
 * hijack its terminal with a browser flow). Runs BEFORE the wiring hand-off so
 * the MCP tools are usable the moment the agent picks up shipeasy-wiring.md.
 */
/**
 * First prompt handed to the trust session, exactly as the wiring hand-off
 * passes {@link WIRING_PROMPT}: Claude queues a positional prompt behind the
 * trust dialog, so accepting trust drops the user straight into the MCP panel
 * with `shipeasy` selected and its auth state showing — no `/mcp` to remember.
 *
 * It is deliberately bare `/mcp`. Claude has no `/mcp add`: the in-session
 * command is `/mcp [reconnect|enable|disable [<server>|all]]` (verified against
 * claude 2.1.220), and adding a server is a CLI-level `claude mcp add` /
 * `claude plugin install` — which `shipeasy setup` has already done by the time
 * we get here. That's precisely why the entry is *pending* rather than missing,
 * so the only thing left for this session is trust + Authenticate.
 */
export const TRUST_SESSION_PROMPT = "/mcp";

/**
 * Hand the terminal to an interactive Claude session so the user can trust this
 * folder — the one thing no config file can do for them. Claude only shows its
 * trust prompt in an interactive session; until it's accepted, a `.mcp.json`
 * server stays "⏸ Pending approval" no matter what `enabledMcpjsonServers`
 * says, which is why `claude mcp login` exits 1.
 *
 * Trust is the ONLY thing that needs the session, so that's all we ask for —
 * and we prefill {@link TRUST_SESSION_PROMPT} so the MCP panel is already open
 * when the dialog clears. Either way we win: authorize there, or `/exit` and we
 * re-probe and drive `claude mcp login` ourselves (the same browser sign-in).
 */
async function trustClaudeInteractively(pending: McpAuthResult): Promise<McpAuthResult> {
  say();
  explain(
    "Claude hasn't trusted this folder yet — that prompt only appears in an interactive " +
      "session, so its `.mcp.json` server stays pending until then. I can open Claude here " +
      "now. **All you do in that session:**",
  );
  say();
  say(bullet("accept the trust prompt (the `shipeasy` server is already approved)", { glyph: "1." }));
  say(bullet("the MCP panel opens on `shipeasy` — Authenticate there, or just `/exit`", { glyph: "2." }));
  say();
  explain("Either way you're covered: if you skip it, I run the browser sign-in from here");
  say();
  const { open } = await prompts({
    type: "confirm",
    name: "open",
    message: "Open Claude here now to trust the folder?",
    initial: true,
  });
  if (!open) return pending;

  say("\nLaunching: claude …\n");
  await spawnAgent("claude", [TRUST_SESSION_PROMPT]);

  // Trust granted, so the server is no longer pending — which is the ONLY thing
  // that was blocking `claude mcp login`. Drive it now instead of handing the
  // user a `/mcp` errand. runMcpAuth re-checks the state itself, so an
  // already-connected server (they authorized inside the session) costs nothing
  // and a still-untrusted folder comes back as pending rather than a hard error.
  if (claudeServerState("shipeasy") === "pending") {
    return {
      action: "manual",
      detail:
        "still pending — the trust prompt wasn't accepted. Re-open `claude` here, accept it,\n" +
        "      then run `shipeasy setup` again (or `claude mcp login shipeasy`)",
    };
  }
  say("  Finishing the MCP sign-in…");
  const after = runMcpAuth("claude");
  return after.action === "failed"
    ? {
        action: "manual",
        detail: `${after.detail} — run \`claude mcp login shipeasy\` here, or \`/mcp\` → shipeasy → Authenticate`,
      }
    : after;
}

export async function mcpAuthHandoff(
  selected: AgentId[],
  interactive: boolean,
  opts: { dryRun?: boolean } = {},
): Promise<void> {
  // Caller owns the step heading — this is step 9 of `shipeasy setup`, and the
  // "no agents wired" case still needs the heading printed above it.
  if (selected.length === 0) return;
  explain(
    "The hosted Shipeasy MCP server (mcp.shipeasy.ai) authenticates with **OAuth** — a " +
      "one-time browser sign-in per client, no key to paste. Authorizing it now, so the MCP " +
      "tools work the moment the wiring steps run.",
  );
  say();

  if (detectHarness().inside) {
    // A coding agent is driving this terminal — we must not seize it with a
    // browser flow, so it authorizes its own connection from the instructions.
    // Printed verbatim, one per line: a coding agent reads these back and acts
    // on them, so they must not be re-flowed mid-sentence.
    for (const id of selected) say(`    • ${MCP_AUTH_INSTRUCTIONS[id]}`);
    say();
    explain(
      "▶ **CODING AGENT: authorize your OWN shipeasy MCP connection now** — run your client's " +
        "MCP Authenticate step (above) and approve in the browser BEFORE starting the wiring " +
        "steps, or every shipeasy_* tool call will 401.",
    );
    return;
  }

  // Drive each agent's own login command where one exists — that's the whole
  // point: no hand-configuration. Only what's left over (Codex/Copilot/Jules, or
  // a binary that isn't on PATH) gets an instruction to follow by hand.
  const manual: AgentId[] = [];
  for (const id of selected) {
    let r = runMcpAuth(id, { dryRun: opts.dryRun });
    // A pending Claude server means the FOLDER isn't trusted yet, and the trust
    // prompt only exists inside an interactive session — so offer to open one
    // right here rather than ending setup with a to-do. One session covers
    // everything: trust, the (pre-approved) server, and `/mcp` authentication.
    if (id === "claude" && r.action === "manual" && interactive && !opts.dryRun && onPath("claude")) {
      r = await trustClaudeInteractively(r);
    }
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
  const ctx: InstallCtx = { cwd, scope, force: false, dryRun, projectId: projectId || undefined };
  // The `skills` CLI names for the agents that take skills via `npx skills add`
  // (not the plugin): cursor/codex/copilot. Claude is excluded at BOTH scopes —
  // it now installs the plugin either way, and the plugin already ships these
  // skills, so routing Claude through the skills CLI as well would write a second
  // copy of every one of them into `./.claude/skills`. Fallback: when `claude`
  // isn't on PATH the plugin can't install, and `installClaudePlugin` prints the
  // two commands to run once it is. The skills CLI names Claude Code
  // `claude-code` — bare `claude` errors "Invalid agents: claude".
  const skillsCliAgents = selected
    .map((a) => (a === "claude" ? null : (SKILLS_CLI_AGENT[a] ?? null)))
    .filter(Boolean) as string[];
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
  const needServer = actionable.some((t) => !t.shipeasy.env_keys_detected.includes(SERVER_KEY_VAR));
  const needClient = actionable.some(
    (t) => browserTarget(t) && !t.shipeasy.env_keys_detected.some((k) => k.includes("CLIENT")),
  );
  if (!actionable.length) {
    say("  • no targets need keys — skipping");
  } else if (dryRun) {
    say("  (dry run — would mint server" + (needClient ? " + client" : "") + " keys)");
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
    if (needServer) {
      serverKey = await mintKey("server", keyEnv, projectId);
      say(`  ✓ server key minted (${keyEnv}): ${maskKey(serverKey.key)}`);
    }
    if (needClient) {
      clientKey = await mintKey("client", keyEnv, projectId);
      say(`  ✓ client key minted (${keyEnv}): ${maskKey(clientKey.key)} (public)`);
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
      // reaches the wiring doc (step 10) and the harness never walks it.
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
      if (serverKey) entries[SERVER_KEY_VAR] = serverKey.key;
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

  // 6. Devtools overlay (in-page panel + end-user feedback surface)
  heading("6. Devtools overlay");
  // Lead with what it is so the customer can decide before we ask anything.
  explain(
    "**What it is:** a tiny in-page panel your team opens with `?se=1` to see and toggle the " +
      "live flags/experiments the current user is getting, plus a widget end users can use to " +
      "file bug reports straight into your ops queue. It's a single opt-in `<script>` tag — it " +
      "loads only when invoked, so there's no impact on your normal bundle.",
  );
  explain("Docs: https://docs.shipeasy.ai/feedback/devtools");
  say();
  // Non-skip targets (includes already-onboarded ones, which may still want the
  // overlay even though their recommendation.keys is empty).
  const nonSkipTargets = detected.targets.filter(
    (t) => !t.recommendation.action.startsWith("skip"),
  );
  // Targets whose framework we recognise as browser-facing. This drives the
  // *default* answer only — the overlay just needs an HTML surface to inject
  // its <script> into, which is broader than the frameworks we pattern-match,
  // so we ask rather than hard-gate on detection.
  const frameworkBrowser = nonSkipTargets.filter((t) =>
    t.frameworks.some((f) => BROWSER_FRAMEWORKS.has(f)),
  );
  let browserCandidates = frameworkBrowser;
  let devtoolsAccepted = false;
  let opsEnabled: EnableResult | null = null;

  if (dryRun) {
    say(
      "  (dry run — would confirm the HTML surface, then offer the overlay + ops module)",
    );
  } else {
    // Does the project render HTML in a browser? Default from detection; an
    // explicit --devtools / --no-devtools flag skips the question outright.
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
      // actionable target rather than skipping.
      if (!browserCandidates.length) browserCandidates = nonSkipTargets;

      if (opts.devtools !== undefined) {
        devtoolsAccepted = opts.devtools;
      } else if (interactive) {
        const { yes } = await prompts({
          type: "confirm",
          name: "yes",
          message:
            "Add the Shipeasy devtools overlay? (in-page flag/experiment panel via ?se=1 + end-user bug reports)",
          initial: true,
        });
        devtoolsAccepted = Boolean(yes);
      }

      if (devtoolsAccepted) {
        try {
          opsEnabled = await enableModuleGroup("ops");
          say(`  ✓ ops module enabled (${opsEnabled.enabled_modules.join(", ")})`);
        } catch (e) {
          say(
            `  ✗ ops module enable failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        // The overlay script reads the project id from public env — persist it now.
        for (const t of browserCandidates) {
          const w = persistEnv(t.path, envFileFor(t), {
            [projectIdVar(t.frameworks)]: projectId,
          });
          if (w.added.length)
            say(`  ✓ ${relPath(root, t.path)}/${w.file}: added ${w.added.join(", ")}`);
        }
        say("  → the <script> tag injection is in the wiring steps (needs your layout)");
      } else {
        say(
          "  • declined — add later with `shipeasy install ops` (see the shipeasy-ops skill)",
        );
      }
    }
  }

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

  // 9. Authorize the hosted MCP connection (OAuth).
  //
  // Its own step, immediately after the verification gate and BEFORE the wiring
  // hand-off. Two reasons it can't ride along inside step 10 any more:
  //  - it's a browser round-trip the user has to complete — the one place setup
  //    hands over control — so it gets its own heading rather than appearing
  //    mid-way through another step's output;
  //  - step 10 only ran when there was something left to wire, which silently
  //    skipped authorization for a repo that needed no code changes but had just
  //    had its agents wired. Those runs ended with a 401 on the first tool call.
  heading("9. Authorize the MCP connection");
  if (dryRun) {
    say("  (dry run — would run each agent's MCP sign-in, or print its manual step)");
  } else if (!selected.length) {
    say("  • no agents wired — nothing to authorize");
  } else {
    await mcpAuthHandoff(selected, interactive, { dryRun });
  }

  // 10. Remaining (non-deterministic) wiring → instructions for ANY harness
  heading("10. Remaining wiring — instructions for your coding agent");
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

    const sampleBrowser =
      browserCandidates.find((t) => !deselectedTargets.has(t.path)) ??
      actionable.find((t) => browserTarget(t) && !deselectedTargets.has(t.path));
    const doc = buildWiringDoc({
      projectId,
      targets: wiringTargets,
      devtools:
        devtoolsAccepted && sampleBrowser
          ? {
              clientKeyVar: clientKeyVar(sampleBrowser.frameworks),
              projectIdVar: projectIdVar(sampleBrowser.frameworks),
              clientKey: clientKey?.key ?? null,
            }
          : null,
      enabledFeatures,
      featureDocs,
      buildTargets: wiringTargets
        .filter((t) => t.language === "typescript" || t.language === "javascript")
        .map((t) => t.relPath),
      // Harnesses we just registered the MCP server into — drives the reload notice.
      agents: selected,
    });
    const wiringPath = join(root, WIRING_FILENAME);
    writeFileSync(wiringPath, doc, "utf8");
    say(`  ✓ wrote ${wiringPath}\n`);
    await wiringHandoff(root, opts, interactive, selected, {
      targets: wiringTargets,
      devtools: devtoolsAccepted,
      features: enabledFeatures,
    });
  }

  // 11. Automation trigger (unattended auto-apply — the queue burn-down loop)
  heading("11. Automation trigger");
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
    devtoolsAccepted ? "enabled (wire the script tag — see wiring steps)" : "declined",
  );
  row("Features:", features.length ? features.join(", ") : "none enabled");
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
  if (anythingToWire && !dryRun) {
    row("Wiring:", `${WIRING_FILENAME} — hand it to any coding agent to finish`);
  }
  if (projectId) {
    // `/dashboard/<id>`, not `/projects/<id>` — the latter is a 404; the app has
    // no `/projects` route at all.
    row("Dashboard:", `${appBaseUrl()}/dashboard/${projectId}`);
  }
  say();
  explain("When the wiring is done, commit — setup never commits for you:", { indent: "" });
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
        "Cursor/Codex/Copilot/Jules), mints SDK keys, installs @shipeasy/sdk, and offers the " +
        "devtools overlay + feature modules — then writes self-contained SDK-wiring steps to " +
        "shipeasy-wiring.md for your agent to finish. Monorepo-aware and idempotent (safe to " +
        "re-run). Run `shipeasy setup --help` for every flag; `shipeasy setup triggers` sets up " +
        "the scheduled queue-fixing automation on its own.",
    )
    .option("--yes", "Non-interactive: accept defaults everywhere (bind, prod keys, run installs)")
    .option("--agents <list>", "Comma list to wire (claude,cursor,codex,copilot,jules)")
    .option("--domain <domain>", "Production domain (used when creating a new project at login)")
    .option(
      "--scope <scope>",
      "MCP + skills scope: project (in-repo, default) | user (global). Omit to be asked.",
    )
    .option("--env <env>", "Environment the minted SDK keys read: dev | staging | prod")
    .option("--devtools", "Enable the devtools overlay without asking")
    .option("--no-devtools", "Skip the devtools overlay without asking")
    .option("--features <list>", "Module groups to enable non-interactively (flags,i18n,ops)")
    .option("--skip-install", "Don't run SDK package installs (they go into the wiring steps)")
    .option("--no-agent-run", "Don't offer to launch a coding agent on the wiring steps")
    .addOption(new Option("--no-claude-run", "(deprecated) alias of --no-agent-run").hideHelp())
    .option("--triggers", "Set up the automation trigger without asking (skips the yes/no gate)")
    .option("--no-triggers", "Skip the automation trigger step")
    .option(
      "--trigger-platform <id>",
      "Preselect the trigger platform (claude|codex|cursor|copilot|gemini|jules)",
    )
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
      "3. Wires your coding agents — MCP + instruction files + universal AGENTS.md, " +
      "installed in-repo by default (confirms interactively; offers user-global). At " +
      "project scope even Claude stays in-repo (.mcp.json + ./.claude/skills); user " +
      "scope takes the native Claude plugin. Base workflow skills go to every " +
      "non-plugin agent via `npx skills add`.\n" +
      "4. Mints env-locked server/client SDK keys.\n" +
      "5. Runs the SDK package install per target and persists the keys to each " +
      "target's gitignored env file.\n" +
      "6-7. Offers the devtools overlay + feature module enables (flags/i18n/ops).\n" +
      "8. Verification gate — session, keys, and every target's binding.\n" +
      "9. Authorizes the hosted MCP connection (OAuth browser sign-in per client), " +
      "driving each agent's own `mcp login` where it ships one.\n" +
      "10. Everything that needs codebase judgement (entry-point `configure(...)` " +
      "wiring, idiomatic secret stores, overlay script injection) is written to " +
      "`shipeasy-wiring.md` — complete, self-contained instructions any coding " +
      "agent (Claude, Codex, Cursor, Copilot, or a human) can execute. Key values " +
      "never appear in that file.\n" +
      "11. Offers the automation trigger (scheduled queue burn-down as PRs).\n\n" +
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
