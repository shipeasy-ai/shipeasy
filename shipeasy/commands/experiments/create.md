---
description: Analyze the project, propose variation points + a success metric, then create a Shipeasy A/B experiment end-to-end (events instrumented, metric created, experiment drafted).
argument-hint: "<name>"
---

Drive the whole "design a new A/B test" flow from analysis to draft.
Follow the `experiments` skill for semantics. The user typing this
command does **not** know yet which event or metric to use — your job is
to look at the codebase, propose options, confirm with `AskUserQuestion`,
then provision everything.

Prereqs: `.shipeasy` bound, `experiments` + `events` modules enabled
(run `/shipeasy:flags:install` if not — it turns on gates, configs,
events, and experiments together). Experiment `<name>` taken from
`$ARGUMENTS`; if blank, ask.

## Phase 1 — locate variation points in the user's code

Search the codebase for *where the variant decision needs to be made*.
Heuristics in priority order:

1. The user's prompt that triggered this command usually names a feature
   (`/shipeasy:experiments:create checkout_button_v2` → look at checkout
   flow). Grep for the feature name first.
2. If unclear, ask for the surface area before scanning blindly — one
   `AskUserQuestion` with 2–4 candidate areas from the route table
   (`apps/**/page.tsx`, `src/routes/**`).

For each candidate variation point, capture:

- file:line of the component / handler that would branch on the variant
- the user-visible behaviour you'd toggle (button copy, route order,
  ranking weights, layout, …)

Stop at **one** variation point per experiment. Multi-variate is out of
scope here.

## Phase 2 — propose a success metric

A metric ties variant → outcome. Look for:

1. **Existing `events.track(...)` call sites** — `grep -rn 'events\.track\b' src apps` (anywhere in the JS subprojects). These are pre-existing events; a metric over them needs zero new instrumentation.
2. **Implicit conversion points** — checkout submit, signup form
   submit, "Add to cart" handler, share button, etc. — code that fires
   when the user does the thing the experiment cares about. These need a
   new `events.track(name, props)` call.
3. **Existing metrics** — `shipeasy metrics list --json` for anything
   already defined; reusing avoids both an event and a metric.

Build 2–4 candidate metrics, each as `{ event, aggregation, why }`.
Examples:

- `count_users(checkout_completed)` — distinct users who finished
  checkout. Best when "did they convert?" is binary.
- `sum(purchase, amount)` — total revenue. Best when bigger basket is
  the win condition.
- `avg(time_to_paint, ms)` — page-load metric. Best for perf
  experiments.

Present with `AskUserQuestion`:

```
Q: Which metric should decide this experiment?
   Options:
   1. <name1> — <DSL> (reuses event <event1>, no new instrumentation)
   2. <name2> — <DSL> (needs new events.track("<event2>", { ... }) at <file:line>)
   3. <name3> — <DSL> (needs new event)
```

## Phase 3 — provision (in order, halt on first failure)

For the chosen metric:

**3a.** If the event isn't emitted yet, instrument it. Edit the call
site (one Edit per file). Single import:

```ts
import { events } from "@shipeasy/sdk/client"; // or "@shipeasy/sdk/server"
events.track("<event>", { /* labels referenced by the metric query */ });
```

Confirm labels in the payload match every `{label=...}`, `by (...)`,
`value_label` referenced by the metric query — otherwise the metric
returns empty.

**3b.** Create the metric:

```bash
shipeasy metrics create "<metric_name>" \
  --event "<event_name>" \
  --query '<dsl>'
```

**3c.** Create the experiment draft. Default groups are
`control` 50% + `treatment` 50` unless the user asked otherwise. Use
MCP for typed errors:

```
mcp tool: exp_create_experiment {
  "name": "<name from $ARGUMENTS>",
  "universe": "default",
  "groups": [
    { "name": "control",   "allocation": 50, "params": { "variant": "v1" } },
    { "name": "treatment", "allocation": 50, "params": { "variant": "v2" } }
  ],
  "success_metric": "<metric_name>"
}
```

**3d.** Edit the variation point so the runtime branches on
`experiments.assign(...)`:

```ts
import { experiments } from "@shipeasy/sdk/server"; // or "@shipeasy/sdk/client"
const { group } = await experiments.assign("<name>", { user_id });
if (group === "treatment") {
  /* new code path */
} else {
  /* old code path */
}
```

## Phase 4 — verify

```bash
shipeasy metrics list                       # the new metric appears
shipeasy experiments status "<name>"        # state: draft
```

Plus build/type-check the touched files.

## Phase 5 — hand-off

Tell the user:

```
✅ Experiment <name> drafted.
   Variant point: <file:line>
   Event:         <event_name> (new | reused)
   Metric:        <metric_name> = <DSL>
   Groups:        control 50 / treatment 50
Next:
   /shipeasy:experiments:start <name>      # begin assigning traffic
   /shipeasy:experiments:status <name>     # check enrolment + significance later
```

Do **not** start the experiment automatically — the user reviews the
diff first.

## Rules

- Don't restart an experiment under the same name once stopped (the
  assignment hash changes, re-randomising users). New attempts use
  `<old>_v2`.
- Don't add multiple success metrics. Pre-register one. The skill's
  warning about post-hoc metric additions applies here.
- Don't gate eligibility inside the experiment groups — push restrictions
  to a `targeting_gate` (a separate feature gate) so the universe stays
  clean.
