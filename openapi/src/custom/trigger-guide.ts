import { type CustomOp, CustomOpError } from "./types.js";
import {
  TRIGGER_AUTH_SAFETY,
  TRIGGER_CAVEAT,
  TRIGGER_FIREABLE_NOTES,
  TRIGGER_NOT_FIREABLE_NOTE,
  TRIGGER_PROMPT,
  TRIGGER_PROVIDER_META,
  TRIGGER_PROVIDER_SECTIONS,
} from "./trigger-guide-content.js";

/**
 * `trigger guide` — print the provider-specific runbook for provisioning the
 * recurring, unattended feedback trigger (the `shipeasy-ops-work --pr` loop on
 * a schedule). One provider per call: the agent runs it, follows the output,
 * and never needs the whole 10-provider document in context.
 *
 * Provider resolution, in order:
 *   1. explicit `provider` param;
 *   2. the calling harness, auto-detected — the MCP server maps the client's
 *      `clientInfo.name` (exact), the CLI sniffs well-known env markers
 *      (best-effort);
 *   3. neither → the op returns the provider index so the caller can ask.
 *
 * Pure/worker-safe: no fs, no fetch — content ships with the package.
 */

export const TRIGGER_PROVIDERS = Object.keys(TRIGGER_PROVIDER_META);

/**
 * Map an MCP `clientInfo.name` to a trigger provider. Client names are not
 * standardized (`claude-code`, `cursor-vscode`, `codex-mcp-client`, …), so this
 * matches on well-known substrings. Exported for the MCP server, which injects
 * the result as the default `provider` before dispatching the op.
 */
export function providerFromClientName(name: string | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  const pairs: [string, string][] = [
    ["claude", "claude"],
    ["cursor", "cursor"],
    ["copilot", "copilot"],
    ["windsurf", "windsurf"],
    ["codeium", "windsurf"],
    ["codex", "codex"],
    ["cline", "cline"],
    ["openclaw", "openclaw"],
    ["opencode", "opencode"],
    ["continue", "continue"],
    ["gemini", "gemini"],
    ["jules", "gemini"],
  ];
  for (const [needle, provider] of pairs) if (n.includes(needle)) return provider;
  return null;
}

/**
 * Best-effort harness detection from env markers, for CLI invocations where no
 * MCP clientInfo exists. Only markers with a known owner are checked; anything
 * ambiguous falls through to null (caller asks the user). Worker-safe: guards
 * on `process` existing.
 */
export function providerFromEnv(env?: Record<string, string | undefined>): string | null {
  const e = env ?? (typeof process !== "undefined" ? process.env : undefined);
  if (!e) return null;
  if (e.CLAUDECODE || e.CLAUDE_CODE_ENTRYPOINT) return "claude";
  if (e.CURSOR_TRACE_ID || e.CURSOR_AGENT) return "cursor";
  if (e.CODEX_SANDBOX || e.CODEX_THREAD_ID) return "codex";
  if (e.GEMINI_CLI || e.GEMINI_SANDBOX) return "gemini";
  if (e.OPENCODE || e.OPENCODE_BIN_PATH) return "opencode";
  return null;
}

function buildGuide(provider: string): Record<string, unknown> {
  const meta = TRIGGER_PROVIDER_META[provider];
  const fireNote = TRIGGER_FIREABLE_NOTES[provider] ?? TRIGGER_NOT_FIREABLE_NOTE;
  const guide = [
    `# Shipeasy feedback trigger — \`${provider}\` (Tier ${meta.tier})`,
    ``,
    `Scheduler: ${meta.scheduler}.`,
    `Shipeasy-fireable connector: ${meta.shipeasyFireable ? "yes — register it after provisioning (`shipeasy trigger link`)" : "no — scheduled and fired on the provider's own platform"}.`,
    ``,
    TRIGGER_PROMPT,
    ``,
    `---`,
    ``,
    TRIGGER_PROVIDER_SECTIONS[provider],
    ``,
    `---`,
    ``,
    `## Shipeasy connector status for \`${provider}\``,
    ``,
    fireNote,
    ``,
    TRIGGER_AUTH_SAFETY,
    ``,
    TRIGGER_CAVEAT,
  ].join("\n");
  return {
    provider,
    tier: meta.tier,
    scheduler: meta.scheduler,
    shipeasyFireable: meta.shipeasyFireable,
    guide,
  };
}

export const triggerGuideOp: CustomOp = {
  group: ["trigger"],
  name: "guide",
  summary: "Print the per-provider runbook for provisioning the recurring feedback trigger",
  description:
    "Resolves the provider (explicit --provider beats the auto-detected calling " +
    "harness) and prints that platform's full trigger-install runbook: the shared " +
    "trigger prompt, the provider's scheduler setup, its Shipeasy-connector status, " +
    "and the auth/safety rules. With neither given nor detectable, returns the " +
    "provider index (tier + scheduler per provider) so the caller can ask the user. " +
    "The shipeasy-ops-trigger skill drives provisioning by following this output.",
  params: [
    {
      name: "provider",
      type: "string",
      description:
        "Platform that hosts the scheduled run. Omit to auto-detect the calling harness.",
      enum: TRIGGER_PROVIDERS,
    },
  ],
  examples: [
    { note: "Runbook for the detected harness", run: "shipeasy trigger guide" },
    { note: "Explicit provider", run: "shipeasy trigger guide --provider codex" },
  ],
  run: (args) => {
    const requested = typeof args.provider === "string" ? args.provider.toLowerCase().trim() : "";
    if (requested && !TRIGGER_PROVIDER_META[requested]) {
      throw new CustomOpError(
        `Unknown provider '${requested}'. One of: ${TRIGGER_PROVIDERS.join(", ")}`,
      );
    }
    const provider = requested || providerFromEnv();
    if (!provider) {
      return {
        provider: null,
        note:
          "No provider given and the calling harness wasn't detectable. Ask the user " +
          "to pick one, then re-run with --provider <name>.",
        providers: Object.entries(TRIGGER_PROVIDER_META).map(([name, m]) => ({
          name,
          tier: m.tier,
          scheduler: m.scheduler,
          shipeasyFireable: m.shipeasyFireable,
        })),
      };
    }
    return buildGuide(provider);
  },
};
