# Statsig → Shipeasy

Source-specific half of a Statsig migration. Pair it with
<conventions.md> (the shared target model, plan/execute flow, and operator
target vocabulary). Statsig has no Claude MCP server, so we read its **Console
API** directly with `curl`.

## Prerequisites (Statsig side)

1. A **Statsig Console API key** (NOT a server/client SDK key), created under
   **Project Settings → API Keys** (`console.statsig.com/api_keys`) with read
   access to gates, dynamic configs, and experiments. Console keys start with
   `console-`.
2. Base URL `https://statsigapi.net` (multi-tenant; the key scopes the project).

Headers on every call:
- `STATSIG-API-KEY: $STATSIG_API_KEY`
- `STATSIG-API-VERSION: 20240601`

Ask for the key if not provided; store it **only** as the session env var
`STATSIG_API_KEY` and reference `$STATSIG_API_KEY` in every `curl`. Never write
it to the plan (placeholder `<your-statsig-console-api-key>`).

**Smoke test before scanning** (stop and surface any 401/403/HTML):

```bash
curl -sS -H "STATSIG-API-KEY: $STATSIG_API_KEY" -H "STATSIG-API-VERSION: 20240601" \
  "https://statsigapi.net/console/v1/gates?limit=1&page=1" | head -c 200
```

## Console API reference

Field source of truth: Statsig's OpenAPI at
`https://api.statsig.com/openapi/20240601.json`.

| Purpose | Endpoint |
|---|---|
| List gates | `GET /console/v1/gates?limit=<n>&page=<n>` |
| Get one gate (rules, conditions) | `GET /console/v1/gates/{id}` |
| List dynamic configs | `GET /console/v1/dynamic_configs?limit=<n>&page=<n>` |
| Get one dynamic config | `GET /console/v1/dynamic_configs/{id}` |
| List experiments | `GET /console/v1/experiments?limit=<n>&page=<n>` |
| Get one experiment | `GET /console/v1/experiments/{id}` |
| Get one segment | `GET /console/v1/segments/{id}` |

**Conventions.** Fields are `camelCase`; ids are strings. `targetValue` is a
scalar for a single value and an array for many — normalize to an array.
Numeric comparisons carry real numbers (`28`, not `"28"`).
`passes_gate`/`passes_segment` conditions have **no `operator` key**.
**Pagination:** `page` (1-based) + `limit`; the response wraps results under
`data` with a `pagination.nextPage`. Loop until `nextPage` is null / `data`
empty, for **all three** types.

## Type mapping (Statsig → Shipeasy)

| Statsig | What it is | Shipeasy resource |
|---|---|---|
| **Feature Gate** | boolean with an ordered rule waterfall | **gate**. One rule → one `stack` `condition` entry, in order (see below). Simple single-rule gate → flat `rules` + `rollout_percent`. |
| **Dynamic Config** | rules pick a returned JSON value; `defaultValue` when none match | **config** if the value is effectively uniform; if the value genuinely varies by audience, decompose to config + gate(s) or model as an experiment — see "Targeted configs" in conventions.md |
| **Experiment** | weighted `groups`, `allocation`, targeting gate | **experiment**. Each `group` → a Shipeasy group; `size` → `weight` (scale % to basis points, sum 10000); `allocation` → `allocation_percent`; `targetingGateID` → `targeting_gate` (migrate that gate too, or inline its conditions) |
| **Layer** (mutually-exclusive experiments) | shared allocation budget | put those experiments in **one universe** (conventions.md → mutual exclusion) |

**Key objects.** Gate: `idType` (unit — `userID`/`stableID`/custom), `isEnabled`
(false → migrate but keep off), ordered `rules[]` each with `passPercentage`
(0–100, the pass share of matched users), `conditions[]` (ANDed:
`{ type, operator, targetValue, field, customID }`). A gate has **no default** —
unmatched → false. Dynamic Config adds `defaultValue` + per-rule `returnValue`.
Experiment: `groups[]` (`name`, `size`, `parameterValues`), `allocation`,
`controlGroupID`, `targetingGateID`, `holdoutIDs[]` (dedupe — the live API
double-lists), `layerID`.

### Waterfall → gate stack

Statsig is **first-match-wins with no fall-through**: once a user matches a
rule, they're placed in that rule's pass/fail bucket and later rules aren't
tried. This maps cleanly to the gate `stack`: one `condition` entry per Statsig
rule, in order, with the rule's ANDed conditions as `rules` and
`rolloutPct = passPercentage × 100` (basis points). A `public`/"Everyone" rule →
a `rollout` entry (no rules) at `rolloutPct = passPercentage × 100`. See
conventions.md → "Gates: flat rules vs the stack".

## Operator mapping (Statsig → Shipeasy)

Within a rule, conditions are ANDed. `targetValue` normalizes to an array.

### Condition `type` → attribute

| Statsig `type` | Shipeasy `attr` |
|---|---|
| `public` | — ("Everyone"; a `rollout` stack entry, no rules) |
| `user_id` / `unit_id` (+`customID`) | the mapped unit attribute |
| `email` | `email` (custom) |
| `country` | `country` |
| `app_version` | `app_version` (custom; use `semver_*`) |
| `os_name` / `os_version` | `os` / `os_version` |
| `browser_name` / `browser_version` | `browser` / `browser_version` |
| `locale` | `locale` |
| `custom_field` (+`field`) | the `field` name (custom) |
| `passes_gate` / `fails_gate` | `gate_pass` on the migrated gate name (fails → wrap logic / `neq`-style: put it in a separate step, or inline the gate's conditions) |
| `passes_segment` / `fails_segment` | inline the segment's conditions (fetch `GET /segments/{id}`); rule-based → translate its conditions; small `id_list` → `in`/`not_in` on the unit attr; large/analysis list → **BLOCKED** |
| `environment_tier` | Shipeasy scopes env per key/binding, not targeting — usually drop; note it |
| `experiment_group` | `exp_in` on the migrated experiment (group name), if that experiment is migrated; else BLOCKED |
| `javascript` | **BLOCKED** (arbitrary JS) |

### Operator → `op`

| Statsig operator | Shipeasy |
|---|---|
| `any` / `any_case_sensitive` (1 value) | `eq` |
| `any` / `any_case_sensitive` (many) | `in` |
| `none` / `none_case_sensitive` | `neq` (1) / `not_in` (many) |
| `eq` / `neq` | `eq` / `neq` |
| `gt` / `gte` / `lt` / `lte` | `gt` / `gte` / `lt` / `lte` |
| `version_gt` / `version_gte` / `version_lt` / `version_lte` | `semver_gt` / `semver_gte` / `semver_lt` / `semver_lte` |
| `version_eq` / `version_neq` | `eq` / `neq` (on the version string) |
| `str_starts_with_any` | `regex` `^(a|b|…)` |
| `str_ends_with_any` | `regex` `(a|b|…)$` |
| `str_contains_any` | `contains` (1 value) or `regex` `(a|b|…)` (many) |
| `str_contains_none` | `regex` with negative lookahead, or note for review |
| `str_matches` | `regex` (use the pattern directly) |
| `before` / `after` / `on` (time) | compare a numeric/epoch attribute with `lt` / `gt` / `eq`, or `semver`-style date string; note the context must send it |
| `in_segment_list` / `not_in_segment_list` | small → `in` / `not_in` on the unit attr; large → BLOCKED |
| `array_contains_any` | `contains` on the list attribute |
| `is null` / `is not null` | no direct null op — use `neq`/`eq` against a sentinel, or note for review |

**Shipeasy has native `contains` and `regex`**, so Statsig's string-contains and
regex conditions — BLOCKED in Confidence-style migrations — translate directly.
Case-insensitive Statsig ops (`any`/`none`) → either normalize the context value
or use a case-insensitive `regex`; note it in the plan (conventions.md → case
sensitivity).

## Statsig-specific execute notes

- **Disabled gate/config/experiment** (`isEnabled: false` / experiment not
  `active`): migrate it but create it **off** (`enabled: false` for a gate,
  draft — never `start` — for an experiment). Surface this in the plan.
- **`allocation` < 100** on an experiment → `allocation_percent = allocation`;
  the non-entrants get control at the call site (that's Shipeasy's model).
- **Holdouts** → a **universe** `holdout_range` shared by the affected
  experiments (conventions.md → holdouts). Record every `holdoutID`.
- **Segments with no rule body** (analysis lists) and **`javascript`
  conditions** → BLOCKED; list them for manual review, don't guess.
