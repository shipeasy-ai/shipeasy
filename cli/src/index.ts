#!/usr/bin/env node
import { Command } from "commander";
import { login } from "./auth/login";
import { clearCredentials, loadCredentials } from "./auth/storage";
import { flagsCommand } from "./commands/flags";
import { experimentsCommand } from "./commands/experiments";
import { keysCommand } from "./commands/keys";
import { scanCommand } from "./commands/scan";
import { i18nCommand } from "./commands/i18n";
import { codemodCommand } from "./commands/codemod";
import { mcpCommand } from "./commands/mcp";
import { skillsCommand } from "./commands/skills";
import { pluginCommand } from "./commands/plugin";
import { bindProject, readProjectConfig } from "./util/project-config";

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
  .description("Show current authentication state")
  .action(() => {
    const creds = loadCredentials();
    if (!creds) {
      console.log("Not logged in. Run: shipeasy login");
      return;
    }
    console.log(`Project:    ${creds.project_id}`);
    if (creds.user_email) console.log(`Email:      ${creds.user_email}`);
    console.log(`Worker URL: ${creds.api_base_url}`);
    console.log(`App URL:    ${creds.app_base_url}`);
    console.log(`Saved at:   ${creds.created_at}`);
    const bound = readProjectConfig(process.cwd());
    if (bound.project_id) {
      console.log(
        `Bound dir:  ${bound.project_id}${bound.project_name ? ` (${bound.project_name})` : ""}`,
      );
    } else {
      console.log(`Bound dir:  — (run \`shipeasy bind\` to bind this directory)`);
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
