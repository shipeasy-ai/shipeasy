/**
 * `@shipeasy/openapi/schemas` — the generated Zod validators, one per request,
 * response, and named component schema (`zCreateGateRequest`, `zError`,
 * `zErrorCode`, …). Structural-only (shape, enums, min/max, oneOf): exactly what
 * the static contract can express. Business rules (weight sums, plan gating,
 * existence) stay on the backend and surface as a documented `Error`.
 *
 * The server parses request bodies through these (single structural definition,
 * guaranteed to match the spec); clients use them for local pre-validation.
 *
 * Generated from `spec/` — never hand-edit. Regenerate with `pnpm gen`.
 */
export * from "./generated/zod.gen.js";
