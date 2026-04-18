#!/usr/bin/env node
import { Command } from "commander";
import { login } from "./auth/login";
import { clearCredentials, loadCredentials } from "./auth/storage";
import { flagsCommand } from "./commands/flags";
import { experimentsCommand } from "./commands/experiments";
import { scanCommand } from "./commands/scan";
import { i18nCommand } from "./commands/i18n";

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
  });

flagsCommand(program);
experimentsCommand(program);
scanCommand(program);
i18nCommand(program);

program.parse(process.argv);
