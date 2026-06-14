#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command, CommanderError } from "commander";
import { login } from "./auth/login";
import { clearCredentials, loadCredentials } from "./auth/storage";
import { getApiClient, ApiError } from "./api/client";
import { flagsCommand } from "./commands/flags";
import { killswitchesCommand } from "./commands/killswitches";
import { experimentsCommand } from "./commands/experiments";
import { configsCommand } from "./commands/configs";
import { universesCommand } from "./commands/universes";
import { feedbackCommand } from "./commands/feedback";
import { connectorsCommand } from "./commands/connectors";
import { opsCommand } from "./commands/ops";
import { alertsCommand } from "./commands/alerts";
import { alertRulesCommand } from "./commands/alert-rules";
import { keysCommand } from "./commands/keys";
import { scanCommand } from "./commands/scan";
import { i18nCommand } from "./commands/i18n";
import { codemodCommand } from "./commands/codemod";
import { mcpCommand } from "./commands/mcp";
import { skillsCommand } from "./commands/skills";
import { pluginCommand } from "./commands/plugin";
import { setupCommand } from "./commands/setup";
import { projectsCommand } from "./commands/projects";
import { modulesCommand } from "./commands/modules";
import { metricsCommand } from "./commands/metrics";
import { bindProject, readProjectConfig } from "./util/project-config";
import { printJson } from "./util/output";
import { reportCliError } from "./util/error-reporter";
import { withExamples } from "./util/examples";

interface ProjectMeta {
  id: string;
  name: string;
  domain: string | null;
  ownerEmail: string;
  plan: "free" | "paid";
  status: "active" | "inactive";
  subscriptionStatus: "none" | "trialing" | "active" | "past_due" | "canceled" | "incomplete";
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: number;
  billingInterval: "monthly" | "annual";
  moduleTranslations: boolean | number;
  moduleConfigs: boolean | number;
  moduleGates: boolean | number;
  moduleExperiments: boolean | number;
  moduleFeedback: boolean | number;
  createdAt: string;
  updatedAt: string;
}

function listEnabledModules(p: ProjectMeta): string[] {
  const mods: [string, boolean | number][] = [
    ["translations", p.moduleTranslations],
    ["configs", p.moduleConfigs],
    ["gates", p.moduleGates],
    ["experiments", p.moduleExperiments],
    ["feedback", p.moduleFeedback],
  ];
  return mods.filter(([, v]) => Boolean(v)).map(([k]) => k);
}

/**
 * Construct the fully-wired command tree without parsing argv or registering
 * exit handlers' side effects. Exported so tests can introspect every
 * registered command (see `commands.test.ts`) and so `run()` / the bin entry
 * share one definition. Each call returns a fresh `Command`.
 */
export function buildProgram(): Command {
  const program = new Command();

  // Source the version from package.json so `--version` never drifts from the
  // published package. `__dirname` is `dist/` in the bundled build and `src/` in
  // `tsx` dev — both resolve `../package.json` to the package root.
  const { version } = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8")) as {
    version: string;
  };

  program.name("shipeasy").description("CLI for the ShipEasy experiment platform").version(version);

  const loginCmd = program
    .command("login")
    .description("Authenticate via PKCE device flow (no-op if already logged in)")
    .option("--force", "Re-authenticate even if a valid session already exists")
    .option(
      "--project <id>",
      "Scope login to one project (defaults to the .shipeasy-bound project)",
    )
    .action(async (opts) => {
      await login({
        force: opts.force,
        projectId: opts.project,
      }).catch((err: unknown) => {
        console.error("Login failed:", String(err));
        process.exit(1);
      });
    });

  withExamples(loginCmd, [
    { run: "shipeasy login" },
    { run: "shipeasy login --force", note: "re-authenticate over a live session" },
    { run: "shipeasy login --project proj_abc123", note: "scope login to one project" },
  ]);

  const logoutCmd = program
    .command("logout")
    .description("Clear stored credentials")
    .action(() => {
      clearCredentials();
      console.log("Logged out.");
    });

  withExamples(logoutCmd, [{ run: "shipeasy logout" }]);

  const whoamiCmd = program
    .command("whoami")
    .description("Show current authentication state and active project metadata")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      const creds = loadCredentials();
      if (!creds) {
        if (opts.json) {
          printJson({ logged_in: false });
        } else {
          console.log("Not logged in. Run: shipeasy login");
        }
        return;
      }

      const bound = readProjectConfig(process.cwd());
      let project: ProjectMeta | null = null;
      let projectError: string | null = null;
      let client: ReturnType<typeof getApiClient> | null = null;
      try {
        client = getApiClient();
        project = await client.request<ProjectMeta>(
          "GET",
          `/api/admin/projects/${client.projectId}`,
        );
      } catch (e) {
        projectError = e instanceof ApiError ? `API error (${e.status}): ${e.message}` : String(e);
      }

      if (opts.json) {
        printJson({
          logged_in: true,
          session: {
            project_id: creds.project_id,
            user_email: creds.user_email ?? null,
            worker_url: creds.api_base_url,
            app_url: creds.app_base_url,
            saved_at: creds.created_at,
          },
          bound_dir: bound.project_id
            ? { project_id: bound.project_id, project_name: bound.project_name ?? null }
            : null,
          active_project_id: client?.projectId ?? creds.project_id,
          project,
          project_error: projectError,
        });
        return;
      }

      console.log(`Project:    ${creds.project_id}`);
      if (creds.user_email) console.log(`Email:      ${creds.user_email}`);
      console.log(`Worker URL: ${creds.api_base_url}`);
      console.log(`App URL:    ${creds.app_base_url}`);
      console.log(`Saved at:   ${creds.created_at}`);
      if (bound.project_id) {
        console.log(
          `Bound dir:  ${bound.project_id}${bound.project_name ? ` (${bound.project_name})` : ""}`,
        );
      } else {
        console.log(`Bound dir:  — (run \`shipeasy bind\` to bind this directory)`);
      }

      if (project) {
        const activeId = client?.projectId ?? creds.project_id;
        console.log("");
        console.log(`Active project: ${project.name} (${activeId})`);
        console.log(`  domain:        ${project.domain ?? "—"}`);
        console.log(`  owner:         ${project.ownerEmail}`);
        console.log(`  plan:          ${project.plan}`);
        console.log(`  status:        ${project.status}`);
        if (project.subscriptionStatus !== "none") {
          const cancel = project.cancelAtPeriodEnd ? " (cancels at period end)" : "";
          console.log(
            `  subscription:  ${project.subscriptionStatus} · ${project.billingInterval}${cancel}`,
          );
          if (project.currentPeriodEnd) {
            console.log(`  period ends:   ${project.currentPeriodEnd}`);
          }
          if (project.trialEndsAt) {
            console.log(`  trial ends:    ${project.trialEndsAt}`);
          }
        }
        const enabled = listEnabledModules(project);
        console.log(`  modules:       ${enabled.length ? enabled.join(", ") : "(none enabled)"}`);
        console.log(`  created at:    ${project.createdAt}`);
        console.log(`  updated at:    ${project.updatedAt}`);
      } else if (projectError) {
        console.log("");
        console.log(`Active project: (could not fetch metadata — ${projectError})`);
      }
    });

  withExamples(whoamiCmd, [
    { run: "shipeasy whoami" },
    { run: "shipeasy whoami --json", note: "machine-readable session + project" },
  ]);

  const bindCmd = program
    .command("bind [project_id]")
    .description("Bind the current directory to a Shipeasy project (writes .shipeasy)")
    .option("--name <name>", "Optional human-readable project name to record")
    .action((projectIdArg: string | undefined, opts: { name?: string }) => {
      const creds = loadCredentials();
      const projectId = projectIdArg ?? creds?.project_id;
      if (!projectId) {
        console.error(
          "No project_id provided and no CLI session to default to. Run `shipeasy login` first or pass a project_id explicitly.",
        );
        process.exit(1);
      }
      const { path, created } = bindProject(process.cwd(), projectId, opts.name);
      console.log(`${created ? "Created" : "Updated"} ${path} → project ${projectId}`);
      console.log(
        "Mutating CLI/MCP commands run in this tree will now push to this project regardless of which CLI session is active.",
      );
    });

  withExamples(bindCmd, [
    { run: "shipeasy bind", note: "bind to the active session's project" },
    { run: "shipeasy bind proj_abc123" },
    { run: "shipeasy bind proj_abc123 --name 'Acme Web'" },
  ]);

  setupCommand(program);
  projectsCommand(program);
  modulesCommand(program);
  flagsCommand(program);
  killswitchesCommand(program);
  experimentsCommand(program);
  metricsCommand(program);
  configsCommand(program);
  universesCommand(program);
  feedbackCommand(program);
  connectorsCommand(program);
  opsCommand(program);
  alertsCommand(program);
  alertRulesCommand(program);
  keysCommand(program);
  scanCommand(program);
  i18nCommand(program);
  codemodCommand(program);
  mcpCommand(program);
  skillsCommand(program);
  pluginCommand(program);

  applyExitOverride(program);
  return program;
}

// Codes that represent intentional, non-error exits (e.g. `--help`, `--version`).
// Don't treat these as telemetry-worthy.
const SILENT_EXIT_CODES = new Set([
  "commander.help",
  "commander.helpDisplayed",
  "commander.version",
]);

function applyExitOverride(cmd: Command): void {
  cmd.exitOverride();
  for (const sub of cmd.commands) applyExitOverride(sub);
}

/**
 * Parse argv and dispatch. The bin entry calls this; tests can call it directly
 * with a synthetic argv. Kept separate from `buildProgram()` so introspection
 * tests never trigger a parse or `process.exit`.
 */
export async function run(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      if (SILENT_EXIT_CODES.has(err.code)) {
        process.exit(err.exitCode ?? 0);
      }
      const args = argv.slice(2);
      const command = args.find((a) => !a.startsWith("-")) ?? null;
      // Commander already printed the human-readable error to stderr.
      await reportCliError({
        kind: err.code,
        command,
        message: err.message,
        argv: args,
        exit_code: err.exitCode,
      });
      process.exit(err.exitCode ?? 1);
    }
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
