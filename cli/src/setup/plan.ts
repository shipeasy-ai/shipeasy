import prompts from "prompts";
import { tryOpenBrowser } from "../auth/login";
import { format, underline, wrapText } from "../util/format";

/**
 * The final step of `shipeasy setup`: pick a plan in the browser, which is also
 * what finishes onboarding for this account.
 *
 * Everything before this step is deterministic and the CLI owns it — project,
 * keys, SDK install, agents, MCP, devtools, modules, trigger. Two things it
 * deliberately does NOT do on the user's behalf: accept the Terms/Privacy
 * agreements, and choose (or pay for) a plan. Both live in the hosted wizard, so
 * the CLI hands off to it rather than reimplementing a checkout in a terminal.
 *
 * The hand-off opens the wizard's **`cli` funnel** ({@link planSetupUrl}), a
 * two-step Plan → Finish flow: every other step of the full wizard collects
 * something this run already did. An account that finished onboarding earlier is
 * redirected by the app to its billing tab, so the link is never a dead end.
 */

/** Same contract as `shipeasy setup`'s printer: inline markdown + coloured
 *  status glyphs on a TTY, byte-identical plain text anywhere else. */
function say(text = ""): void {
  console.log(format(text));
}

/**
 * Where to send the user to pick a plan and finish onboarding.
 *
 * `intent=cli` selects the two-step funnel (apps/ui `buildSteps`) and `step=plan`
 * opens it directly on the plan picker — the app validates both against its own
 * whitelists. Not signed in in that browser? `/onboarding` carries the same
 * params through `/auth/signin?callbackUrl=…`, so one sign-in still lands on
 * this exact page.
 */
export function planSetupUrl(appBaseUrl: string): string {
  return `${appBaseUrl.replace(/\/$/, "")}/onboarding?intent=cli&step=plan`;
}

export interface PlanStepResult {
  /** True when a browser was actually opened at the plan step. */
  opened: boolean;
  /** True when the user said the plan is picked (vs "I'll do it later"). */
  completed: boolean;
  url: string;
}

export interface PlanStepOpts {
  appBaseUrl: string;
  interactive: boolean;
  /**
   * Ask a yes/no gate first. True in the `shipeasy setup` flow; `--plan` opts in
   * and skips the gate.
   */
  ask: boolean;
  /** Don't open a browser (dry run / tests) — just print the URL. */
  dryRun?: boolean;
}

function printWhatItIs(): void {
  say(
    wrapText(
      "**Last step — pick a plan, in the browser.** Free needs no card and takes effect " +
        "immediately; Pro and Business start a 14-day trial. This same screen carries the Terms " +
        "and Privacy agreements, so finishing it is what completes onboarding for your account — " +
        "until then the dashboard keeps asking for it",
    ),
  );
  say();
}

/** Run the plan hand-off. Returns what happened for the setup summary. */
export async function runPlanStep(opts: PlanStepOpts): Promise<PlanStepResult> {
  const url = planSetupUrl(opts.appBaseUrl);
  printWhatItIs();

  if (opts.dryRun) {
    say(`  (dry run — would open ${url})`);
    return { opened: false, completed: false, url };
  }

  if (opts.ask && opts.interactive) {
    const { go } = await prompts({
      type: "confirm",
      name: "go",
      message: "Open the browser to pick your plan and finish onboarding?",
      initial: true,
    });
    if (!go) {
      say("  • skipped — open this when you're ready:");
      say();
      console.log(`    ${underline(url)}`);
      return { opened: false, completed: false, url };
    }
  }

  // A non-interactive run (CI, an agent harness) gets the URL and nothing else —
  // there is nobody at a browser to pick a plan, and launching one would be noise.
  if (!opts.interactive) {
    say("  • non-interactive — finish onboarding in a browser from this link:");
    say();
    console.log(`    ${underline(url)}`);
    return { opened: false, completed: false, url };
  }

  say("  Opening the plan step:");
  say();
  // Underlined verbatim rather than markdown-rendered: this is the one line the
  // user may have to copy out by hand, so it must stay a bare, unstyled URL.
  console.log(`    ${underline(url)}`);
  say();
  say("  Paste the URL above if the browser doesn't open");

  tryOpenBrowser(url);
  say();
  say(wrapText("The CLI is still running — pick your plan in the browser, then come back here"));
  say();

  const { done } = await prompts({
    type: "select",
    name: "done",
    message: "All set?",
    choices: [
      { title: "✓ Done — plan picked, onboarding finished", value: true },
      { title: "I'll do it later", value: false },
    ],
    initial: 0,
  });

  // Ctrl-C / Esc closes the picker → treat as "I'll do it later".
  const completed = done === true;
  say(
    completed
      ? "  ✓ Done — onboarding complete."
      : "  • Wrap up later — the link above stays valid.",
  );
  return { opened: true, completed, url };
}
