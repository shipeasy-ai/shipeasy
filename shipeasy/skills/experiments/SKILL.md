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
**version drift**: the CLI or plugin is older than the feature being invoked.
Before deeper debugging, update to latest and retry once:

- **CLI:** `npm i -g @shipeasy/cli@latest` (or one-off: `npx @shipeasy/cli@latest <cmd>`).
- **Plugin (skills + slash commands):** `/plugin marketplace update shipeasy`
  then `/plugin install shipeasy@shipeasy`. There is no `claude plugin update`;
  or open `/plugin` and enable auto-update on the `shipeasy` marketplace.
- **MCP server:** pinned to `@shipeasy/mcp@latest` — restart the session to
  pick up a new release.

Only treat it as a real bug if it still fails on the latest CLI **and** plugin.

## Enabling on a project

`/shipeasy:flags:install` (the one platform install — folds gates, configs,
kill switches, experiments, and events) or `shipeasy modules enable experiments`.

## Designing

Before creating, decide:

1. **Universe.** Reuse an existing one if the new test should be mutually
   exclusive with current traffic; otherwise create one.
2. **Groups.** Always include a `control`. Variant names are arbitrary
   strings (`treatment`, `v2`, `bold-cta`, …).
3. **Allocation.** Even split (`50/50`) unless you have a reason. Lower
   variant traffic → longer run-time to significance.
4. **Targeting gate.** Optional — restrict who is even eligible for the
   experiment (e.g. `country in [US, CA]`, `plan != "free"`). Same shape
   as feature gate targeting.
5. **Success metric.** Pre-register one (see the `metrics` skill). Adding
   metrics post-hoc inflates false-positive rate.

## Creating

```
mcp tool: release_experiments_create {
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
mcp tool: release_experiments_start { "name": "checkout_button_v2" }
```

CLI equivalents:

```bash
shipeasy release experiments list
shipeasy release experiments create --help
shipeasy release experiments start <name>
shipeasy release experiments stop <name>
shipeasy release experiments status <name>
```

Slash equivalents:

```
/shipeasy:experiments:create <name>
/shipeasy:experiments:start <name>
/shipeasy:experiments:status <name>
/shipeasy:experiments:stop <name>
```

For the metric query DSL itself, see the `metrics` skill or run
`shipeasy metrics grammar`.

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
mcp tool: release_experiments_status { "name": "checkout_button_v2" }
```

Returns enrolled count per group, current p-value, significance flag,
and a recommendation (`keep_running`, `ship_treatment`, `ship_control`,
`inconclusive`).

Stop with `release_experiments_stop { "name": ..., "winner": "treatment" }`
(or `null` for inconclusive).

## Holdouts

Holdouts live on the **universe**, not on individual experiments. To
exclude 1% of users from all experiments in a universe, set the
universe's `holdout_percent`. Per-experiment holdouts are not a feature
— by design.

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
