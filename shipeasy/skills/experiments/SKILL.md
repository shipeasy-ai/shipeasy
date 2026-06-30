---
name: experiments
description: Design, launch, monitor, and stop Shipeasy A/B experiments. Trigger on "A/B test", "experiment", "split test", "holdout", "metric significance".
user-invocable: true
---

# Shipeasy experiments

An **experiment** is a randomized assignment between two or more variants
within a **universe**. The universe owns holdouts and mutual-exclusion;
individual experiments do not.

## First fix: update before you debug

Most failures here — `unknown command` / `unknown option`, a missing
subcommand, an unexpected `400`/`404`, or something that worked before — are
**version drift**: the tooling is older than the feature being invoked.
Before deeper debugging, update to latest and retry once:

- **CLI:** `npm i -g @shipeasy/cli@latest` (or one-off: `npx @shipeasy/cli@latest <cmd>`).
- **MCP server:** pinned to `@shipeasy/mcp@latest` — it auto-pulls the newest
  release on restart, so restart the MCP server / session to pick it up.
- **In Claude Code only** (skills + slash commands): `/plugin marketplace update shipeasy`
  then `/plugin install shipeasy@shipeasy`, or open `/plugin` and enable
  auto-update on the `shipeasy` marketplace.

Only treat it as a real bug if it still fails on the latest CLI **and** MCP.

## Enabling on a project

Run the one platform install — it folds gates, configs, kill switches,
experiments, and events into a single step. Experiments are not a separate
module; they ride the flags install:

- **CLI (any harness):** `shipeasy install flags`.
- **In Claude Code:** `/shipeasy:flags:install` (convenience wrapper around
  the same install).

## Designing

Before creating, decide:

1. **Universe.** Reuse an existing one if the new test should be mutually
   exclusive with current traffic; otherwise create one.
2. **Groups.** Always include a `control`. Variant names are arbitrary
   strings (`treatment`, `v2`, `bold-cta`, …).
3. **Group split.** Even split (`50/50`) unless you have a reason — that is
   `weight: 5000` per group (basis points, summing to 10000). Lower variant
   traffic → longer run-time to significance.
4. **Targeting gate.** Optional — restrict who is even eligible for the
   experiment (e.g. `country in [US, CA]`, `plan != "free"`). Same shape
   as feature gate targeting.
5. **Goal metric.** Pre-register one `goal_metric` (see the `metrics`
   skill) — it's required before start. Adding metrics post-hoc inflates
   false-positive rate.

## How to act: MCP server or CLI (plus one workflow command)

Lifecycle CRUD — list / start / stop / results / update / archive, and universe
management — has **no per-verb slash command**. Drive it through:

1. **MCP tools** (`release_experiments_*`, `release_experiments_universes_*`)
   when the `shipeasy` MCP server is registered.
2. **The `shipeasy` CLI** (`shipeasy release experiments …`) as the fallback.

The one exception is `/shipeasy:experiments:create` — a multi-step workflow that
analyzes the project, proposes variation points + a success metric, instruments
events, and *then* drafts the experiment. Reach for it (or just follow the
"Designing" + "Creating" sections below) when starting from a vague ask; use the
MCP/CLI directly when the design is already pinned down.

## Creating

```
mcp tool: release_experiments_create {
  "name": "checkout_button_v2",
  "universe": "default",
  "groups": [
    { "name": "control",   "weight": 5000, "params": { "variant": "v1" } },
    { "name": "treatment", "weight": 5000, "params": { "variant": "v2" } }
  ],
  "targeting_gate": "checkout_v2_eligible",
  "allocation_percent": 100,
  "goal_metric": { "event": "purchase_completed", "aggregation": "count_users" }
}
```

Key shapes (these are the ones people get wrong):

- `groups[].weight` is in **basis points** and must sum to **exactly 10000**
  (a 50/50 split is `5000` + `5000`, not `50` + `50`). There is no
  `groups[].allocation`.
- `allocation_pct` (basis points, 0–10000) — or the friendly alias
  `allocation_percent` (0–100) — is the share of the *targeted* audience
  enrolled at all. Distinct from the per-group `weight` split.
- `goal_metric` is the decision metric. Provide it inline as either a DSL
  `query` (`{ "query": "count_users(purchase_completed)" }`) or an
  `event` + `aggregation` (auto-creates the event). It is **required before
  start**. There is no `success_metric` field. Attach extra
  guardrail/secondary metrics inline via `guardrail_metrics`, or after the
  fact with `release_experiments_set_metrics`.

This creates a **draft**. Start it:

```
mcp tool: release_experiments_start { "id": "checkout_button_v2" }
```

CLI equivalents (the fallback when MCP isn't registered):

```bash
shipeasy release experiments list
shipeasy release experiments create --help
shipeasy release experiments start <name>
shipeasy release experiments stop <name>
shipeasy release experiments results <name>      # enrolment + significance
shipeasy release experiments timeseries <name>   # full per-day history
```

For the metric query DSL itself, see the `metrics` skill or run
`shipeasy metrics grammar`.

## Reading from the SDK

**The customer app may be in any SDK language (ts/python/ruby/go/php/java/
kotlin/swift) — never assume TypeScript/Next.js. Always pull the exact call
site from the `docs` MCP for this project's language.** Detect the language
from `.shipeasy` or the subproject's manifest (`package.json`,
`pyproject.toml`, `Gemfile`, `go.mod`, `pom.xml`, `build.gradle*`,
`composer.json`, `Package.swift`), then fetch the snippet:
`docs_get { sdk: <lang>, path: "experiments", name: "checkout_button_v2" }`
(run `docs_list { sdk: <lang> }` to find the handle; CLI
`shipeasy docs get --sdk <lang> experiments --name checkout_button_v2`). The
example below is **only the shape** — use the docs snippet for the exact,
version-correct call in the project's language.

```ts
// Example shape (TypeScript) — fetch the real call for this project's
// language via docs_get; the API differs per SDK.
import { experiments } from "@shipeasy/sdk/server";
const { group, params } = await experiments.assign("checkout_button_v2", {
  user_id,
  country,
});
```

Assignment is **sticky** for the same user_id. Track conversion via your
existing analytics — Shipeasy reads the metric from D1/AE on the next
analysis cron.

## Stopping

```
mcp tool: release_experiments_results { "id": "checkout_button_v2" }
```

(`id` accepts the experiment's `name` or its `exp_…` id.) Returns the
latest per-metric/per-group result — enrolled count, lift, p-value,
significance flag. Use `release_experiments_timeseries` for the full
per-day history, or `release_experiments_get` for the experiment's current
state. There is no `release_experiments_status`.

Stop with `release_experiments_stop { "id": ..., "winner": "treatment" }`
(or omit `winner` for inconclusive).

## Holdouts

Holdouts live on the **universe**, not on individual experiments. The
universe's `holdout_range` is an inclusive `[lo, hi]` bucket range over
0–9999 — callers hashed into that slice are excluded from every experiment
in the universe (`null` disables it). To hold out 1% of users, reserve a
100-bucket slice, e.g. `holdout_range: [0, 99]`. Set it at create
(`release_experiments_universes_create`) or update it later
(`release_experiments_universes_update`). Per-experiment holdouts are not a
feature — by design. (Holdouts require Pro plan or higher.)

## Errors → action

| Error                  | Action                                                |
| ---------------------- | ----------------------------------------------------- |
| `400 group weights ≠ 10000` | Fix `groups[].weight` (basis points; must sum to 10000). |
| `409`/`412` while running | `allocation_pct`/`groups`/`salt`/`universe`/`params` are immutable while running — stop the experiment first. |
| `422 universe not found` | Create the universe, or fix the `universe` name.      |
| `409 name exists`      | Reuse if drafted; otherwise rename.                   |
| `412 not in draft`     | Stop or recreate — running experiments are immutable. |
| `401`                  | Re-run `shipeasy login`.                              |
| `429` plan-limit       | Surface to user.                                      |

## Hard rules

- One pre-registered `goal_metric`. Don't keep peeking and renaming.
- Don't restart an experiment under the same name after stopping — the
  assignment hash changes, so users who saw treatment will be
  re-randomized and bias the result. Pick a new name.
- Keep `targeting_gate` simple. Complex eligibility rules belong in the
  universe.
