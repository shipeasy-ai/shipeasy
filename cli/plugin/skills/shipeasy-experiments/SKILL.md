---
name: shipeasy-experiments
description: Design, launch, monitor, and stop Shipeasy A/B experiments. Trigger on "A/B test", "experiment", "split test", "holdout", "metric significance".
user-invocable: true
---

# Shipeasy experiments

An **experiment** is a randomized assignment between two or more variants
within a **universe**. The universe owns holdouts and mutual-exclusion;
individual experiments do not.

## Designing

Before creating, decide:

1. **Universe.** Reuse an existing one if the new test should be mutually
   exclusive with current traffic; otherwise create one.
2. **Groups.** Always include a `control`. Variant names are arbitrary
   strings (`treatment`, `v2`, `bold-cta`, …).
3. **Allocation.** Even split (`50/50`) unless you have a reason. Lower
   variant traffic → longer run-time to significance.
4. **Targeting gate.** Optional — restrict who is even eligible for the
   experiment (e.g. `country in [US, CA]`, `plan != "free"`). Same shape as
   feature gate targeting.
5. **Success metric.** Pre-register one. Adding metrics post-hoc inflates
   false-positive rate.

## Creating

```
mcp tool: exp_create_experiment {
  "name": "checkout_button_v2",
  "universe": "default",
  "groups": [
    { "name": "control",   "allocation": 50, "params": { "variant": "v1" } },
    { "name": "treatment", "allocation": 50, "params": { "variant": "v2" } }
  ],
  "targeting_gate": "checkout_v2_eligible",       // optional
  "success_metric": "purchase_completed"           // optional but recommended
}
```

This creates a **draft**. Drafts are not assigned to traffic. Start it:

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

## Reading from the SDK

```ts
import { experiments } from "@shipeasy/sdk/server";
const { group, params } = await experiments.assign("checkout_button_v2", {
  user_id,
  country,
});
// group is "control" | "treatment" | "...". params.variant is "v1" | "v2".
```

The assignment is **sticky** for the same user_id. Track a single conversion
event from your existing analytics (Segment, PostHog, etc.) — Shipeasy reads
the metric from D1/AE on the next analysis cron.

## Stopping

```
mcp tool: exp_experiment_status { "name": "checkout_button_v2" }
```

Returns: enrolled count per group, current p-value, whether the metric has
reached significance at the configured alpha, and a recommendation
(`keep_running`, `ship_treatment`, `ship_control`, `inconclusive`).

Stop with `exp_stop_experiment { "name": ..., "winner": "treatment" }` (or
`null` for inconclusive). Stopping freezes assignment and writes the result.

## Holdouts

Holdouts live on the **universe**, not on individual experiments. To exclude
1% of users from all experiments in a universe, set the universe's
`holdout_percent`. Per-experiment holdouts are not a feature — by design.

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
  assignment hash changes, so users who saw treatment will be re-randomized
  and bias the result. Pick a new name.
- Keep `targeting_gate` simple. Complex eligibility rules belong in the
  universe.
