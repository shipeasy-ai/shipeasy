import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import prompts from "prompts";
import {
  type AgentId,
  type InstallCtx,
  MCP_URL,
  SKILLS_CLI_AGENT,
  detectAgents,
  installClaudePlugin,
  onPath,
  registerMcp,
} from "../setup/agents";
import { fetchSdkSkill, installMarketplaceSkill, installSkill } from "../setup/sdk-docs";
import { baseSkillNames } from "../setup/skills-registry";
import { getBoundSdk } from "../util/project-config";
import { listDirs } from "../util/assets";
import { detectTargets, type TargetRecommendation } from "./scan";
import { withDetails, withExamples } from "../util/examples";

/**
 * `shipeasy upgrade` — bring a machine's Shipeasy install up to date in one
 * command: the CLI binary itself, the coding-agent wiring (Claude plugin / MCP
 * registration), the how-to skills (re-fetched from the marketplace), and —
 * offered, never forced — the `@shipeasy/sdk` dependency in each onboarded
 * target.
 *
 * `shipeasy upgrade skills` is the light path: the CLI + skills only (the two
 * things that ship new content most often), skipping the MCP re-registration
 * and the SDK bump.
 *
 * Everything here is best-effort and idempotent — a missing agent, an offline
 * registry, or a package manager that isn't on PATH degrades to a printed
 * "run this yourself" line rather than failing the whole upgrade.
 */

const ALL_AGENTS: AgentId[] = ["claude", "cursor", "codex", "copilot", "jules"];
const CLI_PACKAGE = "@shipeasy/cli";

type GlobalPm = "npm" | "pnpm" | "yarn" | "bun";

interface UpgradeOpts {
  agents?: string;
  scope?: "user" | "project";
  pm?: string;
  skipCli?: boolean;
  skipSdk?: boolean;
  yes?: boolean;
  dryRun?: boolean;
}

// ── small print helpers (no chalk — the CLI avoids ESM-only deps) ───────────

function heading(title: string): void {
  console.log(`\n${title}\n${"─".repeat(title.length)}`);
}

// ── CLI self-update ──────────────────────────────────────────────────────────

/** The argv that installs `@shipeasy/cli@latest` globally for a package manager. */
export function cliUpdateArgv(pm: GlobalPm): string[] {
  switch (pm) {
    case "pnpm":
      return ["pnpm", "add", "-g", `${CLI_PACKAGE}@latest`];
    case "yarn":
      return ["yarn", "global", "add", `${CLI_PACKAGE}@latest`];
    case "bun":
      return ["bun", "add", "-g", `${CLI_PACKAGE}@latest`];
    case "npm":
    default:
      return ["npm", "install", "-g", `${CLI_PACKAGE}@latest`];
  }
}

/**
 * Best-effort guess at which package manager owns the running global install,
 * from the path the binary resolves through. Defaults to npm — the common case
 * and the one every `--pm` override can correct.
 */
function detectGlobalPm(): GlobalPm {
  const hint = `${process.argv[1] ?? ""} ${process.env._ ?? ""}`.toLowerCase();
  if (hint.includes("pnpm")) return "pnpm";
  if (hint.includes("bun")) return "bun";
  if (hint.includes("yarn")) return "yarn";
  return "npm";
}

function resolvePm(opts: UpgradeOpts): GlobalPm {
  const valid: GlobalPm[] = ["npm", "pnpm", "yarn", "bun"];
  if (opts.pm) {
    if (!valid.includes(opts.pm as GlobalPm)) {
      throw new Error(`Invalid --pm '${opts.pm}'. Choose from: ${valid.join(", ")}`);
    }
    return opts.pm as GlobalPm;
  }
  return detectGlobalPm();
}

/** Self-update the CLI binary. The new version applies to the NEXT invocation —
 *  the running process keeps its current code. Never throws. */
function selfUpdateCli(opts: UpgradeOpts, currentVersion: string): void {
  const pm = resolvePm(opts);
  const argv = cliUpdateArgv(pm);
  const cmd = argv.join(" ");
  if (!onPath(argv[0]!)) {
    console.log(`  • ${pm} not on PATH — update the CLI yourself: ${cmd}`);
    return;
  }
  if (opts.dryRun) {
    console.log(`  (dry run — would run: ${cmd})`);
    return;
  }
  console.log(`  → ${cmd} (current: ${currentVersion})`);
  const res = spawnSync(argv[0]!, argv.slice(1), { stdio: "inherit" });
  if (res.status === 0) {
    console.log("  ✓ CLI updated — the new version applies to your next `shipeasy` command");
  } else {
    console.log(`  ✗ CLI update failed (exit ${res.status ?? "?"}) — run it yourself: ${cmd}`);
  }
}

// ── scope + agent resolution ─────────────────────────────────────────────────

/**
 * Where the skills + MCP config live. An explicit `--scope` wins; otherwise we
 * infer from the repo: an in-repo `.claude/skills`, `.mcp.json`, or `.shipeasy`
 * means this was set up at project scope, so we refresh there; nothing in the
 * tree means the install is user-global.
 */
export function resolveScope(opts: UpgradeOpts, cwd: string): "user" | "project" {
  if (opts.scope === "user" || opts.scope === "project") return opts.scope;
  if (opts.scope) throw new Error(`Invalid --scope '${opts.scope}'. Must be 'project' or 'user'.`);
  const projectSignals = [
    join(cwd, ".claude", "skills"),
    join(cwd, ".mcp.json"),
    join(cwd, ".shipeasy"),
    join(cwd, ".cursor", "mcp.json"),
    join(cwd, ".vscode", "mcp.json"),
  ];
  return projectSignals.some((p) => existsSync(p)) ? "project" : "user";
}

function resolveAgents(opts: UpgradeOpts, cwd: string): AgentId[] {
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
  return detectAgents(cwd)
    .filter((a) => a.detected)
    .map((a) => a.id);
}

/** The `skills` CLI agent names that take skills via `npx skills add` for this
 *  scope — cursor/codex/copilot always, Claude only at project scope (user
 *  scope gets its skills from the plugin instead). */
function skillsCliAgentsFor(agents: AgentId[], scope: "user" | "project"): string[] {
  return agents
    .map((a) =>
      a === "claude" ? (scope === "project" ? "claude" : null) : (SKILLS_CLI_AGENT[a] ?? null),
    )
    .filter((x): x is string => Boolean(x));
}

// ── installed-skill discovery ────────────────────────────────────────────────

/**
 * The marketplace how-to skills already on disk, discovered by scanning the
 * conventional skills roots for `shipeasy-*` folders. We only refresh what's
 * actually installed so an upgrade doesn't graft feature skills the user never
 * chose; when nothing is found we fall back to the full catalogue.
 */
function discoverInstalledSkills(cwd: string): Set<string> {
  const home = homedir();
  const roots = [
    join(cwd, ".claude", "skills"),
    join(home, ".claude", "skills"),
    join(cwd, ".cursor", "skills"),
    join(home, ".cursor", "skills"),
    join(cwd, ".codex", "skills"),
    join(home, ".codex", "skills"),
    join(cwd, ".github", "skills"),
  ];
  const found = new Set<string>();
  for (const root of roots) {
    for (const name of listDirs(root)) {
      if (name.startsWith("shipeasy-")) found.add(name);
    }
  }
  return found;
}

// ── skills refresh (shared by `upgrade` and `upgrade skills`) ────────────────

async function refreshSkills(
  agents: AgentId[],
  scope: "user" | "project",
  opts: UpgradeOpts,
): Promise<void> {
  const cwd = process.cwd();
  const global = scope === "user";
  const sdk = getBoundSdk(cwd) ?? "typescript";
  const ctx: InstallCtx = { cwd, scope, force: true, dryRun: Boolean(opts.dryRun) };

  if (!agents.length) {
    console.log("  • no coding agents detected — pass --agents to choose (claude,cursor,codex,copilot,jules)");
    return;
  }
  console.log(`  scope: ${scope === "project" ? "this project (in-repo)" : "user-level (global)"}`);

  // Claude at user scope gets everything (MCP + skills + slash commands) from
  // its native plugin — refresh the whole bundle in one step.
  if (agents.includes("claude") && scope === "user") {
    if (opts.dryRun) {
      console.log("  (dry run — would refresh the Claude plugin: marketplace add + plugin install)");
    } else {
      const r = installClaudePlugin(ctx);
      for (const line of r.lines) {
        console.log(`  ${r.action === "error" ? "✗" : r.action === "manual" ? "→" : "✓"} ${line}`);
      }
    }
  }

  const skillsCliAgents = skillsCliAgentsFor(agents, scope);
  if (!skillsCliAgents.length) {
    if (!(agents.includes("claude") && scope === "user")) {
      console.log("  • no skills-CLI agents to refresh (claude at user scope uses the plugin)");
    }
    return;
  }

  // Refresh exactly the marketplace how-to skills that are installed; fall back
  // to the whole catalogue when discovery comes up empty.
  const known = new Set(baseSkillNames());
  const discovered = [...discoverInstalledSkills(cwd)].filter((n) => known.has(n));
  const names = discovered.length ? discovered.sort() : baseSkillNames();
  console.log(
    `  refreshing into ${skillsCliAgents.join(", ")} · skills: ${names.join(", ")} (${sdk} snippets)`,
  );

  if (opts.dryRun) {
    console.log("  (dry run — would `npx skills add` each of the above at its latest marketplace revision)");
    return;
  }

  for (const name of names) {
    const res = await installMarketplaceSkill(name, sdk, { agents: skillsCliAgents, global });
    console.log(`  ${res.action === "failed" ? "✗" : "✓"} ${name}: ${res.detail}`);
  }

  // The SDK how-to skill (`shipeasy-<sdk>`) is a separate source (the published
  // SDK's own docs, not the marketplace) — refresh it too when the tree is bound
  // to an SDK.
  const boundSdk = getBoundSdk(cwd);
  if (boundSdk) {
    const content = await fetchSdkSkill(boundSdk);
    if (content) {
      const res = await installSkill(content, boundSdk, { agents: skillsCliAgents, global });
      console.log(`  ${res.action === "failed" ? "✗" : "✓"} shipeasy-${boundSdk}: ${res.detail}`);
    }
  }
}

// ── MCP refresh (full `upgrade` only) ────────────────────────────────────────

/**
 * Re-point every wired agent at the hosted MCP server. The server is a static
 * remote endpoint (mcp.shipeasy.ai) so there is nothing to "bump" — this just
 * re-asserts the registration (repairing a stale/local entry) and, for Claude
 * at user scope, is already covered by the plugin refresh in the skills step.
 */
function refreshMcp(agents: AgentId[], scope: "user" | "project", opts: UpgradeOpts): void {
  const ctx: InstallCtx = { cwd: process.cwd(), scope, force: true, dryRun: Boolean(opts.dryRun) };
  if (!agents.length) {
    console.log("  • no agents — nothing to re-register");
    return;
  }
  for (const agent of agents) {
    if (agent === "claude" && scope === "user") {
      console.log("  • Claude: MCP ships in the plugin (refreshed above)");
      continue;
    }
    const r = registerMcp(agent, ctx);
    const icon = r.action === "error" ? "✗" : r.action === "manual" ? "→" : "✓";
    console.log(`  ${icon} ${agent}: ${r.detail}`);
  }
}

// ── SDK update (offered, full `upgrade` only) ────────────────────────────────

/** True when a target already has the SDK installed (so it can be updated). */
function sdkInstalled(t: TargetRecommendation): boolean {
  return (
    t.recommendation.action === "already_onboarded" || t.recommendation.action === "set_key"
  );
}

/** The argv that updates the installed Shipeasy SDK to its latest release for a
 *  target's language + package manager, or null when there's no safe auto-run. */
export function sdkUpdateArgv(t: TargetRecommendation): string[] | null {
  const { language, package_manager: pm, frameworks } = t;
  switch (language) {
    case "typescript":
    case "javascript": {
      const mgr = pm && pm !== "unknown" ? pm : "npm";
      const verb = mgr === "npm" ? "install" : "add";
      const react = frameworks.includes("react") || frameworks.includes("nextjs");
      return [mgr, verb, "@shipeasy/sdk@latest", ...(react ? ["@shipeasy/react@latest"] : [])];
    }
    case "ruby":
      return ["bundle", "update", "shipeasy-sdk"];
    case "python": {
      const pkg = frameworks.includes("django") ? "shipeasy[django]" : "shipeasy";
      switch (pm) {
        case "poetry":
          return ["poetry", "add", `${pkg}@latest`];
        case "uv":
          return ["uv", "add", "--upgrade", pkg];
        case "pipenv":
          return ["pipenv", "update", pkg];
        case "pdm":
          return ["pdm", "update", pkg];
        default:
          return null; // bare pip — no manifest to update in place
      }
    }
    case "go":
      return ["go", "get", "github.com/shipeasy-ai/sdk-go@latest"];
    case "php":
      return ["composer", "update", "shipeasy/shipeasy"];
    default:
      return null;
  }
}

async function offerSdkUpdate(opts: UpgradeOpts, interactive: boolean): Promise<void> {
  const detected = await detectTargets();
  const targets = detected.targets.filter(sdkInstalled);
  if (!targets.length) {
    console.log("  • no SDK-onboarded targets found — nothing to update (run `shipeasy setup` to add the SDK)");
    return;
  }

  for (const t of targets) {
    const rel = t.path === detected.root ? "." : t.path.slice(detected.root.length + 1);
    const argv = sdkUpdateArgv(t);
    if (!argv) {
      console.log(`  → ${rel}/ (${t.language}): update the SDK with your package manager (no safe auto-run)`);
      continue;
    }
    const cmd = argv.join(" ");
    if (!onPath(argv[0]!)) {
      console.log(`  → ${rel}/: ${argv[0]} not on PATH — run yourself: ${cmd}`);
      continue;
    }

    if (opts.dryRun) {
      console.log(`  (dry run — would offer: ${cmd} in ${rel}/)`);
      continue;
    }

    let go = Boolean(opts.yes);
    if (!go && interactive) {
      const ans = await prompts({
        type: "confirm",
        name: "go",
        message: `Update the Shipeasy SDK in ${rel}/? (runs \`${cmd}\`)`,
        initial: true,
      });
      go = Boolean(ans.go);
    }
    if (!go) {
      console.log(`  • ${rel}/: skipped — update later with \`${cmd}\``);
      continue;
    }

    console.log(`  → ${rel}/: ${cmd}`);
    const res = spawnSync(argv[0]!, argv.slice(1), { cwd: t.path, stdio: "inherit" });
    console.log(
      res.status === 0
        ? `  ✓ ${rel}/: SDK updated`
        : `  ✗ ${rel}/: update failed (exit ${res.status ?? "?"}) — run it yourself: ${cmd}`,
    );
  }
}

// ── orchestration ────────────────────────────────────────────────────────────

async function runUpgrade(
  opts: UpgradeOpts,
  currentVersion: string,
  full: boolean,
): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY) && !opts.yes;
  const cwd = process.cwd();
  const scope = resolveScope(opts, cwd);
  const agents = resolveAgents(opts, cwd);

  console.log(full ? "Shipeasy upgrade — CLI, agents, skills, SDK\n" : "Shipeasy upgrade — CLI + skills\n");

  // 1. The CLI itself (both paths — the light `skills` path still refreshes it).
  heading("1. CLI");
  if (opts.skipCli) {
    console.log("  • skipped (--skip-cli)");
  } else {
    selfUpdateCli(opts, currentVersion);
  }

  // 2. Skills (both paths).
  heading("2. Skills");
  await refreshSkills(agents, scope, opts);

  if (full) {
    // 3. MCP registration (idempotent re-point at the hosted server).
    heading("3. MCP server");
    refreshMcp(agents, scope, opts);

    // 4. SDK dependency — offered, never forced.
    heading("4. SDK");
    if (opts.skipSdk) {
      console.log("  • skipped (--skip-sdk)");
    } else {
      await offerSdkUpdate(opts, interactive);
    }
  }

  heading("Done");
  console.log(`CLI:     ${opts.skipCli ? "skipped" : `update via ${resolvePm(opts)}`}`);
  console.log(`Agents:  ${agents.length ? `${agents.join(", ")} (${scope} scope)` : "none detected"}`);
  console.log("Skills:  refreshed from the marketplace");
  if (full) {
    console.log(`MCP:     re-registered (${MCP_URL})`);
    console.log(`SDK:     ${opts.skipSdk ? "skipped" : "offered per target"}`);
  } else {
    console.log("Note:    `shipeasy upgrade` (no subcommand) also refreshes MCP + offers the SDK bump");
  }
  if (opts.dryRun) console.log("\n(dry run — nothing was installed or changed.)");
}

// ── command registration ─────────────────────────────────────────────────────

export function upgradeCommand(parent: Command, currentVersion: string): Command {
  const upgrade = parent
    .command("upgrade")
    .description(
      "Bring your Shipeasy install up to date: self-updates the CLI, refreshes the coding-agent " +
        "wiring (Claude plugin / MCP registration) and the how-to skills from the marketplace, and " +
        "offers to bump the @shipeasy/sdk dependency in each onboarded target. Idempotent and " +
        "best-effort. Use `shipeasy upgrade skills` for the CLI + skills only.",
    )
    .option("--agents <list>", "Restrict to these agents (claude,cursor,codex,copilot,jules)")
    .option("--scope <scope>", "Where skills/MCP live: project | user (default: auto-detected)")
    .option("--pm <pm>", "Package manager for the global CLI update (npm|pnpm|yarn|bun)")
    .option("--skip-cli", "Don't self-update the CLI")
    .option("--skip-sdk", "Don't offer the SDK dependency update")
    .option("--yes", "Non-interactive: accept the SDK update without prompting")
    .option("--dry-run", "Show what would change without installing anything")
    .action(async (_opts: UpgradeOpts, cmd: Command) => {
      // optsWithGlobals so options that also exist on a subcommand resolve
      // consistently — commander otherwise binds a shared flag to whichever
      // level declared it, leaving the other's opts empty (a --dry-run that
      // silently ran for real).
      await runUpgrade(cmd.optsWithGlobals() as UpgradeOpts, currentVersion, true).catch(
        (err: unknown) => {
          console.error(`\nUpgrade failed: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        },
      );
    });

  const skills = upgrade
    .command("skills")
    .description(
      "Update the CLI itself and refresh your Shipeasy skills to the latest marketplace revision " +
        "(re-fetched from the repo). Skips the MCP re-registration and the SDK bump that the full " +
        "`shipeasy upgrade` also does.",
    )
    .option("--agents <list>", "Restrict to these agents (claude,cursor,codex,copilot,jules)")
    .option("--scope <scope>", "Where skills live: project | user (default: auto-detected)")
    .option("--pm <pm>", "Package manager for the global CLI update (npm|pnpm|yarn|bun)")
    .option("--skip-cli", "Refresh skills only — don't self-update the CLI")
    .option("--dry-run", "Show what would change without installing anything")
    .action(async (_opts: UpgradeOpts, cmd: Command) => {
      // optsWithGlobals — see the note on the parent `upgrade` action; a flag
      // shared with the parent binds there, so read the merged view here.
      await runUpgrade(cmd.optsWithGlobals() as UpgradeOpts, currentVersion, false).catch(
        (err: unknown) => {
          console.error(
            `\nSkills upgrade failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        },
      );
    });

  withDetails(
    upgrade,
    "`upgrade` refreshes everything a Shipeasy install accumulates, in order:\n\n" +
      "1. **CLI** — installs `@shipeasy/cli@latest` globally (npm by default; `--pm` " +
      "for pnpm/yarn/bun). The new version applies to your NEXT command, not the " +
      "running one.\n" +
      "2. **Skills** — re-fetches the marketplace how-to skills from the repo and " +
      "reinstalls them into your wired agents. Claude at user scope refreshes the " +
      "native plugin (MCP + skills + slash commands in one); every other agent (and " +
      "Claude in-repo) reinstalls via `skills add`. Only the skills you actually have " +
      "are refreshed — discovery falls back to the full catalogue when it finds none.\n" +
      "3. **MCP** — re-asserts the hosted MCP registration (mcp.shipeasy.ai is a static " +
      "remote, so there's nothing to bump — this just repairs a stale/local entry).\n" +
      "4. **SDK** — detects each onboarded target and OFFERS to bump `@shipeasy/sdk` to " +
      "its latest release (prompted; `--yes` accepts, `--skip-sdk` skips).\n\n" +
      "Scope and agents auto-detect from the repo; override with `--scope` / `--agents`. " +
      "`shipeasy upgrade skills` runs only steps 1–2.",
  );

  withExamples(upgrade, [
    { run: "shipeasy upgrade", note: "CLI + agents + skills, then offer the SDK bump" },
    { run: "shipeasy upgrade --yes", note: "non-interactive: also accept the SDK update" },
    { run: "shipeasy upgrade --scope user --pm pnpm", note: "global install, pnpm-managed CLI" },
    { run: "shipeasy upgrade --dry-run", note: "preview without installing" },
  ]);

  withExamples(skills, [
    { run: "shipeasy upgrade skills", note: "refresh the CLI + skills only" },
    { run: "shipeasy upgrade skills --skip-cli", note: "skills only, leave the CLI as-is" },
    { run: "shipeasy upgrade skills --agents claude --scope project", note: "one agent, in-repo" },
  ]);

  return upgrade;
}
