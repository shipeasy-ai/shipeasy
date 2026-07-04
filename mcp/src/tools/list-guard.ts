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
 * Token freshness window. A token is accepted in the bucket it was minted in
 * plus the previous one, so effective validity is WINDOW..2×WINDOW (10–20 min).
 * Long enough to survive a real list→inspect→create flow; short enough that a
 * token from earlier in the session goes stale and forces a re-list.
 */
const WINDOW_MS = 10 * 60 * 1000;

/**
 * Per-process signing secret. Never persisted and never leaves the process — a
 * token is only ever verified by the same process that minted it, which is what
 * makes cross-session replay impossible.
 */
const SECRET = randomBytes(32);

/** The coarse time bucket `now` falls into. Exported for tests. */
export function bucketAt(now: number): number {
  return Math.floor(now / WINDOW_MS);
}

function sign(family: string, bucket: number): string {
  return createHmac("sha256", SECRET).update(`${family}\n${bucket}`).digest("base64url").slice(0, 16);
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

export function mintListToken(family: string, now: number): string {
  return sign(family, bucketAt(now));
}

export type TokenVerdict = "ok" | "missing" | "invalid";

/** Accept the token if it matches the current or previous bucket for this family. */
export function verifyToken(family: string, token: unknown, now: number): TokenVerdict {
  if (typeof token !== "string" || token.length === 0) return "missing";
  const b = bucketAt(now);
  return token === sign(family, b) || token === sign(family, b - 1) ? "ok" : "invalid";
}

// ── surfaces the server composes ─────────────────────────────────────────────

function familyLabel(family: string): string {
  return family.replaceAll("_", " ");
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
      `It expires in ~10 minutes — re-run this list to refresh it.`,
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
