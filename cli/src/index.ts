#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command, CommanderError } from "commander";
import { login } from "./auth/login";
import { clearCredentials, loadCredentials } from "./auth/storage";
import { registerGeneratedCommands } from "./generated/commands.gen";
import { genCtx } from "./commands/_gen-runtime";
import { customCommands } from "./commands/custom";
import { keysCommand } from "./commands/keys";
import { i18nCommand } from "./commands/i18n";
import { codemodCommand } from "./commands/codemod";
import { i18nWorkflowCommands } from "./commands/i18n-workflows";
import { mcpCommand } from "./commands/mcp";
import { setupCommand } from "./commands/setup";
import { installCommand } from "./commands/install";
import { triggerCommand } from "./commands/trigger";
import { detectCommand } from "./commands/detect";
import { bindProject, findProjectConfigDir, readProjectConfig } from "./util/project-config";
import { printJson } from "./util/output";
import { reportCliError } from "./util/error-reporter";
import { withExamples, withDetails, withTreeHelp } from "./util/examples";

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

  withDetails(
    loginCmd,
    "With no flags, `login` auto-detects the project: an explicit `--project` " +
      "wins, otherwise the project bound via the nearest `.shipeasy` file " +
      "(searched up from the cwd, like `.git`) — the browser flow then offers " +
      "only that project. With neither, it opens the picker and writes " +
      "`.shipeasy` on success.\n\n" +
      "In CI, set `SHIPEASY_CLI_TOKEN` + `SHIPEASY_PROJECT_ID` instead — they " +
      "act as the session, so `login` short-circuits as already-authenticated " +
      "(no browser).",
  );

  withExamples(loginCmd, [
    { note: "Use the .shipeasy-bound project, else open the picker", run: "shipeasy login" },
    { note: "Re-authenticate over a live session", run: "shipeasy login --force" },
    { note: "Scope to one project explicitly", run: "shipeasy login --project proj_abc123" },
    {
      note: "CI: env credentials act as the session, so this is a no-op",
      run: "SHIPEASY_CLI_TOKEN=… SHIPEASY_PROJECT_ID=… shipeasy login",
    },
  ]);

  const logoutCmd = program
    .command("logout")
    .description("Clear stored credentials")
    .action(() => {
      clearCredentials();
      console.log("Logged out.");
    });

  withExamples(logoutCmd, [{ run: "shipeasy logout" }]);

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

  const rootCmd = program
    .command("root")
    .description("Print the project root — the nearest .shipeasy dir (walks up from cwd, like .git)")
    .option("--json", "Output the resolved root as JSON")
    .action((opts: { json?: boolean }) => {
      const dir = findProjectConfigDir(process.cwd());
      if (!dir) {
        console.error(
          "No .shipeasy found from this directory upward. This dir isn't inside a bound\n" +
            "Shipeasy project. Bind one with `shipeasy bind <project_id>` (or `shipeasy detect`\n" +
            "to record language/sdk), or run `shipeasy login` to create/pick a project.",
        );
        process.exit(1);
      }
      const cfg = readProjectConfig(dir);
      if (opts.json) {
        printJson({ root: dir, project_id: cfg.project_id ?? null, sdk: cfg.sdk ?? null });
        return;
      }
      console.log(dir);
      if (cfg.project_id) console.log(`  project: ${cfg.project_id}`);
      if (cfg.sdk) console.log(`  sdk:     ${cfg.sdk}`);
    });

  withDetails(
    rootCmd,
    "The project root is **the folder that holds `.shipeasy`**, found by walking up from " +
      "the cwd (like git finds `.git`). The nearest file wins, so a subproject's own " +
      "`.shipeasy` shadows any ancestor and the walk stops there — one `.shipeasy` per " +
      "project. Use this instead of `git rev-parse --show-toplevel` when you need the " +
      "Shipeasy project boundary: it respects a subproject root and never overshoots to " +
      "the git root above it. Exits non-zero (with guidance) when nothing is bound.",
  );

  withExamples(rootCmd, [
    { run: "shipeasy root", note: "print the nearest .shipeasy dir" },
    { run: "shipeasy root --json", note: "root + project_id + sdk, machine-readable" },
    { run: "cd \"$(shipeasy root)\"", note: "cd to the project root" },
  ]);

  // ── Generated command tree ────────────────────────────────────────────────
  // The whole API surface — release (flags/killswitch/configs/experiments/
  // universes/attributes), metrics + events, ops + alerts, projects — is
  // PROJECTED FROM THE SPEC: structure from the tag tree, verbs/positional/
  // synthetic-verbs from x-cli, flags from the request bodies, each command
  // calling a generated sdk fn. Regenerate with `pnpm gen:cli`.
  registerGeneratedCommands(program, genCtx);

  // ── Custom commands (fs/AST + auth + install — not API endpoints) ─────────
  setupCommand(program);
  // `install <module>` — the platform installer (flags | i18n | ops). Enables
  // a module group via PATCH /api/admin/projects/:id (there is no `modules`
  // command); the install skills orchestrate this.
  installCommand(program);
  // `trigger create/link` — the Shipeasy side of the recurring-trigger hybrid
  // split (mint ops key + emit the RemoteTrigger body; the agent creates the
  // routine via its in-process RemoteTrigger tool).
  triggerCommand(program);

  // ── Custom (non-spec) operations — the shared sugar registry ──────────────
  // metrics grammar + docs list/get/skill. Same registry the MCP server
  // projects, so the surfaces stay in sync (@shipeasy/openapi/custom).
  customCommands(program);
  detectCommand(program);
  mcpCommand(program);

  // SDK admin keys (server/client/admin/ops) — mint/list/revoke. Its own
  // top-level group; nothing to do with i18n despite the historical nesting.
  const sdk = program.command("sdk").description("Manage SDK keys (server, client, admin, ops)");
  keysCommand(sdk); // -> sdk keys
  withTreeHelp(sdk);

  // i18n stays hand-written (fs scan/codemod/loader + the file-based push/
  // publish), with source codemods nested under it.
  const i18n = i18nCommand(program); // -> i18n …
  codemodCommand(i18n); // -> i18n codemod
  // High-level orchestrators (codemod → push → publish in one verb): `extract`
  // + `migrate`. The i18n:extract / i18n:migrate skills wrap these thinly.
  i18nWorkflowCommands(i18n); // -> i18n extract / i18n migrate
  withTreeHelp(i18n);

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
