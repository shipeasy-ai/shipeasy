# PostHog → Shipeasy

Source-specific half of a PostHog migration. Pair with <conventions.md>.
PostHog **does** publish an MCP server, so the source read is MCP-driven (no
`curl`).

## Prerequisites (PostHog side)

The **PostHog MCP**. Test a simple call (e.g. `feature-flag-get-all` with
`limit=1`). If unavailable, install it:

```
claude mcp add posthog --transport http --url https://mcp-eu.posthog.com/mcp
```

(US projects: `https://mcp.posthog.com/mcp`.) The user authenticates via OAuth
in the browser. No API key to store.

Tools used: `feature-flag-get-all` (paginate `limit`/`offset` until `next` is
null) and `feature-flag-get-definition` (per flag id).

## Scanning

Paginate `feature-flag-get-all` to exhaustion; fetch each flag's definition in
parallel batches. Extract per flag: `key`, `name`, description (if any),
targeting properties, rollout %, variant type (boolean vs multivariant), and the
**bucketing method**:

- `aggregation_group_type_index: null` → **per-user** (default; buckets on
  `distinct_id`).
- `aggregation_group_type_index: <N>` → **per-group** (everyone in the same
  company/project sees the same variant) → maps to a `bucketBy` on the gate
  `stack` entry / experiment `bucket_by` (e.g. `company_id`).

## Type mapping (PostHog → Shipeasy)

| PostHog | Shipeasy resource |
|---|---|
| Boolean flag (release toggle, % rollout, property filters) | **gate**. Filter groups → the `stack`; `rollout_percentage` → the entry's `rolloutPct` (×100 to basis points). |
| Multivariant flag (weighted variants, no payload experiment) | **gate** with a `stack` if the variants are just on/off targeting, or an **experiment** if it's a genuine A/B test — variants → groups, variant `rollout_percentage` → group `weight` (basis points, sum 10000) |
| Flag with a **payload** (JSON returned when enabled) | **config** for the payload value + a **gate** for the enabled condition (conditional payload → config value gated), or fold into an experiment if it's a test |
| PostHog **experiment** (feature-flag-backed) | **experiment**: variants → groups; the linked goal → `goal_metric` (see `shipeasy-metrics`) |

### PostHog filter groups → gate stack

A PostHog flag's targeting is a list of **filter groups**; groups are **ORed**,
properties **within** a group are ANDed, and each group carries its own
`rollout_percentage`. Map each group to a `stack` `condition` entry (properties
→ `rules`, group rollout → `rolloutPct`); because groups are ORed and each is
independent, the first matching entry wins — emit them in listed order. A group
with no properties (release to everyone at N%) → a `rollout` entry.

## Operator mapping (PostHog → Shipeasy)

A PostHog property filter is `{ key, operator, value, type }`.

| PostHog `operator` | Shipeasy `op` |
|---|---|
| `exact` (one value) | `eq` |
| `exact` (list) | `in` |
| `is_not` (one) / (list) | `neq` / `not_in` |
| `gt` / `gte` / `lt` / `lte` | `gt` / `gte` / `lt` / `lte` |
| `icontains` | `contains` (case-insensitive → normalize value or use `regex`) |
| `not_icontains` | `regex` negative-lookahead, or note for review |
| `regex` | `regex` |
| `not_regex` | note for review / `regex` negative construction |
| `is_set` / `is_not_set` | note for review (no null op) — or `neq`/`eq` vs sentinel |
| cohort match | inline the cohort's property filters if rule-based; static/behavioral cohort → **BLOCKED** (surface for review) |

`key` → Shipeasy `attr` (map built-ins to canonical names in conventions.md;
`$geoip_country_code` → `country`, `$browser` → `browser`, `$os` → `os`).
Shipeasy's native `contains`/`regex` cover PostHog's `icontains`/`regex`
directly. Per-group flags carry their group identifier as the bucketing attr
(`bucketBy`), no separate entity to create.

## PostHog-specific execute notes

- **Per-group flags** keep their group identifier as the bucket key — set
  `bucketBy` (gate) / `bucket_by` (experiment) to it; no mapping question beyond
  confirming the field name.
- A disabled PostHog flag migrates but stays **off**.
- Behavioral cohorts (event-history audiences) have no deterministic targeting
  equivalent → BLOCKED; list for manual review.

## Phase 2 note — PostHog is often already behind OpenFeature

Teams frequently read PostHog through a custom OpenFeature provider. Run the
`plan code` **migration-style** detection in conventions.md first: if the app is
already on OpenFeature, Phase 2 is a **provider swap** (register Shipeasy's
provider, leave call sites alone), not a call-site rewrite. If it calls
`isFeatureEnabled` / `getFeatureFlag` / `getFeatureFlagPayload` /
`useFeatureFlagEnabled` directly, rewrite those onto `@shipeasy/sdk`
(`{{SDK_SNIPPET:release/flags}}` etc.).
