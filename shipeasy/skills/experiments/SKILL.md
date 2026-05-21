---
name: experiments
description: Design, launch, monitor, and stop Shipeasy A/B experiments. Trigger on "A/B test", "experiment", "split test", "holdout", "metric significance".
user-invocable: true
---

# Shipeasy experiments

An **experiment** is a randomized assignment between two or more variants
within a **universe**. The universe owns holdouts and mutual-exclusion;
individual experiments do not.

## Enabling on a project

`/shipeasy:experiments:install` (or `shipeasy modules enable experiments`).

## Designing

Before creating, decide:

1. **Universe.** Reuse an existing one if the new test should be mutually
   exclusive with current traffic; otherwise create one.
2. **Groups.** Always include a `control`. Variant names are arbitrary
   strings (`treatment`, `v2`, `bold-cta`, …).
3. **Allocation.** Even split (`50/50`) unless you have a reason. Lower
   variant traffic → longer run-time to significance.
4. **Targeting gate.** Optional — restrict who is even eligible for the
<<<<<<<< HEAD:shipeasy/skills/shipeasy-experiments/SKILL.md
   experiment. Same shape as feature gate targeting.
5. **Success metric.** Pre-register one. Adding metrics post-hoc inflates
   false-positive rate.
========
   experiment (e.g. `country in [US, CA]`, `plan != "free"`). Same shape
   as feature gate targeting.
5. **Success metric.** Pre-register one (see the `metrics` skill). Adding
   metrics post-hoc inflates false-positive rate.
>>>>>>>> f82a432 (feat: consolidate 5 plugins into single shipeasy plugin):shipeasy/skills/experiments/SKILL.md

## Creating

```
mcp tool: exp_create_experiment {
  "name": "checkout_button_v2",
  "universe": "default",
  "groups": [
    { "name": "control",   "allocation": 50, "params": { "variant": "v1" } },
    { "name": "treatment", "allocation": 50, "params": { "variant": "v2" } }
  ],
  "targeting_gate": "checkout_v2_eligible",
  "success_metric": "purchase_completed"
}
```

This creates a **draft**. Start it:

```
mcp tool: exp_start_experiment { "name": "checkout_button_v2" }
```

CLI equivalents:

```bash
shipeasy experiments list
shipeasy experiments create --help
shipeasy experiments start <name>
shipeasy experiments stop <name>
shipeasy experiments status <name>
```

<<<<<<<< HEAD:shipeasy/skills/shipeasy-experiments/SKILL.md
## Metric query DSL

Metrics are defined with a lexical query that compiles to Analytics Engine SQL.
The form `name(event[{filters}][, value_label])` selects what to aggregate, and
the optional `by (label)` / `without (label)` clause splits the time series on
the dashboard.

```
count_users(checkout_completed)
sum(purchase{country="US"}, amount)
p99(req_dur{route=~"/api/.*"}, ms) by (route, status)
retention_7d(session_start)
avg(req_dur{tier!="free"}, ms) without (region)
```

Aggregations: `count_users`, `count`, `sum`, `avg`, `min`, `max`, `unique`,
`p50`/`p75`/`p90`/`p95`/`p99`/`p999`, `retention_<N>d` (N in 1..90).
Match operators: `=`, `!=`, `=~`, `!~`. Strings must be quoted (`"..."`).
Filter labels and value labels must be declared on the source event (string
or number properties — Shipeasy packs them into reserved AE columns).

```bash
shipeasy metrics grammar                       # full reference
shipeasy metrics create purchase_amount \\
  --event purchase --query 'sum(purchase, amount)'
shipeasy metrics list
```

The same `query` string is accepted by `POST /api/admin/metrics`. The server
parses it, validates label references against the event registry, and stores
the typed IR. `query_ir` (the JSON form) is also accepted for programmatic use.

========
Slash equivalents:

```
/shipeasy:experiment:create <name>
/shipeasy:experiment:start <name>
/shipeasy:experiment:status <name>
/shipeasy:experiment:stop <name>
```

>>>>>>>> f82a432 (feat: consolidate 5 plugins into single shipeasy plugin):shipeasy/skills/experiments/SKILL.md
## Reading from the SDK

```ts
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
mcp tool: exp_experiment_status { "name": "checkout_button_v2" }
```

Returns enrolled count per group, current p-value, significance flag,
and a recommendation (`keep_running`, `ship_treatment`, `ship_control`,
`inconclusive`).

Stop with `exp_stop_experiment { "name": ..., "winner": "treatment" }`
(or `null` for inconclusive).

## Holdouts

<<<<<<<< HEAD:shipeasy/skills/shipeasy-experiments/SKILL.md
Holdouts live on the **universe**, not on individual experiments.
========
Holdouts live on the **universe**, not on individual experiments. To
exclude 1% of users from all experiments in a universe, set the
universe's `holdout_percent`. Per-experiment holdouts are not a feature
— by design.
>>>>>>>> f82a432 (feat: consolidate 5 plugins into single shipeasy plugin):shipeasy/skills/experiments/SKILL.md

## Errors → action

| Error                  | Action                                                |
| ---------------------- | ----------------------------------------------------- |
| `400 group sums ≠ 100` | Fix `allocation`.                                     |
| `409 name exists`      | Reuse if drafted; otherwise rename.                   |
| `412 not in draft`     | Stop or recreate — running experiments are immutable. |
| `401`                  | Re-run `shipeasy login`.                              |
| `429` plan-limit       | Surface to user.                                      |

## Hard rules

- One pre-registered success metric. Don't keep peeking and renaming.
- Don't restart an experiment under the same name after stopping — the
  assignment hash changes, so users who saw treatment will be
  re-randomized and bias the result. Pick a new name.
- Keep `targeting_gate` simple. Complex eligibility rules belong in the
  universe.
