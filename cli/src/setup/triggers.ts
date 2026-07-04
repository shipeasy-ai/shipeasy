import prompts from "prompts";
import { tryOpenBrowser } from "../auth/login";

/**
 * The automation-trigger step of onboarding — now owned by the CLI (it replaces
 * the removed `shipeasy-ops-trigger` skill). It explains what a trigger is, asks
 * whether to set one up, has the user pick a platform, and opens the hosted,
 * guided setup wizard (`/dashboard/<projectId>/triggers?provider=<platform>`)
 * preselected to that platform. The wizard itself (apps/ui trigger-setup.tsx)
 * does the provider-specific provisioning; the CLI only routes the user to it.
 */

export type TriggerPlatform = "claude" | "codex" | "cursor" | "copilot" | "gemini";

/** The five guided platforms — mirrors PLATFORMS in apps/ui trigger-setup.tsx. */
export const TRIGGER_PLATFORMS: { id: TriggerPlatform; label: string; sub: string }[] = [
  { id: "claude", label: "Claude Code", sub: "scheduled routine in Anthropic’s cloud" },
  { id: "codex", label: "Codex", sub: "GitHub Actions cron → Codex Cloud task" },
  { id: "cursor", label: "Cursor", sub: "Shipeasy launches a Cursor cloud agent" },
  { id: "copilot", label: "GitHub Copilot", sub: "GitHub coding-agent task → PR" },
  { id: "gemini", label: "Gemini (Jules)", sub: "Google’s async Jules session → PR" },
];

const PLATFORM_IDS = TRIGGER_PLATFORMS.map((p) => p.id) as string[];

/**
 * Normalise a raw platform string to a {@link TriggerPlatform}. `jules` is
 * accepted as an alias for `gemini` (same as the dashboard deep link); anything
 * unknown returns null so the caller falls back to the picker page.
 */
export function normalizePlatform(raw: string | null | undefined): TriggerPlatform | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === "jules") return "gemini";
  return PLATFORM_IDS.includes(v) ? (v as TriggerPlatform) : null;
}

/**
 * The hosted, guided trigger-setup wizard, optionally preselected to a platform
 * via the `?provider=` deep link that apps/ui `parsePlatform` reads.
 */
export function triggerSetupUrl(
  appBaseUrl: string,
  projectId: string,
  platform?: TriggerPlatform | null,
): string {
  const base = appBaseUrl.replace(/\/$/, "");
  const q = platform ? `?provider=${platform}` : "";
  return `${base}/dashboard/${projectId}/triggers${q}`;
}

export interface TriggerStepResult {
  enabled: boolean;
  /** First platform opened this run (kept for the one-line summary). */
  platform?: TriggerPlatform;
  /** Every platform whose wizard the user opened this run. */
  platforms?: TriggerPlatform[];
  url?: string;
  /** True when the user finished with "Done" (vs "I'll do it later"/cancel). */
  completed?: boolean;
}

export interface TriggerStepOpts {
  projectId: string;
  appBaseUrl: string;
  interactive: boolean;
  /**
   * Ask a yes/no gate first. True in the `shipeasy setup` flow (the trigger is
   * one optional step); false for the standalone `shipeasy setup triggers`
   * command (the user already opted in by running it).
   */
  ask: boolean;
  /** Preselected platform (from `--trigger-platform` / `--platform`). */
  platform?: string;
  /**
   * Agent ids the user wired in step 3 (`AgentId[]`). In the picker these are
   * floated to the top and tagged "recommended"; the rest still show below.
   * `jules` maps to the `gemini` trigger platform (same as the deep link).
   */
  preferredAgents?: string[];
  /** Don't open a browser (dry run / tests) — just print the URL. */
  dryRun?: boolean;
}

/** Map a step-3 `AgentId` to its trigger platform id (`jules` → `gemini`). */
function agentToPlatform(id: string): TriggerPlatform | null {
  const v = id === "jules" ? "gemini" : id.toLowerCase();
  return PLATFORM_IDS.includes(v) ? (v as TriggerPlatform) : null;
}

export interface OrderedPlatform {
  id: TriggerPlatform;
  label: string;
  sub: string;
  /** True when the user wired this platform's agent in step 3. */
  recommended: boolean;
}

/**
 * Order the trigger platforms for the picker: the ones whose agent the user
 * wired in step 3 float to the top flagged `recommended`, in their original
 * canonical order; every other platform stays below. `preferredAgents` are
 * step-3 `AgentId`s (`jules` maps to `gemini`); unknown ids are ignored.
 */
export function orderTriggerPlatforms(preferredAgents: string[] = []): OrderedPlatform[] {
  const preferred = new Set(
    preferredAgents.map(agentToPlatform).filter((p): p is TriggerPlatform => p !== null),
  );
  const tag = (p: (typeof TRIGGER_PLATFORMS)[number]): OrderedPlatform => ({
    ...p,
    recommended: preferred.has(p.id),
  });
  return [
    ...TRIGGER_PLATFORMS.filter((p) => preferred.has(p.id)).map(tag),
    ...TRIGGER_PLATFORMS.filter((p) => !preferred.has(p.id)).map(tag),
  ];
}

/** Open (or print) the hosted wizard for one platform — shared by every path. */
function openWizard(
  appBaseUrl: string,
  projectId: string,
  platform: TriggerPlatform | null,
  dryRun?: boolean,
): string {
  const url = triggerSetupUrl(appBaseUrl, projectId, platform);
  const picked = platform ? TRIGGER_PLATFORMS.find((p) => p.id === platform)?.label : "the picker";
  console.log(
    `\n  Opening the hosted trigger setup${platform ? ` for ${picked}` : ""}:\n\n    ${url}\n`,
  );
  console.log("  Paste the URL above if the browser doesn't open.");
  if (!dryRun) tryOpenBrowser(url);
  return url;
}

function printWhatItIs(): void {
  console.log(
    "  A trigger is a scheduled agent that applies changes for you — unattended.\n" +
      "  It's core to how Shipeasy closes the loop: as bugs, feature requests, and\n" +
      "  auto-filed error/alert tickets land in your queue, the trigger runs on a\n" +
      "  cadence (or on each new item), fixes them one at a time, and opens ONE pull\n" +
      "  request per item for you to review. Nothing merges without you.\n",
  );
}

/**
 * Run the automation-trigger step. Shared by the `shipeasy setup` flow and the
 * standalone `shipeasy setup triggers` command.
 */
export async function runTriggerStep(opts: TriggerStepOpts): Promise<TriggerStepResult> {
  printWhatItIs();

  if (opts.ask) {
    if (!opts.interactive) {
      console.log(
        "  • non-interactive — skipped. Enable with `--triggers`, or run\n" +
          "    `shipeasy setup triggers` any time.",
      );
      return { enabled: false };
    }
    const { go } = await prompts({
      type: "confirm",
      name: "go",
      message: "Set up an automation trigger now?",
      initial: true,
    });
    if (!go) {
      console.log("  • skipped — set one up later with `shipeasy setup triggers`.");
      return { enabled: false };
    }
  }

  // An explicit --trigger-platform flag is one-shot: open that platform (or the
  // picker page for an unknown value) and return — no interactive loop.
  if (opts.platform !== undefined) {
    const platform = normalizePlatform(opts.platform);
    const url = openWizard(opts.appBaseUrl, opts.projectId, platform, opts.dryRun);
    return {
      enabled: true,
      platform: platform ?? undefined,
      platforms: platform ? [platform] : [],
      url,
      completed: false,
    };
  }

  // Non-interactive with no flag: open the picker page and return.
  if (!opts.interactive) {
    console.log(
      "  • no platform given — opening the picker (pass --trigger-platform to preselect).",
    );
    const url = openWizard(opts.appBaseUrl, opts.projectId, null, opts.dryRun);
    return { enabled: true, platforms: [], url };
  }

  // Interactive: loop so the user can open several platforms in turn. The CLI
  // stays open the whole time — the browser wizard runs alongside it — until the
  // user picks "Done" or "I'll do it later". Each platform can be revisited; the
  // picker floats step-3-wired platforms to the top and marks opened ones.
  const opened: TriggerPlatform[] = [];
  let lastUrl: string | undefined;
  let completed = false;
  for (;;) {
    const ordered = orderTriggerPlatforms(opts.preferredAgents);
    const { pick } = await prompts({
      type: "select",
      name: "pick",
      message: opened.length
        ? "Open another platform's setup, or finish?"
        : "Which coding platform should run your trigger?",
      choices: [
        ...ordered.map((p) => ({
          title:
            `${p.label} — ${p.sub}` +
            (opened.includes(p.id)
              ? "  (opened ✓)"
              : p.recommended
                ? "  (recommended — wired above)"
                : ""),
          value: p.id as string,
        })),
        { title: "Other / not sure — show me every option", value: "__other" },
        { title: "✓ Done — my trigger(s) are set up", value: "__done" },
        { title: "I'll do it later", value: "__later" },
      ],
      initial: 0,
    });

    // Ctrl-C / Esc closes the picker → treat as "I'll do it later".
    if (pick === undefined || pick === "__later") break;
    if (pick === "__done") {
      completed = true;
      break;
    }

    const platform = pick === "__other" ? null : normalizePlatform(pick as string);
    lastUrl = openWizard(opts.appBaseUrl, opts.projectId, platform, opts.dryRun);
    if (platform && !opened.includes(platform)) opened.push(platform);
    console.log(
      "  The CLI is still running — finish the wizard in your browser, then come back\n" +
        "  here to set up another platform or wrap up.\n",
    );
  }

  console.log(
    completed
      ? opened.length
        ? `  ✓ Done — trigger setup opened for: ${opened.join(", ")}. Finish any open wizard tabs.`
        : "  ✓ Done — no trigger opened. Set one up any time with `shipeasy setup triggers`."
      : "  • Wrap up later — rerun `shipeasy setup triggers` whenever you're ready.",
  );

  return {
    enabled: opened.length > 0,
    platform: opened[0],
    platforms: opened,
    url: lastUrl,
    completed,
  };
}
