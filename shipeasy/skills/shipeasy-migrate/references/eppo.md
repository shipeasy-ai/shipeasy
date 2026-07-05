# Eppo → Shipeasy

Source-specific half of an Eppo migration. Pair with <conventions.md>. Eppo has
no Claude MCP server, so we read its **REST API** with `curl`.

## Prerequisites (Eppo side)

1. An **Eppo API key** (Admin → API Keys) with read access to feature flags —
   NOT an SDK key.
2. Base URL, default `https://eppo.cloud/api/v1` (self-hosted/region deployments
   differ — confirm with the user).

Header: `X-Eppo-Token: $EPPO_API_KEY`. Store the key only as session env var
`EPPO_API_KEY`; never write it to the plan (placeholder `<your-eppo-api-key>`).

**Smoke test** (stop on 401/403/HTML):

```bash
curl -sS -H "X-Eppo-Token: $EPPO_API_KEY" \
  "https://eppo.cloud/api/v1/feature-flags?offset=0&limit=1" | head -c 200
```

## REST reference

Field source of truth: Eppo's OpenAPI at
`https://eppo.cloud/api/docs/swagger-ui-init.js`.

| Purpose | Endpoint |
|---|---|
| List environments | `GET /environments` |
| List flags | `GET /feature-flags?offset=<n>&limit=<n>` (bare JSON array) |
| Get one flag | `GET /feature-flags/{id}` |
| Get env-scoped flag state (allocations) | `GET /feature-flags/{id}/environments/{environmentId}` |
| List audiences | `GET /audiences` (bare array; filters `name_search`/`status`) |
| Get one audience | `GET /audiences/{id}` |

**Conventions.** Fields are `snake_case`; ids are integers; condition `values`
are always arrays. **Pagination:** `offset` + `limit`; stop when a page returns
fewer than `limit`. Flag state (enabled, allocations) is **per environment** —
ask the user which environment to migrate first, then read the env-scoped
endpoint for the canonical waterfall.

**Key objects.** Flag: `key` (code name), `variation_type`
(`BOOLEAN`/`INTEGER`/`NUMERIC`/`STRING`/`JSON`), `variations[]`
(`{ id, name, variant_key }`), and per-env `allocations[]` — an **ordered
waterfall (top wins)**. Allocation: `type`
(`FEATURE_GATE`/`EXPERIMENT`/`SWITCHBACK`), `targeting_rules[]`
(`{ conditions: [{ operator, attribute, values }] }` — conditions ANDed, rules
ORed), `variation_weight[]` (`{ variation_id, weight }`), `audiences[]`
(`{ audience_id, type: IS_IN|IS_NOT_IN }`), `percent_exposure` (0–100),
`is_default` (the bottom "no match" allocation — empty rules, supplies the
default variation). **Audience** = Eppo's reusable segment: `targeting_rules[]`
with the *same shape*, so the operator table below applies to audiences too.

## Type mapping (Eppo → Shipeasy)

| Eppo | Shipeasy resource |
|---|---|
| `BOOLEAN` flag | **gate**. Allocations → an ordered `stack`; `variation_weight` (on/off split) → the entry's `rolloutPct`; `percent_exposure` folds into the same `rolloutPct`. The `is_default` allocation → the bottom `rollout`/`condition` entry. |
| Flag with a `FEATURE_GATE` allocation only | **gate** (as above) |
| Flag with an `EXPERIMENT` allocation (weighted variations, `percent_exposure` < 100) | **experiment**. Variations → groups; `weight` → group `weight` (basis points, sum 10000); `percent_exposure` → `allocation_percent`; the flag's non-boolean variation values → group `params` |
| `STRING`/`INTEGER`/`NUMERIC`/`JSON` flag with a single default variation | **config** (value = the default variation's value) |
| `JSON`/typed flag whose value varies by audience deterministically | config + gate(s), or experiment — see conventions.md → "Targeted configs" |
| `SWITCHBACK` allocation | time-sliced switchback isn't a Shipeasy primitive — **BLOCKED**; note for manual review |

`variation_type` picks the resource: `BOOLEAN` → gate; a randomized weighted
`EXPERIMENT` allocation → experiment; otherwise a value-typed flag → config.
Default value lives on the `is_default` allocation, not the flag.

## Operator mapping (Eppo → Shipeasy)

Eppo condition: `{ operator, attribute, values }`. `attribute` → Shipeasy
`attr` verbatim (Eppo has no fixed attribute vocabulary — they're custom context
fields; map built-ins like `country`/`os`/`browser` to the canonical names in
conventions.md when they line up).

| Eppo `operator` | Shipeasy `op` |
|---|---|
| `MATCHES` (one of) | `in` (many) / `eq` (one) |
| `NOT_MATCHES` / `ONE_OF` negated | `not_in` / `neq` |
| `IS_NULL: true` | note for review (no null op) — or `neq` vs sentinel |
| `IS_NULL: false` | note for review |
| `GT` / `GTE` / `LT` / `LTE` | `gt` / `gte` / `lt` / `lte` |
| `SEMVER_GT` / `SEMVER_GE` / `SEMVER_LT` / `SEMVER_LE` | `semver_gt` / `semver_gte` / `semver_lt` / `semver_lte` |
| regex-style match | `regex` |
| substring | `contains` |
| Audience `IS_IN` / `IS_NOT_IN` | inline the audience's `targeting_rules` (same operator table); reusable audience shared across flags → one migrated **gate** referenced via `gate_pass`, or inline into each |

Eppo allocations across a flag are an **ordered waterfall** — emit one gate
`stack` entry per allocation, in order. Within an allocation, multiple
`targeting_rules` are ORed → a single `condition` entry with `pass: "any"` (or
`in`-collapse same-attribute values); conditions within one rule are ANDed.

## Eppo-specific execute notes

- Read allocations from the **env-scoped** endpoint — the flat flag endpoint
  omits per-env allocations.
- An archived flag (`is_archived`) is skipped unless the user opts in; a flag
  disabled in the chosen env migrates but stays **off**.
- A reusable **audience** used by many flags is best migrated **once** as a
  Shipeasy gate and referenced with `gate_pass`, preserving the dedup; note the
  choice in the plan.
