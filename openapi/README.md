# @shipeasy/openapi

[![Contract Tests](https://github.com/shipeasy-ai/shipeasy/actions/workflows/contract-tests.yml/badge.svg)](https://github.com/shipeasy-ai/shipeasy/actions/workflows/contract-tests.yml)

The Shipeasy admin **OpenAPI 3.2 spec** (hand-authored, single source of truth)
plus the generated TypeScript client, Zod schemas, and types. Consumed by
`@shipeasy/cli` and `@shipeasy/mcp`.

## Layout

- `spec/` — the hand-authored spec, split across `paths/` and
  `components/schemas/`. **Edit here.**
- `openapi.yaml` — the bundled single-file spec (`pnpm bundle`, Redocly).
- `src/generated/` — the client / Zod / types emitted by `pnpm gen:sdk`
  (`@hey-api/openapi-ts`).

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm lint:spec` | Redocly lint of `spec/openapi.yaml` |
| `pnpm bundle` | bundle `spec/` → `openapi.yaml` |
| `pnpm gen` | `bundle` + regenerate `src/generated/*` |
| `pnpm test` | spec guard tests (every op declares `x-error-codes`, etc.) |

## Contract testing

The **Contract Tests** badge above tracks the
[`contract-tests`](https://github.com/shipeasy-ai/shipeasy/actions/workflows/contract-tests.yml)
workflow: on every change to `openapi/**` it boots the real admin API server and
fuzzes **this spec** against it with [Schemathesis](https://schemathesis.readthedocs.io/) —
property-based generation of valid and malformed requests for every operation,
asserting no 5xx and full status/schema conformance (the `bearerSdkKey` auth the
spec declares is exercised end-to-end). Run it locally with
`pnpm --filter @shipeasy/ui test:contract` (see `apps/ui/contract-tests/`).

<!-- ci: republish trigger (v2) — publish workflows re-run on the corrected pnpm/action-setup config; no package content change -->
