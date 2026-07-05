# Optimizely → Shipeasy

Source-specific half of an Optimizely **Feature Experimentation** migration.
Pair with <conventions.md>. No Claude MCP server — read the **REST API** with
`curl`.

## Prerequisites (Optimizely side)

1. An **Optimizely API token** (Account Settings → API Access; a Personal Access
   Token with read access to flags, rulesets, and audiences).
2. The **Project ID** (the number in `app.optimizely.com/v2/projects/<ID>/...`).
   Not a secret — may be written to the plan.
3. Two base URLs, same token: Flags API `https://api.optimizely.com/flags/v1`;
   Platform API `https://api.optimizely.com/v2` (audiences, environments).

Header: `Authorization: Bearer $OPTIMIZELY_API_TOKEN`. Store the token only as
`OPTIMIZELY_API_TOKEN`; the project id as `OPTIMIZELY_PROJECT_ID`. Never write
the token to the plan (placeholder `<your-optimizely-api-token>`).

**Smoke test** (stop on 401/403/HTML):

```bash
curl -sS -H "Authorization: Bearer $OPTIMIZELY_API_TOKEN" \
  "https://api.optimizely.com/flags/v1/projects/$OPTIMIZELY_PROJECT_ID/flags?per_page=1" | head -c 200
```

## REST reference

Field source of truth:
`https://docs.developers.optimizely.com/feature-experimentation/reference`.
`{flags}` = `https://api.optimizely.com/flags/v1`, `{v2}` =
`https://api.optimizely.com/v2`.

| Purpose | Endpoint |
|---|---|
| List flags | `GET {flags}/projects/{PID}/flags?per_page=100&page=<n>` |
| Get one flag | `GET {flags}/projects/{PID}/flags/{FLAG_KEY}` |
| List a flag's variations | `GET {flags}/projects/{PID}/flags/{FLAG_KEY}/variations` |
| Ruleset for a flag in an env | `GET {flags}/projects/{PID}/flags/{FLAG_KEY}/environments/{ENV_KEY}/ruleset` |
| List audiences | `GET {v2}/audiences?project_id={PID}&per_page=100&page=<n>` |
| Get one audience | `GET {v2}/audiences/{AUDIENCE_ID}` |
| List environments | `GET {v2}/environments?project_id={PID}` |

**Conventions.** Fields are `snake_case`. **Percentages are basis points out of
10000** (`10000`=100%, `2500`=25%) — this already matches Shipeasy's
`rollout_pct`/`weight` scale, so carry them across directly. Audience
`conditions` is a **JSON-encoded string** — parse it, then walk it. List
endpoints wrap results as `{ "items": [...], "page": N, "total_pages": M }`.

**Key objects.** Flag: `key`, `variable_definitions` (map
`key → { type, default_value }`; `default_value` is always a string — parse per
`type`). A flag with no variables (or a single boolean variable) is boolean.
Variation (`/variations`): `key` (`on`/`off`/custom) + `variables` (the values
it serves). Ruleset (per env): `rules` (map `rule_key → Rule`),
`rule_priorities` (**ordered, first wins**), `enabled`, `default_variation_key`.
Rule: a **targeted delivery** (audience → rollout %) or an **A/B test**
(audience → weighted variations via `percentage_included`).

## Type mapping (Optimizely → Shipeasy)

| Optimizely | Shipeasy resource |
|---|---|
| Flag, no variables (boolean) | **gate**. `rule_priorities` → an ordered `stack`, one entry per rule; a targeted-delivery rule's rollout % (basis points) → the entry's `rolloutPct`; its audience → the entry's `rules`. |
| Targeted delivery rule | one `stack` `condition` entry: audience → rules, rollout % → `rolloutPct` |
| A/B test rule (weighted variations) | **experiment**: variations → groups, `percentage_included` (basis points) → group `weight`, the rule's traffic allocation → `allocation_percent`, audience → `targeting_gate`; variation `variables` → group `params` |
| Flag with variables, single delivery | **config** (value = the served variation's variables) |
| Flag whose variable values vary by audience deterministically | config + gate(s) — see conventions.md → "Targeted configs" |
| **Exclusion group** (mutually-exclusive rules/experiments) | put the experiments in **one universe** (conventions.md → mutual exclusion) |

## Operator mapping (Optimizely → Shipeasy)

Optimizely audience `conditions` is a nested boolean tree (JSON string) of
leaves `{ type: "custom_attribute", name, match, value }` combined with `"and"`
/ `"or"` / `"not"` operators (the first array element is the combinator).

| Optimizely `match` | Shipeasy `op` |
|---|---|
| `exact` (string/number/bool) | `eq` |
| `substring` | `contains` |
| `gt` / `ge` / `lt` / `le` | `gt` / `gte` / `lt` / `lte` |
| `semver_gt` / `semver_ge` / `semver_lt` / `semver_le` / `semver_eq` | `semver_gt` / `semver_gte` / `semver_lt` / `semver_lte` / `eq` |
| `exists` | note for review (no null op) — or `neq` vs sentinel |
| (regex via a `match` variant) | `regex` |
| `not` wrapping a leaf | invert: `eq`→`neq`, `contains`→`regex` negative-lookahead/note, `in`→`not_in` |

Combinator mapping onto the flat/stack model:
- **AND of leaves** → the entry's `rules` (flat, all ANDed).
- **OR of same-attribute values** → a single `in` with the value list.
- **OR across attributes** → a `stack` `condition` entry with `pass: "any"`.
- **NOT** → the negated `op` on that leaf.

`name` (the custom-attribute key) → Shipeasy `attr` verbatim; map recognizably
built-in ones (`country`, `browser`, `os`) to the canonical names in
conventions.md. A **reusable audience** shared across flags → migrate once as a
gate, reference via `gate_pass`.

## Optimizely-specific execute notes

- Read the **ruleset per environment** (`.../environments/{ENV_KEY}/ruleset`) —
  ask which env to migrate; each env has its own rule order.
- Percentages are already basis points — do **not** re-scale.
- A flag with `enabled: false` in the chosen env migrates but stays **off**;
  archived flags are skipped unless the user opts in.
- Exclusion-group mutual exclusion → shared **universe**; note any group whose
  members you didn't all migrate together.
