/**
 * `@shipeasy/openapi` — Shipeasy admin API contract.
 *
 * The hand-authored OpenAPI 3.2 spec under `spec/` is the single source of
 * truth. It is bundled to `openapi.yaml` (`pnpm bundle`) and from there the
 * TypeScript types, Zod validators, and fetch client are generated
 * (`pnpm gen:sdk`). This entry re-exports that generated surface plus the
 * `configure()` helper and the error utilities.
 *
 *   import { configure, createGate, listExperiments } from "@shipeasy/openapi";
 *   import * as schemas from "@shipeasy/openapi/schemas";  // zod validators
 *
 * @see ./client  — generated SDK fns + `configure`
 * @see ./schemas — generated zod validators
 */

// Typed SDK functions + client construction + `configure`.
export * from "./client.js";

// Request/response/component types (`CreateGateRequest`, `Experiment`, …).
export type * from "./generated/types.gen.js";

// Error model: the ErrorCode catalogue, the `{ error, code?, detail? }` body,
// and helpers to recognise/narrow it.
export {
  ERROR_CODES,
  isApiErrorBody,
  errorCodeOf,
  type ErrorCode,
  type ApiErrorBody,
} from "./errors.js";
