import { createHmac, randomBytes } from "node:crypto";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { GENERATED_TOOLS } from "../generated/tools.gen.js";

/**
 * List-before-create guard — an MCP-only forcing-function that refuses a
 * `*_create` unless the caller first ran the sibling `*_list` and echoes back
 * the short-lived `listToken` that list handed out. The point is to stop the
 * assistant from blindly creating a duplicate of a resource that already exists:
 * to get the token it MUST have listed, and a list is where an existing match
 * would have shown up.
 *
 * This lives entirely in the MCP process — the CLI (human/script-driven) and the
 * admin API are untouched. It is a nudge for the model, not a security boundary.
 *
 * The token is `HMAC(secret, family + bucket)`:
 *   - `secret` is random per server process, so a token minted by one process is
 *     meaningless to any other → it can never be replayed across sessions.
 *   - `bucket` is a coarse time window, so a token minted earlier in the *same*
 *     session goes stale and forces a fresh list. This is the "function of time"
 *     that makes old values unusable — no server-side state required.
 */

/** Tool-argument name the guarded create tools read the token from. */
export const LIST_TOKEN_PARAM = "listToken";

/**
 * Default token freshness window. A token is accepted in the bucket it was
 * minted in plus the previous one, so effective validity is WINDOW..2×WINDOW
 * (10–20 min). Long enough to survive a real list→inspect→create flow; short
 * enough that a token from earlier in the session goes stale and forces a
 * re-list. Overridable per deployment via `SHIPEASY_MCP_LIST_GUARD_WINDOW_MINUTES`.
 */
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

// ── configuration (env, so it flows straight from an mcp.json `env` block) ────

/**
 * Guard knobs read from the process environment — the portable config surface
 * every MCP client exposes (`mcp.json` / `settings.json` `env`). Read once and
 * memoized: an MCP server's env is fixed for its whole lifetime, and reading it
 * once keeps the schema advertisement and the runtime enforcement in lock-step.
 *
 *   SHIPEASY_MCP_LIST_GUARD            on|off|1|0|true|false   (default: on)
 *   SHIPEASY_MCP_LIST_GUARD_WINDOW_MINUTES   positive number   (default: 10)
 */
export interface GuardConfig {
  enabled: boolean;
  windowMs: number;
}

function parseBool(v: string | undefined, dflt: boolean): boolean {
  if (v == null || v.trim() === "") return dflt;
  const s = v.trim().toLowerCase();
  if (["off", "0", "false", "no", "disable", "disabled"].includes(s)) return false;
  if (["on", "1", "true", "yes", "enable", "enabled"].includes(s)) return true;
  return dflt;
}

function parseWindowMs(v: string | undefined, dfltMs: number): number {
  if (v == null || v.trim() === "") return dfltMs;
  const minutes = Number(v);
  if (!Number.isFinite(minutes) || minutes <= 0) return dfltMs;
  return Math.round(minutes * 60 * 1000);
}

let _cfg: GuardConfig | null = null;

export function guardConfig(): GuardConfig {
  if (!_cfg) {
    _cfg = {
      enabled: parseBool(process.env.SHIPEASY_MCP_LIST_GUARD, true),
      windowMs: parseWindowMs(process.env.SHIPEASY_MCP_LIST_GUARD_WINDOW_MINUTES, DEFAULT_WINDOW_MS),
    };
  }
  return _cfg;
}

/** True when the list-before-create guard is switched on for this process. */
export function guardEnabled(): boolean {
  return guardConfig().enabled;
}

/** Test-only: drop the memoized config so a later `guardConfig()` re-reads env. */
export function __resetGuardConfigForTests(): void {
  _cfg = null;
}

/**
 * Signing secret. For the local stdio server it's a per-process random value —
 * never persisted, verified only by the minting process, so cross-session replay
 * is impossible. The stateless remote worker instead injects a FIXED secret via
 * `setGuardSecret()` (a Worker secret binding): its `*_list` mint and the
 * follow-up `*_create` verify may land on different isolates, so they must share
 * a key. Generated lazily, not at module load: the Workers runtime forbids
 * `randomBytes()` in global scope, so it must run inside a handler.
 */
let _secret: Buffer | null = null;
function secret(): Buffer {
  if (!_secret) _secret = randomBytes(32);
  return _secret;
}

/**
 * Pin the guard's signing secret to a fixed value (the remote worker passes a
 * Worker secret binding here). Idempotent for the same value; required on any
 * stateless/multi-isolate host so a token minted in one isolate verifies in
 * another. No-op for an empty value so a missing binding can't silently install
 * a weak all-zero key. Not called by the stdio server (it keeps the random key).
 */
export function setGuardSecret(sec: string | Uint8Array | null | undefined): void {
  if (sec == null || (typeof sec === "string" && sec.trim() === "") || sec.length === 0) return;
  _secret = Buffer.from(sec as Uint8Array | string);
}

/** Parse a guard on/off value (e.g. an `X-Shipeasy-List-Guard` header) with an
 *  explicit default — the header-transport analogue of the env `SHIPEASY_MCP_LIST_GUARD`. */
export function parseGuardToggle(v: string | null | undefined, dflt: boolean): boolean {
  return parseBool(v ?? undefined, dflt);
}

/** The coarse time bucket `now` falls into. Exported for tests. */
export function bucketAt(now: number, windowMs: number = guardConfig().windowMs): number {
  return Math.floor(now / windowMs);
}

function sign(family: string, bucket: number): string {
  return createHmac("sha256", secret())
    .update(`${family}\n${bucket}`)
    .digest("base64url")
    .slice(0, 16);
}

// ── which tools are list / guarded-create ───────────────────────────────────

const LIST_NAMES: ReadonlySet<string> = new Set(
  GENERATED_TOOLS.map((t) => t.name).filter((n) => n.endsWith("_list")),
);

/**
 * The resource family a `*_list` tool covers (`release_flags_list` →
 * `release_flags`), or `null` if it isn't a list tool.
 */
export function listFamily(toolName: string): string | null {
  return toolName.endsWith("_list") ? toolName.slice(0, -"_list".length) : null;
}

/**
 * The resource family a create tool is guarded on, or `null` if the tool isn't a
 * guarded create. A create is guarded iff it ends in `_create` AND its
 * `${family}_list` sibling exists — so `ops_trigger_create_*` (not `_create`),
 * `i18n_keys_push`, and `release_killswitch_set*` all fall out automatically.
 */
export function guardedCreateFamily(toolName: string): string | null {
  if (!toolName.endsWith("_create")) return null;
  const family = toolName.slice(0, -"_create".length);
  return LIST_NAMES.has(`${family}_list`) ? family : null;
}

/** Families that have a guarded create — the ones whose `*_list` should mint a token. */
const GUARDED_FAMILIES: ReadonlySet<string> = new Set(
  GENERATED_TOOLS.map((t) => guardedCreateFamily(t.name)).filter((f): f is string => f !== null),
);

/** True when this `*_list` tool's family has a guarded create to unlock. */
export function listMintsToken(toolName: string): boolean {
  const family = listFamily(toolName);
  return family !== null && GUARDED_FAMILIES.has(family);
}

// ── mint / verify ───────────────────────────────────────────────────────────

export function mintListToken(family: string, now: number, windowMs: number = guardConfig().windowMs): string {
  return sign(family, bucketAt(now, windowMs));
}

export type TokenVerdict = "ok" | "missing" | "invalid";

/** Accept the token if it matches the current or previous bucket for this family. */
export function verifyToken(
  family: string,
  token: unknown,
  now: number,
  windowMs: number = guardConfig().windowMs,
): TokenVerdict {
  if (typeof token !== "string" || token.length === 0) return "missing";
  const b = bucketAt(now, windowMs);
  return token === sign(family, b) || token === sign(family, b - 1) ? "ok" : "invalid";
}

// ── surfaces the server composes ─────────────────────────────────────────────

function familyLabel(family: string): string {
  return family.replaceAll("_", " ");
}

function windowMinutes(): number {
  return Math.max(1, Math.round(guardConfig().windowMs / 60_000));
}

/**
 * Extra `content` block appended to a token-minting list response, carrying the
 * token plus the one instruction the model needs to spend it.
 */
export function listTokenBlock(family: string, token: string): { type: "text"; text: string } {
  return {
    type: "text",
    text:
      `listToken: ${token}\n` +
      `To create a NEW ${familyLabel(family)}, first confirm above that it doesn't already ` +
      `exist, then pass this exact value as \`${LIST_TOKEN_PARAM}\` to \`${family}_create\`. ` +
      `It expires in ~${windowMinutes()} minutes — re-run this list to refresh it.`,
  };
}

/** The refusal returned when a guarded create arrives without a fresh token. */
export function listGuardError(family: string, verdict: Exclude<TokenVerdict, "ok">) {
  const listTool = `${family}_list`;
  const why =
    verdict === "missing"
      ? `no \`${LIST_TOKEN_PARAM}\` was supplied`
      : `the \`${LIST_TOKEN_PARAM}\` supplied is stale or unrecognised`;
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: [
          `LIST_BEFORE_CREATE: ${why}.`,
          ``,
          `Before creating a new ${familyLabel(family)}, call \`${listTool}\` to confirm no`,
          `resource with this name already exists — creating a duplicate is almost never`,
          `what you want. That call returns a short-lived \`${LIST_TOKEN_PARAM}\`; pass it back`,
          `here to proceed.`,
          ``,
          `Fix:`,
          `  1. Call \`${listTool}\` (search/filter for the name you intend to create).`,
          `  2. If it already exists, update that one instead of creating a duplicate.`,
          `  3. Otherwise call \`${family}_create\` again with \`${LIST_TOKEN_PARAM}\` set to the`,
          `     value \`${listTool}\` just returned.`,
        ].join("\n"),
      },
    ],
  };
}

// ── schema advertisement ─────────────────────────────────────────────────────

/**
 * Add the `listToken` input to every guarded create tool's schema so the model
 * knows to carry it. Kept OPTIONAL in the JSON schema on purpose: the server's
 * `listGuardError` gives a far better "go list first" message than a generic
 * client-side "missing required field" would. Non-create tools pass through
 * untouched.
 */
export function withListTokenParam(tools: Tool[]): Tool[] {
  if (!guardEnabled()) return tools;
  return tools.map((t) => {
    const family = guardedCreateFamily(t.name);
    if (!family) return t;
    const schema = t.inputSchema as { properties?: Record<string, unknown> };
    return {
      ...t,
      inputSchema: {
        ...t.inputSchema,
        properties: {
          ...(schema.properties ?? {}),
          [LIST_TOKEN_PARAM]: {
            type: "string",
            description:
              `REQUIRED. The \`${LIST_TOKEN_PARAM}\` returned by the most recent \`${family}_list\` ` +
              `call. It proves you listed existing ${familyLabel(family)} and confirmed this one ` +
              `doesn't already exist before creating it. Call \`${family}_list\` first if you don't ` +
              `have a fresh token.`,
          },
        },
      },
    };
  });
}
