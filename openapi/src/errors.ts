import { zErrorCode } from "./generated/zod.gen.js";
import type { Error as ApiErrorBody, ErrorCode } from "./generated/types.gen.js";

export type { ErrorCode };
export type { ApiErrorBody };

/**
 * The canonical `ErrorCode` catalogue as a runtime array — derived from the
 * generated Zod enum so it can never drift from the spec. Mirrors
 * `@shipeasy/core`'s `ErrorCode`; the parity test (`scripts/check-drift.mjs`)
 * asserts every `x-error-codes` entry in the spec is one of these.
 */
export const ERROR_CODES = zErrorCode.options as readonly ErrorCode[];

/** Type guard for the uniform `{ error, code?, detail? }` error envelope. */
export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
  );
}

/** Narrow an error body to a known `ErrorCode`, or `undefined` if uncatalogued. */
export function errorCodeOf(value: unknown): ErrorCode | undefined {
  if (!isApiErrorBody(value)) return undefined;
  const code = value.code;
  return code && (ERROR_CODES as readonly string[]).includes(code) ? code : undefined;
}

/** Which binary is reporting the failure — determines which command to tell the caller to run. */
export type AuthSurface = "cli" | "mcp";

const REAUTH_COMMAND: Record<AuthSurface, string> = {
  cli: "shipeasy login --force",
  mcp: "shipeasy-mcp install --force",
};

/**
 * Structured, agent-parseable remediation text for an admin-API auth failure
 * (401/403) — shared by the CLI's and MCP's error printers so every command
 * and every tool call reports auth failures the same way. The leading
 * `AUTH_REQUIRED:` / `AUTH_FORBIDDEN:` token is a stable marker a calling
 * agent can grep for; everything after it is human-readable remediation.
 *
 * Returns `undefined` for non-auth statuses so callers fall back to their
 * normal error formatting.
 */
export function formatAuthFailure(
  surface: AuthSurface,
  status: number,
  message: string,
): string | undefined {
  const reauth = REAUTH_COMMAND[surface];
  if (status === 401) {
    return [
      `AUTH_REQUIRED: ${message} (401)`,
      ``,
      `Cause: the request's Shipeasy credentials are missing, invalid, or expired.`,
      `Fix:`,
      `  1. Run: ${reauth}`,
      `  2. Retry the command that failed.`,
    ].join("\n");
  }
  if (status === 403) {
    return [
      `AUTH_FORBIDDEN: ${message} (403)`,
      ``,
      `Cause: the credentials are valid but don't have access to this project or resource.`,
      `Fix:`,
      `  1. Confirm the bound project is correct (check the .shipeasy file, or run: shipeasy root --json).`,
      `  2. If it's the wrong project, run: shipeasy bind <project_id>.`,
      `  3. If it's the right project, ask a workspace admin to grant access — retrying will not help.`,
    ].join("\n");
  }
  return undefined;
}
