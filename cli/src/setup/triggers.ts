import { execSync } from "node:child_process";
import prompts from "prompts";
import { tryOpenBrowser } from "../auth/login";
import { format, underline, wrapText } from "../util/format";
import {
  COPILOT_AGENT_NAME,
  COPILOT_MCP_TOKEN_SECRET,
  writeCopilotAgentFile,
} from "./copilot-agent";

/**
 * The authenticated CLI session captured once by the caller (right after
 * login/bind), so the Copilot secrets step can mint its ops key by REUSING the
 * token already retrieved this run — never by re-resolving credentials from
 * disk/env, which may already be gone by the trigger step and would hard-exit
 * the whole `shipeasy setup` process instead of degrading to the manual wizard.
 * `appBaseUrl` is the admin-API origin (`creds.app_base_url`), which owns
 * `/api/admin/keys`.
 */
export interface CliSession {
  token: string;
  appBaseUrl: string;
}

/** Same contract as `shipeasy setup`'s printer: inline markdown + coloured
 *  status glyphs on a TTY, byte-identical plain text anywhere else. */
function say(text = ""): void {
  console.log(format(text));
}

/**
 * The automation-trigger step of onboarding — now owned by the CLI (it replaces
 * the removed `shipeasy-ops-trigger` skill). It explains what a trigger is, asks
 * whether to set one up, has the user pick a platform, and opens the hosted,
 * guided setup preselected to that platform — see {@link triggerSetupUrl} for
 * which surface each platform lands on. The flow itself (apps/ui trigger-setup)
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
 * Platforms whose onboarding is a modal on the settings Triggers tab, opened by
 * `?tab=triggers&onboard=<platform>` (apps/ui `useOnboardReopen`). Codex has no
 * such modal — settings shows it as a coming-soon card — so it keeps routing to
 * the standalone wizard page.
 */
const SETTINGS_ONBOARD: ReadonlySet<TriggerPlatform> = new Set([
  "claude",
  "cursor",
  "copilot",
  "gemini",
]);

/**
 * Where to send the user to finish setting up their trigger.
 *
 * With a platform preselected we deep-link into that platform's onboarding modal
 * on the settings Triggers tab (`settings?tab=triggers&onboard=<platform>`) —
 * the same modal its "Connect" button opens, so the CLI hands off mid-flow and
 * the user ends up on the surface that manages the trigger afterwards. Codex and
 * the no-platform case fall back to the standalone wizard page
 * (`/triggers?provider=`), which apps/ui `parsePlatform` reads.
 */
export function triggerSetupUrl(
  appBaseUrl: string,
  projectId: string,
  platform?: TriggerPlatform | null,
  opts?: { secretsDone?: boolean; agent?: string },
): string {
  const base = `${appBaseUrl.replace(/\/$/, "")}/dashboard/${projectId}`;
  const settingsModal = !!platform && SETTINGS_ONBOARD.has(platform);
  const params = new URLSearchParams();
  if (settingsModal) {
    params.set("tab", "triggers");
    params.set("onboard", platform!);
  } else if (platform) {
    params.set("provider", platform);
  }
  // Copilot only: the CLI already set the repo's Copilot MCP token secret via
  // `gh`, so tell the flow to render that step as done (both surfaces read it).
  if (opts?.secretsDone) params.set("secretsDone", "1");
  // Copilot only: the CLI wrote the custom-agent file `<agent>.agent.md`, so the
  // flow shows the file step as already done.
  if (opts?.agent) params.set("agent", opts.agent);
  const q = params.toString();
  return `${base}/${settingsModal ? "settings" : "triggers"}${q ? `?${q}` : ""}`;
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
  /**
   * The authenticated CLI session captured once by the caller (after login).
   * Lets the Copilot secrets step mint its ops key by reusing the token already
   * retrieved this run instead of re-resolving credentials (which can be gone by
   * now and would hard-exit). Null/omitted → that step is a best-effort no-op.
   */
  session?: CliSession | null;
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

/** Is the GitHub CLI installed AND authenticated? Best-effort — any failure
 *  (missing binary, not logged in) means we can't script the secrets. */
function ghReady(): boolean {
  try {
    execSync("gh auth status", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** The `owner/repo` slug of the current checkout via `gh`, or null. */
function ghRepoSlug(): string | null {
  try {
    const slug = execSync("gh repo view --json nameWithOwner -q .nameWithOwner", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return slug || null;
  } catch {
    return null;
  }
}

/** Push one value into the repo's Copilot coding-agent secret store. The value
 *  is piped over stdin so it never lands in argv / `ps` output. */
function ghSetAgentsSecret(name: string, value: string, slug: string): void {
  execSync(`gh secret set ${name} --app agents --repo ${slug}`, {
    input: value,
    stdio: ["pipe", "ignore", "pipe"],
  });
}

/**
 * Mint a restricted ops key by REUSING the CLI session token captured earlier
 * this run — a direct admin-API call, so it never re-resolves credentials from
 * disk/env (which may be gone by now) and never `process.exit`s: a failure is a
 * thrown error the caller swallows into its best-effort no-op. `/api/admin/keys`
 * is served by the admin UI worker, so it hangs off `session.appBaseUrl`.
 */
async function mintOpsKey(session: CliSession, projectId: string): Promise<string> {
  const res = await fetch(`${session.appBaseUrl.replace(/\/$/, "")}/api/admin/keys`, {
    method: "POST",
    headers: {
      "X-SDK-Key": session.token,
      "X-Project-Id": projectId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "ops", env: "prod" }),
  });
  const json = (await res.json().catch(() => ({}))) as { key?: string; error?: string };
  if (!res.ok || !json.key) {
    throw new Error(json.error ?? `HTTP ${res.status} minting ops key`);
  }
  return json.key;
}

/**
 * Copilot only, best-effort: mint a restricted ops key and push it into the
 * repo's Copilot coding-agent secret store as `COPILOT_MCP_SHIPEASY_CLI_TOKEN` —
 * the secret the custom-agent file's MCP server reads. Returns true ONLY when the
 * secret was written — any missing/unauthenticated `gh`, no detectable repo, a
 * declined confirm, or a failed `gh`/mint call is a silent no-op (the wizard
 * shows the manual step). Never throws.
 */
async function provisionCopilotMcpSecret(
  projectId: string,
  interactive: boolean,
  session: CliSession | null,
): Promise<boolean> {
  if (!ghReady()) return false;
  const slug = ghRepoSlug();
  if (!slug) return false;
  // No captured session → we'd have to re-pull credentials (and could hard-exit
  // if they're gone). Best-effort contract: skip and let the wizard show the
  // manual step rather than crash the whole `shipeasy setup` run.
  if (!session) return false;

  if (interactive) {
    const { go } = await prompts({
      type: "confirm",
      name: "go",
      message: `Set the Copilot MCP secret ${COPILOT_MCP_TOKEN_SECRET} in ${slug} now via gh?`,
      initial: true,
    });
    if (!go) return false;
  }

  try {
    // Restricted ops key — read-only queue + status flips + link-pr + create-only
    // (never edits/deletes), auto-extends its 7-day expiry on each run. Minted by
    // reusing the session token already retrieved this run, not a fresh re-resolve.
    const opsKey = await mintOpsKey(session, projectId);
    ghSetAgentsSecret(COPILOT_MCP_TOKEN_SECRET, opsKey, slug);
    say(`\n  ✓ Set Copilot MCP secret in ${slug}: ${COPILOT_MCP_TOKEN_SECRET}.`);
    return true;
  } catch (e) {
    say(
      `\n  • Couldn't set the Copilot MCP secret automatically (${
        (e as Error).message.split("\n")[0]
      }).\n    The wizard will show the manual step instead.`,
    );
    return false;
  }
}

/**
 * Copilot only: write `.github/agents/shipeasy.agent.md` (the custom agent that
 * wires the MCP server + carries the ops-work prompt). Best-effort — a write
 * error just logs and the wizard shows the contents for a manual copy. Returns
 * the agent name when the file exists after this step (written or already there),
 * so the deep link can flag the step done.
 */
function provisionCopilotAgentFile(projectId: string, dryRun: boolean): string | null {
  const res = writeCopilotAgentFile({ projectId, dryRun });
  if (res.action === "wrote") {
    say(`\n  ✓ ${dryRun ? "Would write" : "Wrote"} ${res.path} (agent \`${COPILOT_AGENT_NAME}\`).`);
    return COPILOT_AGENT_NAME;
  }
  if (res.action === "skipped") {
    say(`\n  • ${res.path} ${res.detail}. Leaving it as-is (agent \`${COPILOT_AGENT_NAME}\`).`);
    return COPILOT_AGENT_NAME;
  }
  say(
    `\n  • Couldn't write the agent file (${res.detail}). The wizard will show its contents to copy.`,
  );
  return null;
}

/** Open (or print) the hosted wizard for one platform — shared by every path.
 *  For Copilot it first writes the custom-agent file and scripts the repo's MCP
 *  secret via `gh`; the deep link then carries `?agent=…` / `?secretsDone=1` so the
 *  wizard marks those steps complete. */
async function openWizard(
  appBaseUrl: string,
  projectId: string,
  platform: TriggerPlatform | null,
  dryRun?: boolean,
  interactive?: boolean,
  session?: CliSession | null,
): Promise<string> {
  let secretsDone = false;
  let agent: string | undefined;
  if (platform === "copilot") {
    agent = provisionCopilotAgentFile(projectId, dryRun ?? false) ?? undefined;
    if (!dryRun) {
      secretsDone = await provisionCopilotMcpSecret(projectId, interactive ?? false, session ?? null);
    }
  }
  const url = triggerSetupUrl(appBaseUrl, projectId, platform, { secretsDone, agent });
  const picked = platform ? TRIGGER_PLATFORMS.find((p) => p.id === platform)?.label : "the picker";
  say();
  say(`  Opening the hosted trigger setup${platform ? ` for **${picked}**` : ""}:`);
  say();
  // Underlined verbatim rather than markdown-rendered: this is the one line the
  // user may have to copy out by hand, so it must stay a bare, unstyled URL.
  console.log(`    ${underline(url)}`);
  say();
  say("  Paste the URL above if the browser doesn't open");
  if (!dryRun) tryOpenBrowser(url);
  return url;
}

function printWhatItIs(): void {
  say(
    wrapText(
      "**A trigger is a scheduled agent that applies changes for you — unattended.** It's core " +
        "to how Shipeasy closes the loop: as bugs, feature requests, and auto-filed error/alert " +
        "tickets land in your queue, the trigger runs on a cadence (or on each new item), fixes " +
        "them one at a time, and opens **one pull request per item** for you to review. Nothing " +
        "merges without you.",
    ),
  );
  say();
}

/**
 * Run the automation-trigger step. Shared by the `shipeasy setup` flow and the
 * standalone `shipeasy setup triggers` command.
 */
export async function runTriggerStep(opts: TriggerStepOpts): Promise<TriggerStepResult> {
  printWhatItIs();

  if (opts.ask) {
    if (!opts.interactive) {
      say(
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
      say("  • skipped — set one up later with `shipeasy setup triggers`.");
      return { enabled: false };
    }
  }

  // An explicit --trigger-platform flag is one-shot: open that platform (or the
  // picker page for an unknown value) and return — no interactive loop.
  if (opts.platform !== undefined) {
    const platform = normalizePlatform(opts.platform);
    const url = await openWizard(
      opts.appBaseUrl,
      opts.projectId,
      platform,
      opts.dryRun,
      opts.interactive,
      opts.session,
    );
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
    say(
      "  • no platform given — opening the picker (pass --trigger-platform to preselect).",
    );
    const url = await openWizard(
      opts.appBaseUrl,
      opts.projectId,
      null,
      opts.dryRun,
      false,
      opts.session,
    );
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
    lastUrl = await openWizard(
      opts.appBaseUrl,
      opts.projectId,
      platform,
      opts.dryRun,
      opts.interactive,
      opts.session,
    );
    if (platform && !opened.includes(platform)) opened.push(platform);
    say(
      wrapText(
        "The CLI is still running — finish the wizard in your browser, then come back here to " +
          "set up another platform or wrap up",
      ),
    );
    say();
  }

  say(
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
