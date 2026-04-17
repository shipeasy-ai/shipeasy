#!/usr/bin/env node
import { Command } from "commander";
import { login } from "./auth/login";
import { clearCredentials, loadCredentials } from "./auth/storage";
import { flagsCommand } from "./commands/flags";
import { experimentsCommand } from "./commands/experiments";

const program = new Command();

program.name("shipeasy").description("CLI for the ShipEasy experiment platform").version("1.0.0");

program
  .command("login")
  .description("Authenticate via PKCE device flow")
  .option("--api-url <url>", "Admin UI URL", "http://localhost:3000")
  .option("--worker-url <url>", "Worker URL", "http://localhost:8787")
  .option("--project <id>", "Project ID (auto-detected from auth)")
  .action(async (opts) => {
    await login({
      apiUrl: opts.apiUrl,
      workerUrl: opts.workerUrl,
      projectId: opts.project,
    }).catch((err: unknown) => {
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
    console.log(`API URL:    ${creds.api_url}`);
    console.log(`Saved at:   ${creds.saved_at}`);
    if (creds.expires_at) {
      const daysLeft = Math.ceil((new Date(creds.expires_at).getTime() - Date.now()) / 86_400_000);
      console.log(`Expires in: ${daysLeft} day(s)`);
    }
  });

flagsCommand(program);
experimentsCommand(program);

program.parse(process.argv);
