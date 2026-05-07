#!/usr/bin/env node
import { Command } from "commander";
import { login } from "./auth/login";
import { clearCredentials, loadCredentials } from "./auth/storage";
import { getApiClient, ApiError } from "./api/client";
import { flagsCommand } from "./commands/flags";
import { experimentsCommand } from "./commands/experiments";
import { keysCommand } from "./commands/keys";
import { scanCommand } from "./commands/scan";
import { i18nCommand } from "./commands/i18n";
import { codemodCommand } from "./commands/codemod";
import { mcpCommand } from "./commands/mcp";
import { skillsCommand } from "./commands/skills";
import { pluginCommand } from "./commands/plugin";
import { projectsCommand } from "./commands/projects";
import { bindProject, readProjectConfig } from "./util/project-config";
import { printJson } from "./util/output";

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

const program = new Command();

program.name("shipeasy").description("CLI for the ShipEasy experiment platform").version("1.0.0");

program
  .command("login")
  .description("Authenticate via PKCE device flow")
  .option("--worker-url <url>", "Edge worker URL (default: https://cdn.shipeasy.ai)")
  .option("--app-url <url>", "Admin app URL (default: https://shipeasy.ai)")
  .action(async (opts) => {
    await login({ workerUrl: opts.workerUrl, appUrl: opts.appUrl }).catch((err: unknown) => {
      console.error("Login failed:", String(err));
      process.exit(1);
    });
  });

program
  .command("logout")
  .description("Clear stored credentials")
  .action(() => {
    clearCredentials();
    console.log("Logged out.");
  });

program
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
      project = await client.request<ProjectMeta>("GET", `/api/admin/projects/${client.projectId}`);
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

program
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

projectsCommand(program);
flagsCommand(program);
experimentsCommand(program);
keysCommand(program);
scanCommand(program);
i18nCommand(program);
codemodCommand(program);
mcpCommand(program);
skillsCommand(program);
pluginCommand(program);

program.parse(process.argv);
