import type { Command } from "commander";
import {
  buildSetupIssuePayload,
  promptAndSend,
  reportPreview,
  sendSetupIssue,
  type SetupIssueInput,
} from "../setup/report-issue";
import { withExamples } from "../util/examples";

interface ReportOpts {
  title: string;
  step?: string;
  error?: string;
  description?: string;
  reporterEmail?: string;
  project?: string;
  language?: string;
  frameworks?: string;
  consent?: boolean;
  json?: boolean;
}

/**
 * `shipeasy report-issue` — file a setup/onboarding bug to Shipeasy as a
 * pending-approval ticket. Designed to be called by the coding agent that runs
 * `shipeasy setup` when a step fails and it cannot recover — but ONLY after the
 * agent has asked the user and the user agreed. `--consent` is the enforcement
 * backstop: without it (and without an interactive yes) nothing is sent.
 */
export function reportIssueCommand(parent: Command, version: string): void {
  const cmd = parent
    .command("report-issue")
    .description(
      "File a setup/onboarding bug to Shipeasy (filed as pending-approval). Meant for the setup " +
        "agent when a step fails: it collects OS/Node/CLI version, your project id, language and " +
        "frameworks, plus the failing step + error. REQUIRES the user's consent — pass --consent " +
        "(agent, after asking) or answer the interactive prompt. Prints the exact payload first.",
    )
    .requiredOption("--title <title>", "One-line summary, e.g. \"Setup failed at Feature installs\"")
    .option("--step <step>", "Which setup step failed")
    .option("--error <error>", "The error message / actual result")
    .option("--description <text>", "Freeform description of the problem")
    .option("--reporter-email <email>", "Optional contact email")
    .option("--project <id>", "Shipeasy project id the issue relates to (defaults to the bound one)")
    .option("--language <lang>", "Detected language (typescript, python, …)")
    .option("--frameworks <list>", "Comma list of detected frameworks")
    .option(
      "--consent",
      "Confirm the USER agreed to send system/env info to Shipeasy. Required to send unattended.",
    )
    .option("--json", "Print the exact payload and exit WITHOUT sending (dry preview)")
    .action(async (opts: ReportOpts) => {
      const input: SetupIssueInput = {
        title: opts.title,
        step: opts.step,
        error: opts.error,
        description: opts.description,
        reporterEmail: opts.reporterEmail,
        projectId: opts.project,
        language: opts.language,
        frameworks: opts.frameworks
          ? opts.frameworks
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
        cliVersion: version,
      };

      if (opts.json) {
        console.log(JSON.stringify(buildSetupIssuePayload(input), null, 2));
        return;
      }

      const interactive = Boolean(process.stdin.isTTY);
      let result;
      if (opts.consent) {
        // Agent path (or an already-consenting user): show what's sent, then send.
        console.log(reportPreview(input));
        result = await sendSetupIssue(input, { consent: true });
      } else {
        // No consent flag → ask the human (prints the payload as part of asking).
        result = await promptAndSend(input, interactive);
      }

      if (result.ok) {
        console.log(
          `\n✓ Reported to Shipeasy${result.number ? ` (#${result.number})` : ""} — pending approval. Thank you.`,
        );
      } else {
        console.log(`\n• Not sent: ${result.error}`);
      }
    });

  withExamples(cmd, [
    {
      run: 'shipeasy report-issue --consent --title "Setup failed at Feature installs" --step "Feature installs" --error "enableModuleGroup(ops) 500"',
      note: "agent files a report after the user agreed",
    },
    {
      run: 'shipeasy report-issue --title "Setup broke" --error "..." --json',
      note: "preview the exact payload without sending",
    },
  ]);
}
