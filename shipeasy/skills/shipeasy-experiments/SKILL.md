---
name: shipeasy-experiments
description: Design, launch, monitor, and stop Shipeasy A/B experiments. Trigger on "A/B test", "experiment", "split test", "holdout", "experiment results", "is <experiment> significant (yet)", "metric significance", "how should I structure an experiment", "help me design an A/B test".
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

A create ask is **consultative, not fire-and-forget**. Even when the ask sounds
clear ("A/B test the green checkout button"), don't provision on the first pass:
investigate the code the ask names, come back with 2–4 concrete ways to structure
the test, and **wait for the user to approve one** before you create anything.
Jump straight to "Creating" only when the user has already approved a fully
specified design (variation point + groups + goal metric all pinned). The
read/lifecycle paths (start / results / stop, "is X significant") are the
exception — those are referenced by name, so resolve-then-act without stopping.

## Workflow — design a new experiment (investigate → propose → approve → provision)

When the user says *"A/B test <X>"* / *"set up an A/B test for <X>"* (or anything
equivalent — including "how should I structure an experiment on <X>"), run this
four-step flow. The first three steps are **required** even for a clear-sounding
ask: a good experiment comes from reading the actual code, and the *user* picks
the design — you don't pick it for them.

1. **Investigate the code (required, scoped).** Read the specific surface the ask
   names — the checkout flow for "A/B test the checkout button", the pricing page
   for "test the pricing layout". Scope it to that feature; a whole-repo sweep
   isn't needed. Use Grep/Glob/Read (or the shell if you have one) to find the
   variation point, existing `flags.track(...)` events, and existing metrics
   (`metrics_events_list` + `metrics_list`). Capture file:line for each candidate.
   See Phases 1–2 for the heuristics.
2. **Propose the arms and the tuning.** Turn what you found into a concrete
   design and put the open decisions to the user rather than picking silently:
   - **Arms.** When the user didn't name exact variants, propose a few candidate
     treatment arms (each a real, buildable change at the variation point) and let
     them **select which to include** — one treatment, several, or all. Offer this
     as a multi-select. More arms split traffic thinner, so each needs longer to
     reach significance (always keep a single `control`).
   - **Goal metric.** The `{ event, aggregation }` bundle from Phase 2, noting what
     new instrumentation (if any) it needs.
   - **Statistical options — surface the ones that apply, don't silently default.**
     For anything the user didn't specify, offer it with its tradeoff (details in
     "Statistical options" below): a **holdout** (a global control slice on the
     universe — measures total lift, at the cost of holding some users out of
     everything), one or more **guardrail metrics** (block ship if a key metric
     regresses), **sequential testing** (peek early without inflating the false-
     positive rate; Premium+), the **allocation %** (what share of eligible traffic
     enters), the **group split** (even vs weighted), and a **targeting gate**
     (who's eligible).
3. **Wait for approval.** Present the arms + tuning and **stop**. Let the user pick
   the arms, tune the knobs, refine, or talk it through — this is a conversation,
   not a form. Do not call `release_experiments_create` (or create any
   event/metric) until the user has approved a design.
4. **Provision the approved design.** Only now run the chain: reuse-or-create the
   event + metric, then `release_experiments_list` + `release_experiments_create`
   for the draft. It lands as a DRAFT — never auto-start. Details in Phase 3.

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

Stop at **one** variation *point* per experiment (changing two things at once
makes the result uninterpretable — that's multivariate, out of scope). But one
variation point can still have **several arms**: `control` plus more than one
treatment (e.g. `green`, `bold`, `outline` for a button). When the user didn't
pin the exact variants, propose a few candidate arms and let them pick which to
include — see step 2.

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

### Phase 3 — provision the approved design (in order, halt on first failure)

Reached only after the user approved a variant (step 3 above). If nothing has
been approved yet, you're still in step 3 — present the options and wait.

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

## Statistical options

These are the knobs that make an experiment trustworthy. When the user didn't
specify them, **offer the ones that apply to *this* test with their tradeoff**
(step 2) — recommend a default, let them tune — rather than silently accepting
the defaults. Read exact shapes/plan gates from the tool schema, not here.

- **Holdout** (`holdout_range` on the universe) — a global control slice held out
  of *every* experiment in the universe. Measures the combined lift of everything
  you ship; costs you those users' exposure. See "Holdouts" below.
- **Guardrail metrics** (`guardrail_metrics`, up to 10) — metrics that must *not*
  regress; a degraded guardrail flips the decision to `hold` even if the goal
  won. Offer one when shipping the winner could hurt something else (latency,
  refunds, error rate).
- **Sequential testing** (`sequential_testing`, Premium+) — always-valid
  p-values, so you can peek at results early and stop as soon as it's significant
  without inflating the false-positive rate. Tradeoff: slightly less power per
  look; needs the plan.
- **Significance threshold** (`significance_threshold`) — the α (default 0.05).
  Tighten for a costly/irreversible ship, loosen for a cheap reversible one.
- **Minimum effect of interest** (`min_effect_of_interest`, per attached metric in
  `set_metrics` / the inline goal+guardrail bodies) — the smallest change *worth
  acting on for THIS experiment's decision*. It is the per-experiment override of
  the metric's `default_min_effect_of_interest`; omit it (or `null`) to inherit the
  metric default. **When you create an experiment and the user hasn't pinned it,
  proactively suggest a value — don't silently inherit** — because the right bar
  depends on the cost/risk of *the specific change under test*, which you know from
  the diff you're shipping, and the metric default cannot. Offer 2–3 concrete
  options scaled to the breadth of the change, recommend one, and let the user tune:
  - **Small / cheap / reversible change** (copy tweak, a color, one-line CTA): a
    *small* MEI (e.g. `0.005`–`0.01`, i.e. 0.5–1%). The change is free to ship, so
    even a tiny lift is worth acting on — but warn this needs more traffic/runtime.
  - **Medium change** (a redesigned component, a new flow step): a *moderate* MEI
    (e.g. `0.02`–`0.03`, 2–3%). Balances runtime against a lift big enough to
    justify the build+maintenance cost.
  - **Large / risky / expensive change** (re-architecture, pricing change, a risky
    migration): a *larger* MEI (e.g. `0.05`+, 5%+). Only ship the winner if the lift
    clears the risk and cost of the change — a marginal win isn't worth it.
  For a **guardrail** attachment this same field is the *non-inferiority margin*:
  how large a regression you'll tolerate before it flips the decision to `hold` —
  scale it the same way (a risky change tolerates less). After the run, compare each
  result's `realized_mde` against the MEI to judge whether the experiment was
  actually powered to detect what you care about.
- **Allocation %** (`allocation_percent`) — the share of *eligible* traffic that
  enters the experiment at all. Ramp it (10 → 50 → 100) to limit blast radius;
  lower allocation → longer to significance.
- **Group split** (group `weight`s, basis points summing to 10000) — even
  (`5000/5000`) unless you have a reason to under-expose a risky treatment.
- **Targeting gate** (`targeting_gate`) — restrict *who is eligible* (country,
  plan, …). Keep it simple; complex eligibility belongs on the universe.
- **Unit of randomization** (`unit_type` on the universe, default `user_id`) —
  the sticky identity assignment hashes on (user, account, device, session).

## Holdouts

Holdouts live on the **universe**, not on individual experiments — per-experiment
holdouts are not a feature, by design. Set the universe's `holdout_range` at
create (`release_experiments_universes_create`) or update it later
(`release_experiments_universes_update`); the range shape and plan requirements
are in the tool schema. To hold out 1% of users, reserve a 100-bucket slice,
e.g. `holdout_range: [0, 99]`.

## Hard rules

- One pre-registered `goal_metric`. Don't keep peeking and renaming.
- **A goal-metric event you create MUST be instrumented in the same change.** If
  Phase 3 creates a new event to back the metric, wire the `track(...)` call into
  the code (Phase 3a) — an un-fired event makes the metric read zero, so the
  experiment can never reach significance. The `metrics_events_create` response
  hands you the language-correct snippet; also add the assignment branch (3d).
- **Surface, don't silently default, the statistical options** (holdout,
  guardrails, sequential testing, allocation, split, targeting, **and the
  `min_effect_of_interest` for each attached metric**) the user didn't pin — offer
  the ones that apply with their tradeoff (step 2 / "Statistical options"). For
  `min_effect_of_interest` specifically, propose 2–3 values scaled to the breadth
  of the change you're shipping and recommend one; never leave it to inherit
  without at least offering.
- Don't restart an experiment under the same name after stopping — the
  assignment hash changes, so users who saw treatment will be
  re-randomized and bias the result. Pick a new name.
- Keep `targeting_gate` simple. Complex eligibility rules belong in the
  universe.
