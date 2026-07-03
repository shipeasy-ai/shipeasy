import { Command } from "commander";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getApiClient, ApiError } from "../api/client";
import { printJson } from "../util/output";
import { withExamples, withDetails } from "../util/examples";

/**
 * `shipeasy ops trigger prep` — the hand-written, fs-side half of the Claude
 * trigger flow, mounted into the spec-generated `ops trigger` group.
 *
 * The Claude-Code routine that actually runs the schedule lives in Anthropic's
 * cloud and is created over the `/v1/code/triggers` API — which is reachable
 * only by the agent's in-process `RemoteTrigger` tool, never by a standalone
 * CLI (no exposed OAuth token). So this is a **hybrid split**:
 *
 *   - `ops trigger prep` does everything Shipeasy-side a binary can own — mint
 *     the restricted ops key, resolve repo + cron, build the routine prompt,
 *     and EMIT the exact `RemoteTrigger` create body (+ instructions). It does
 *     NOT call the routines API.
 *   - the agent driving the Claude routine flow reads that body, picks an
 *     `environment_id` from its RemoteTrigger env list, calls
 *     `RemoteTrigger {action:"create"}` then `{action:"run"}` to verify.
 *   - the spec-generated `ops trigger create claude --config
 *     '{"routineId":"trig_…"}'` registers the routine as a Shipeasy connector
 *     (idempotent by routine id; tokenless by default).
 */

const ALLOWED_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch", "WebSearch"];

// --frequency → 5-field UTC cron. Anything else is treated as a raw cron string
// (the routines API enforces the 1-hour minimum interval itself).
function toCron(frequency: string): string {
  switch (frequency) {
    case "4h":
      return "0 */4 * * *";
    case "6h":
      return "0 */6 * * *";
    case "daily":
      return "0 9 * * *";
    case "weekdays":
      return "0 9 * * 1-5";
    case "weekly":
      return "0 9 * * 1";
    default:
      return frequency; // raw cron
  }
}

// Normalize a git remote to an https URL without the .git suffix.
function detectRepoUrl(): string | null {
  try {
    const raw = execSync("git remote get-url origin", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (!raw) return null;
    // git@github.com:org/repo.git → https://github.com/org/repo
    const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(raw);
    if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
    return raw.replace(/\.git$/, "");
  } catch {
    return null;
  }
}

// The unattended ops:work --pr prompt, with the ops key + project id embedded
// (the only hands-off channel — routine env vars are UI-only). Mirrors the
// create_trigger skill's prompt.
function buildRoutinePrompt(opsKey: string, projectId: string): string {
  return `You are an unattended Shipeasy maintenance run. Authenticate every \`shipeasy\`
call with these env vars — the CLI reads them directly; do NOT run
\`shipeasy login\` and never echo the token:

export SHIPEASY_CLI_TOKEN="${opsKey}"
export SHIPEASY_PROJECT_ID="${projectId}"

Each shell command runs in a fresh environment, so put these two exports at the
top of EVERY shell invocation that runs \`shipeasy\`.

If this checkout has no .shipeasy file, create one in the repo root (no secret):
test -f .shipeasy || printf '{"project_id":"${projectId}"}\\n' > .shipeasy
If you created it, never commit it.

First refresh to the LATEST plugin AND CLI (the workflow changes between
releases). This is a fresh container, so add the marketplace before installing:

claude plugin marketplace add shipeasy-ai/shipeasy || claude plugin marketplace update shipeasy
claude plugin install shipeasy@shipeasy
npm install -g @shipeasy/cli@latest

A plugin installed mid-session does NOT register its skills, so invoking the
shipeasy-ops-work skill may report "Unknown skill" — that is expected. Resolve
the workflow file deterministically and follow it verbatim with the --pr flag:

WORK_MD=$(find ~/.claude/plugins/marketplaces -path '*shipeasy*skills/shipeasy-ops-work*' -name SKILL.md 2>/dev/null | head -1)
test -n "$WORK_MD" || WORK_MD=$(find ~/.claude/plugins/cache -path '*shipeasy*skills/shipeasy-ops-work*' -name SKILL.md 2>/dev/null | sort -V | tail -1)
test -n "$WORK_MD" || WORK_MD=$(find ~/.claude/plugins -path '*shipeasy*' -name work.md 2>/dev/null | head -1)   # pre-3.10 plugin layout

Read that file and follow it exactly as if the shipeasy-ops-work skill had been
invoked with --pr: burn down the unified feedback queue (bugs, feature requests, auto-filed
error/alert tickets), commit each fixed item on its OWN claude/-prefixed branch,
open ONE pull request PER item (add "Closes #<issue>" for connected items), and
flip each fixed item to ready_for_qa. If the queue is empty, exit cleanly without
opening any PR. Don't merge.`;
}

interface CreatedKey {
  key: string;
}

export function triggerCommand(parent: Command): Command {
  // The `ops trigger` group (and its `create <provider>` subcommands) is
  // spec-generated; this attaches the one fs-side verb a binary must own.
  // Mounted AFTER registerGeneratedCommands, so both groups already exist.
  const ops = parent.commands.find((c) => c.name() === "ops");
  const trigger = ops?.commands.find((c) => c.name() === "trigger");
  if (!trigger) throw new Error("generated `ops trigger` group missing — run pnpm gen:cli");

  // ── ops trigger prep ───────────────────────────────────────────────────────
  const create = trigger
    .command("prep")
    .description("Mint the ops key + emit the RemoteTrigger create body for the agent to run")
    .option(
      "--frequency <v>",
      "Schedule: 4h | 6h | daily | weekdays | weekly | <raw 5-field cron>",
      "4h",
    )
    .option("--repo <url>", "GitHub repo the routine checks out (default: origin remote)")
    .option("--model <id>", "Model for the cloud session", "claude-sonnet-4-6")
    .option("--name <name>", "Routine name", "Shipeasy ops:work")
    .option("--dry-run", "Don't mint the ops key or write files — just print the plan")
    .option("--json", "Print the RemoteTrigger create body as JSON to stdout (contains the key)")
    .option("--project <id>", "Project ID override")
    .action(
      async (opts: {
        frequency: string;
        repo?: string;
        model: string;
        name: string;
        dryRun?: boolean;
        json?: boolean;
        project?: string;
      }) => {
        try {
          const client = getApiClient(opts.project, { requireBinding: true });
          const projectId = client.projectId;
          const cron = toCron(opts.frequency);
          const repo = opts.repo ?? detectRepoUrl();
          if (!repo) {
            console.error(
              "No GitHub repo found. Pass --repo <url> (no origin remote detected).",
            );
            process.exit(1);
          }

          if (opts.dryRun) {
            console.log("Dry run — nothing minted. Plan:");
            console.log(`  schedule:  ${cron}  (--frequency ${opts.frequency})`);
            console.log(`  repo:      ${repo}`);
            console.log(`  model:     ${opts.model}`);
            console.log(`  project:   ${projectId}`);
            console.log("  ops key:   (would mint a restricted ops key)");
            return;
          }

          // Mint the restricted ops key (read-only queue + status flips + link-pr
          // + create-only dev ops; auto-extends its 7-day expiry on each run).
          // `env` is required by the create-key schema; ops keys are env-agnostic
          // (the server pins them to "prod" regardless), but it must be sent or
          // the strict body validation 422s.
          const created = await client.request<CreatedKey>("POST", "/api/admin/keys", {
            type: "ops",
            env: "prod",
          });
          const opsKey = created.key;

          const body = {
            name: opts.name,
            cron_expression: cron,
            enabled: true,
            job_config: {
              ccr: {
                // The agent fills this from its RemoteTrigger env list — the CLI
                // can't enumerate the user's Anthropic cloud environments.
                environment_id: "<FILL: pick from RemoteTrigger env list>",
                session_context: {
                  model: opts.model,
                  sources: [{ git_repository: { url: repo } }],
                  allowed_tools: ALLOWED_TOOLS,
                },
                events: [
                  {
                    data: {
                      uuid: randomUUID(),
                      session_id: "",
                      type: "user",
                      parent_tool_use_id: null,
                      message: { content: buildRoutinePrompt(opsKey, projectId), role: "user" },
                    },
                  },
                ],
              },
            },
            notifications: { channel: { email: false, push: true, slack: false } },
          };

          if (opts.json) {
            // Machine-readable path: body incl. the embedded ops key.
            return printJson(body);
          }

          // Default: write the body (with the embedded key) to a 0600 temp file
          // so the key is never echoed to the terminal. Print the path + a
          // redacted summary + the agent's next steps.
          const dir = mkdtempSync(join(tmpdir(), "se-trigger-"));
          const bodyPath = join(dir, "routine-body.json");
          writeFileSync(bodyPath, JSON.stringify(body, null, 2), { mode: 0o600 });
          const masked = `${opsKey.slice(0, 11)}…`;

          console.log("✅ Shipeasy side ready. The routine itself is created by the agent.");
          console.log("");
          console.log(`  schedule:  ${cron}  (--frequency ${opts.frequency})`);
          console.log(`  repo:      ${repo}`);
          console.log(`  model:     ${opts.model}`);
          console.log(`  project:   ${projectId}`);
          console.log(`  ops key:   ${masked}  (restricted, auto-extends 7-day expiry)`);
          console.log(`  body file: ${bodyPath}  (0600 — embeds the ops key, do not commit)`);
          console.log("");
          console.log("Agent next steps (RemoteTrigger — in-process OAuth, no token to pass):");
          console.log(`  1. Read ${bodyPath} and pick environment_id from the RemoteTrigger`);
          console.log("     env list (replace the <FILL…> placeholder).");
          console.log("  2. RemoteTrigger { action:\"create\", body:<the body> } → capture trig_<id>.");
          console.log("  3. (confirm with user — spends tokens, may open a PR)");
          console.log("     RemoteTrigger { action:\"run\", trigger_id:\"trig_<id>\" } to verify.");
          console.log("  4. shipeasy ops trigger create claude --config '{\"routineId\":\"trig_<id>\"}'");
          console.log("     (registers the connector; idempotent, tokenless is fine)");
          console.log("  Portal: https://claude.ai/code/routines");
        } catch (e) {
          if (e instanceof ApiError) console.error(`Error (${e.status}): ${e.message}`);
          else console.error(String(e));
          process.exit(1);
        }
      },
    );

  withDetails(
    create,
    "Does the Shipeasy-side prep for a recurring trigger and emits the exact " +
      "RemoteTrigger create body. It mints a restricted `ops` key (embedded in the " +
      "routine prompt — the only hands-off channel, since routine env vars are " +
      "UI-only), resolves the repo (origin remote) and cron (--frequency), and " +
      "writes the body to a 0600 temp file (the key is never printed). It does NOT " +
      "create the routine — the agent does, via the in-process RemoteTrigger tool, " +
      "because the routines API token is not exposed to a standalone CLI.",
  );
  withExamples(create, [
    { note: "Every 4h against the origin repo", run: "shipeasy ops trigger prep" },
    { note: "Daily, explicit repo", run: "shipeasy ops trigger prep --frequency daily --repo https://github.com/acme/web" },
    { note: "Preview without minting", run: "shipeasy ops trigger prep --dry-run" },
    { note: "Emit body as JSON (for scripting)", run: "shipeasy ops trigger prep --json" },
  ]);

  return trigger;
}
