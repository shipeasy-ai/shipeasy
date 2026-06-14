import { Command } from "commander";
import { spawn } from "node:child_process";
import prompts from "prompts";
import { login } from "../auth/login";
import { loadCredentials } from "../auth/storage";
import { bindProject, getBoundProjectId } from "../util/project-config";
import { getApiClient } from "../api/client";
import {
  type AgentId,
  type InstallCtx,
  type McpResult,
  detectAgents,
  installClaudePlugin,
  onPath,
  registerMcp,
} from "../setup/agents";
import {
  type FileResult,
  writeAgentsMd,
  writeCopilotInstructions,
  writeCursorRule,
} from "../setup/instructions";
import { detectProject } from "./scan";
import { withExamples, withDetails } from "../util/examples";

const ALL_AGENTS: AgentId[] = ["claude", "cursor", "codex", "copilot", "jules"];

interface SetupOpts {
  yes?: boolean;
  agents?: string;
  domain?: string;
  scope?: "user" | "project";
  dryRun?: boolean;
  claudeRun?: boolean; // commander --no-claude-run → false
}

// ── small print helpers (no chalk — the CLI avoids ESM-only deps) ───────────

function heading(title: string): void {
  console.log(`\n${title}\n${"─".repeat(title.length)}`);
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
 * file. Claude takes the native plugin path (marketplace + plugin install).
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

/**
 * Guarantee we end authenticated AND with `.shipeasy` bound for this folder.
 * `login({})` already runs the full browser pick-or-create-and-bind flow for a
 * fresh user. The only gap it leaves is an already-authed user opening a fresh
 * repo — that's what the extra branch handles.
 */
async function ensureAuthAndBind(interactive: boolean): Promise<void> {
  heading("1. Authenticate + bind project");
  await login({}); // idempotent; runs device flow + picker + auto-bind when no session

  if (getBoundProjectId(process.cwd())) return; // bound (pre-existing or just bound by login)

  const creds = loadCredentials();
  if (!creds) throw new Error("Authentication did not produce credentials.");

  if (!interactive) {
    const { path } = bindProject(process.cwd(), creds.project_id);
    console.log(`Bound this folder to project ${creds.project_id} → ${path}`);
    return;
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
    await login({ ensureBound: true });
    return;
  }
  // default / "current"
  const { path } = bindProject(process.cwd(), creds.project_id, name);
  console.log(`Bound this folder to ${name ?? creds.project_id} → ${path}`);
}

// ── agent selection ─────────────────────────────────────────────────────────

async function selectAgents(opts: SetupOpts, interactive: boolean): Promise<AgentId[]> {
  const detected = detectAgents(process.cwd());

  heading("2. Coding agents");
  for (const a of detected) {
    console.log(`  ${a.detected ? "✓" : "·"} ${a.label.padEnd(16)} ${a.reason}`);
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
    console.log(
      auto.length
        ? `\nNon-interactive: wiring detected agents → ${auto.join(", ")}`
        : "\nNon-interactive: no agents detected; pass --agents to choose explicitly.",
    );
    return auto;
  }

  const { picked } = await prompts({
    type: "multiselect",
    name: "picked",
    message: "Which coding agents should I wire Shipeasy into?",
    choices: detected.map((a) => ({
      title: a.label,
      value: a.id,
      selected: a.detected,
    })),
    hint: "space to toggle, enter to confirm",
    instructions: false,
  });
  return (picked as AgentId[] | undefined) ?? [];
}

// ── Claude code-wiring handoff ──────────────────────────────────────────────

function insideClaudeCode(): boolean {
  return Boolean(
    process.env.CLAUDECODE || process.env.CLAUDE_CODE || process.env.CLAUDE_CODE_ENTRYPOINT,
  );
}

function spawnClaude(arg: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("claude", [arg], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", () => resolve(1));
  });
}

async function claudeHandoff(opts: SetupOpts, interactive: boolean): Promise<void> {
  heading("4. Finish the in-repo SDK wiring (Claude)");
  const slash = `/shipeasy:setup${opts.domain ? ` --domain ${opts.domain}` : ""}`;

  if (insideClaudeCode()) {
    console.log(
      `You're already in a Claude Code session. Finish SDK install + entry-point\n` +
        `wiring by running this slash command here:\n\n  ${slash}\n`,
    );
    return;
  }

  if (!onPath("claude")) {
    console.log(
      `Install Claude Code, then run the in-repo wiring:\n\n  claude "${slash}"\n` +
        `  # or headless: claude -p "${slash}"\n`,
    );
    return;
  }

  if (opts.claudeRun === false || opts.dryRun) {
    console.log(`Skipping the Claude run. Finish anytime with:\n\n  claude "${slash}"\n`);
    return;
  }

  let proceed = false;
  if (interactive) {
    const r = await prompts({
      type: "confirm",
      name: "go",
      message: `Run the SDK code-wiring now by launching Claude Code on "${slash}"?`,
      initial: true,
    });
    proceed = Boolean(r.go);
  }

  if (!proceed) {
    console.log(`When ready, run:\n\n  claude "${slash}"\n`);
    return;
  }

  console.log(`\nLaunching: claude "${slash}"\n`);
  const code = await spawnClaude(slash);
  if (code !== 0) {
    console.log(`\nClaude exited with code ${code}. You can re-run:\n\n  claude "${slash}"\n`);
  }
}

// ── command ─────────────────────────────────────────────────────────────────

async function runSetup(opts: SetupOpts): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY) && !opts.yes;
  const scope: "user" | "project" = opts.scope === "user" ? "user" : "project";

  console.log("Shipeasy setup — one-command onboarding\n");

  // Pre-flight: report what we detected (best-effort).
  heading("0. Project");
  try {
    const scan = await detectProject();
    if (scan.status === "ok" && scan.projects[0]) {
      const p = scan.projects[0];
      console.log(`  path:       ${p.path}`);
      console.log(`  language:   ${p.language}`);
      console.log(`  frameworks: ${p.frameworks.join(", ") || "—"}`);
      console.log(
        `  @shipeasy/sdk: ${p.shipeasy.experimentation_sdk.installed ? "installed" : "not installed"}`,
      );
    } else if (scan.status === "needs_clarification") {
      console.log(`  ${scan.reason}`);
      console.log("  (continuing — setup binds at the current directory)");
    }
  } catch (e) {
    console.log(`  (project scan skipped: ${e instanceof Error ? e.message : String(e)})`);
  }

  // 1. Auth + bind
  if (opts.dryRun) {
    heading("1. Authenticate + bind project");
    console.log("  (dry run — would run `shipeasy login` and write .shipeasy if unbound)");
  } else {
    await ensureAuthAndBind(interactive);
  }

  // 2. Select agents
  const selected = await selectAgents(opts, interactive);

  // 3. Wire each agent + the universal AGENTS.md
  heading("3. Wire agents");
  const ctx: InstallCtx = {
    cwd: process.cwd(),
    scope,
    force: false,
    dryRun: Boolean(opts.dryRun),
  };
  if (selected.length === 0) {
    console.log("  (no agents selected — skipping)");
  } else {
    for (const agent of selected) {
      console.log(`\n  ${agent}:`);
      for (const line of applyAgent(agent, ctx)) console.log(line);
    }
    // Universal instructions — benefits every agent (and any we don't special-case).
    console.log("");
    console.log(formatFile("AGENTS.md", writeAgentsMd(ctx)));
  }

  // 4. Claude in-repo wiring handoff
  if (selected.includes("claude")) {
    await claudeHandoff(opts, interactive);
  }

  // 5. Summary
  heading("Done");
  console.log("Next steps:");
  console.log("  • shipeasy whoami                 — confirm auth + bound project");
  console.log(
    "  • /shipeasy:flags:install         — feature gates, configs, kill switches, experiments",
  );
  console.log("  • /shipeasy:ops:install           — in-app feedback + production-error tracking");
  console.log("  • /shipeasy:i18n:install          — translations");
  if (opts.dryRun) console.log("\n(dry run — no files were written.)");
}

export function setupCommand(parent: Command): void {
  const setup = parent
    .command("setup")
    .description(
      "One-command onboarding: log in + bind a project, detect your coding agents, " +
        "register the Shipeasy MCP server + skills, and hand SDK wiring to the agent.",
    )
    .option("--yes", "Non-interactive: bind current project + wire all detected agents")
    .option("--agents <list>", "Comma list to wire (claude,cursor,codex,copilot,jules)")
    .option("--domain <domain>", "Production domain, passed to the Claude /shipeasy:setup step")
    .option("--scope <scope>", "user | project (MCP config scope)", "project")
    .option("--no-claude-run", "Don't launch Claude Code for the in-repo wiring step")
    .option("--dry-run", "Show what would change without writing files or launching anything")
    .action(async (opts: SetupOpts) => {
      await runSetup(opts).catch((err: unknown) => {
        console.error(`\nSetup failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      });
    });

  withDetails(
    setup,
    "`setup` is the one place that wires Shipeasy into your coding agents — there " +
      "is no separate `skills`/`plugin` install step. It **detects every agent** " +
      "in your environment (Claude Code, Cursor, OpenAI Codex, GitHub Copilot, " +
      "Google Jules) and wires each one the way that agent expects:\n\n" +
      "- **Claude Code** — installs the marketplace plugin (slash commands + " +
      "skills + MCP), or drops `.mcp.json` when the `claude` binary isn't on PATH.\n" +
      "- **Cursor / Codex / Copilot / Jules** — registers the `@shipeasy/mcp` " +
      "server in that agent's config and writes its instructions file " +
      "(`.cursor/rules/shipeasy.mdc`, `AGENTS.md`, `.github/copilot-instructions.md`).\n\n" +
      "Pick a subset with `--agents`, or let it auto-detect. It's idempotent — " +
      "safe to re-run as you add agents. In CI (non-TTY) it runs non-interactively " +
      "with `SHIPEASY_CLI_TOKEN` + `SHIPEASY_PROJECT_ID`.",
  );

  withExamples(setup, [
    { run: "shipeasy setup", note: "interactive: detect + wire every agent found" },
    { run: "shipeasy setup --yes --agents claude,cursor", note: "non-interactive subset" },
    { run: "shipeasy setup --dry-run --no-claude-run", note: "preview without writing" },
  ]);
}
