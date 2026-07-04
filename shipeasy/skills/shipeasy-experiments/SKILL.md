---
name: shipeasy-experiments
description: Design, launch, monitor, and stop Shipeasy A/B experiments. Trigger on "A/B test", "experiment", "split test", "holdout", "experiment results", "is <experiment> significant (yet)", "metric significance".
user-invocable: true
---

# Shipeasy experiments

An **experiment** is a randomized assignment between two or more variants
within a **universe**. The universe owns holdouts and mutual-exclusion;
individual experiments do not.

## What a universe is

A **universe** is the shared randomization space that a set of experiments
lives in. It is the unit of *isolation* and *mutual exclusion*: every
experiment names exactly one universe, and the universe — not the
experiment — owns the traffic-splitting rules that keep those experiments
from interfering with each other.

Concretely, a universe defines:

- **Mutual exclusion.** All experiments in the same universe partition the
  *same* population by bucket, so a given unit can be enrolled in at most
  one experiment per universe at a time. Put experiments that must not
  overlap (e.g. two competing checkout redesigns) in one universe; put
  independent experiments that may run concurrently on the same users in
  **different** universes.
- **Unit of randomization** (`unit_type`, default `user_id`). The
  identity that assignment hashes on and that stays sticky — usually the
  user, but it can be any stable id (account, device, session).
- **Holdout** (`holdout_range`, an inclusive `[lo, hi]` slice of the
  0–9999 bucket space, or `null`). Units hashed into that slice are held
  out of **every** experiment in the universe — the global control group.
  See "Holdouts" below.
- **Name + folder.** The `name` is unique per project and is how
  experiments reference the universe (by bare name, e.g. `"default"`);
  `folder` is organizational metadata only.

Every project has a **`default`** universe. Reuse it — or a shared
universe — when a new experiment must be mutually exclusive with existing
traffic. Create a **new** universe when the experiment should be able to
run on the same users independently of what's already running. Manage
universes with the `release_experiments_universes_*` MCP tools (or
`shipeasy release experiments universes …` on the CLI).

CRUD runs through the `release_experiments_*` /
`release_experiments_universes_*` MCP tools or the `shipeasy release experiments …`
CLI. Prerequisites: a `.shipeasy` binding and the module enabled — experiments
aren't a separate module, they ride the flags install (`shipeasy install flags`, or
the guided `shipeasy setup`). The destructive verb is **archive**, never delete.
Read parameter shapes from the tool (`--help` / MCP schema), not from here.

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
5. **Goal metric.** Pre-register one `goal_metric` (see the
   `shipeasy-metrics` skill) — it's required before start. Adding metrics post-hoc inflates
   false-positive rate.

## How to act

Lifecycle CRUD (list / start / stop / results / update / archive) and universe
management run through the `release_experiments_*` /
`release_experiments_universes_*` MCP tools or the `shipeasy release experiments
…` CLI.

When the design is already pinned down (you know the variation point, the
groups, and the goal metric), jump straight to "Creating" below and call the
MCP/CLI. When you're starting from a **vague ask** — the user wants "an A/B test
on checkout" but hasn't named the variation point, the event, or the metric —
run the full analyze → propose → provision workflow in the next section first.

## Workflow — design a new experiment (analyze → propose → provision)

When the user says *"A/B test <X>"* / *"set up an A/B test for <X>"* (or anything
equivalent), drive the whole "design a new A/B test" flow from analysis to a
provisioned draft. Analyze the codebase to pick the variation point, the event,
and the success metric. For a clear ask (e.g. "A/B test a new green checkout
button"), choose the obvious candidates and **provision the whole chain**:
`metrics_events_list` + `metrics_list` to reuse what already fits, then
`metrics_events_create` + `metrics_create` for anything missing, then
`release_experiments_list` + `release_experiments_create` for the draft — and
report what you built with an offer to adjust. Reserve a clarifying question for
when the surface, event, or metric stays genuinely open after analysis. A bare
"A/B test X" is a request to provision the experiment, so carry through to
`release_experiments_create`.

Prereqs: `.shipeasy` bound, and the `shipeasy` MCP server available — this flow
instruments events and drafts the experiment through it
(`metrics_events_create`, `release_experiments_create`); the `shipeasy` CLI is
the fallback. The experiment `<name>` comes from the user's request; if blank,
ask.

### Phase 1 — locate variation points in the user's code

Search the codebase for *where the variant decision needs to be made*.
Heuristics in priority order:

1. The user's request usually names a feature (`an A/B test on the checkout
   button` → look at the checkout flow). Grep for the feature name first.
2. If unclear, ask for the surface area before scanning blindly — one
   question with 2–4 candidate areas from the route table
   (`apps/**/page.tsx`, `src/routes/**`).

For each candidate variation point, capture:

- file:line of the component / handler that would branch on the variant
- the user-visible behaviour you'd toggle (button copy, route order,
  ranking weights, layout, …)

Stop at **one** variation point per experiment. Multi-variate is out of
scope here.

### Phase 2 — propose a success metric

A metric ties variant → outcome. Look for:

1. **Existing `flags.track(...)` call sites** — `grep -rn 'flags\.track\b' src apps`
   (anywhere in the JS subprojects). These are pre-existing events; a metric over
   them needs zero new instrumentation.
2. **Implicit conversion points** — checkout submit, signup form submit, "Add to
   cart" handler, share button, etc. — code that fires when the user does the
   thing the experiment cares about. These need a new `flags.track(name, props)`
   call.
3. **Existing metrics** — `shipeasy metrics list` for anything already
   defined; reusing avoids both an event and a metric.

Build 2–4 candidate metrics, each as `{ event, aggregation, why }`. Examples:

- `count_users(checkout_completed)` — distinct users who finished checkout. Best
  when "did they convert?" is binary.
- `sum(purchase, amount)` — total revenue. Best when bigger basket is the win
  condition.
- `avg(time_to_paint, ms)` — page-load metric. Best for perf experiments.

Present the choice to the user:

```
Q: Which metric should decide this experiment?
   Options:
   1. <name1> — <DSL> (reuses event <event1>, no new instrumentation)
   2. <name2> — <DSL> (needs new flags.track("<event2>", { ... }) at <file:line>)
   3. <name3> — <DSL> (needs new event)
```

### Phase 3 — provision (in order, halt on first failure)

The SDK calls in 3a and 3d below are the exact, version-correct forms for this
project's SDK language. Use them verbatim.

For the chosen metric:

**3a.** If the event isn't emitted yet, instrument it. Edit the call site (one
Edit per file):

{{SDK_SNIPPET:metrics/track}}

Confirm labels in the payload match every `{label=...}`, `by (...)`,
`value_label` referenced by the metric query — otherwise the metric returns
empty.

**3b.** Create the metric:

```bash
shipeasy metrics create "<metric_name>" \
  --event-name "<event_name>" \
  --query '<dsl>'
```

**3c.** Create the experiment draft. Default groups are an even `control` +
`treatment` split — `weight: 5000` each (basis points) — unless the user asked
otherwise. The decision metric goes
in `goal_metric` (inline: an `event` + `aggregation`, or a DSL `query`); it
auto-creates the event if missing, so the metric you created in 3b can also be
referenced by its query here. Use MCP for typed errors:

```
mcp tool: release_experiments_create {
  "name": "<name from the user's request>",
  "universe": "default",
  "allocation_percent": 100,
  "groups": [
    { "name": "control",   "weight": 5000, "params": { "variant": "v1" } },
    { "name": "treatment", "weight": 5000, "params": { "variant": "v2" } }
  ],
  "goal_metric": { "event": "<event_name>", "aggregation": "count_users" }
}
```

**3d.** Edit the variation point so the runtime branches on the assignment
call — one group takes the new code path, everything else keeps the old one:

{{SDK_SNIPPET:release/experiments}}

### Phase 4 — verify

```bash
shipeasy metrics list                       # the new metric appears
shipeasy release experiments get "<name>"   # state: draft
```

Plus build/type-check the touched files.

### Phase 5 — hand-off

Tell the user:

```
✅ Experiment <name> drafted.
   Variant point: <file:line>
   Event:         <event_name> (new | reused)
   Metric:        <metric_name> = <DSL>
   Groups:        control 5000 / treatment 5000 (basis points)
Next (via the shipeasy MCP server or CLI):
   release_experiments_start   { "id": "<name>" }   # begin assigning traffic
   release_experiments_results { "id": "<name>" }   # enrolment + significance
   # CLI fallback: shipeasy release experiments start|results <name>
```

Do **not** start the experiment automatically — the user reviews the diff first.

Workflow-specific rules (on top of the "Hard rules" below):

- Don't add multiple success metrics. Pre-register one.
- Don't gate eligibility inside the experiment groups — push restrictions to a
  `targeting_gate` (a separate feature gate) so the universe stays clean.

## Creating

**List before you create.** First `release_experiments_list` and check whether
an experiment already covers this test — reuse or update it rather than creating
a duplicate. Likewise list events + metrics before creating those (Phase 3), so
you reuse an existing event/metric instead of duplicating it. Only create what's
genuinely missing.

The call is `release_experiments_create` (CLI: `shipeasy release experiments
create`) — the payload shape is in Phase 3c above and the full param list,
field semantics (weights, allocation, goal vs guardrail metrics), and
constraints are in the tool schema / `--help`; the API enforces them and
returns instructive errors. Add `targeting_gate: "<gate>"` to restrict
eligibility.

This creates a **draft**. Start it with `release_experiments_start { "id": … }`
(CLI: `shipeasy release experiments start <name>`). For the metric query DSL,
run `shipeasy metrics grammar` (or see the `shipeasy-metrics` skill).

## Start or read an experiment referenced by name

An experiment is named in the request, so resolve it first, then act — both
steps run every time, because the list gives the next call its `id`:

1. **Find it.** `release_experiments_list` and match the user's name to read
   its `id`.
2. **Act on that id:**
   - **Start** ("start the X experiment") → `release_experiments_start { id }`.
   - **Read results** ("is X significant yet", "how is X doing") →
     `release_experiments_results { id }`.

So "start the checkout-button experiment" ends in a `release_experiments_start`
call, and "is the checkout-button experiment significant yet" ends in a
`release_experiments_results` call — each on the id the list resolved.

## Reading from the SDK

The assignment call (and the paired conversion `track`) for this project's SDK
language is the snippet in Phase 3d above — use it verbatim.

Assignment is **sticky** for the same user_id. Track conversion via your
existing analytics — Shipeasy reads the metric from D1/AE on the next
analysis cron.

## Stopping

`release_experiments_results { "id": … }` returns the latest per-metric /
per-group result — enrolled count, lift, p-value, significance flag. Use
`release_experiments_timeseries` for the full per-day history, or
`release_experiments_get` for current state.

Stop with `release_experiments_stop { "id": … }` — it halts allocation; the
winner is a *reading* of the results, not a stored field. (Every `id` param
accepts the experiment's `name` or its `exp_…` id; see the tool schema.)

## Holdouts

Holdouts live on the **universe**, not on individual experiments — per-experiment
holdouts are not a feature, by design. Set the universe's `holdout_range` at
create (`release_experiments_universes_create`) or update it later
(`release_experiments_universes_update`); the range shape and plan requirements
are in the tool schema. To hold out 1% of users, reserve a 100-bucket slice,
e.g. `holdout_range: [0, 99]`.

## Hard rules

- One pre-registered `goal_metric`. Don't keep peeking and renaming.
- Don't restart an experiment under the same name after stopping — the
  assignment hash changes, so users who saw treatment will be
  re-randomized and bias the result. Pick a new name.
- Keep `targeting_gate` simple. Complex eligibility rules belong in the
  universe.
