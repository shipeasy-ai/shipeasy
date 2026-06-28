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
