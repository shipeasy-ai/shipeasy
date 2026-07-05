---
name: shipeasy-metrics
description: Load this skill FIRST for any "what are we measuring / tracking", "what metrics do we have", "what are we already measuring", "list/show our metrics" question — and DO NOT answer it by reading, grepping, or globbing the codebase. The live metric definitions exist only in the Shipeasy backend; read them with the `metrics_list` MCP tool (the backend is the single source of truth — source code does NOT list a project's metrics, so grepping gives a wrong, stale answer). Also creates and inspects custom event metrics (deletion is UI-only). Trigger on any question about what is being measured/tracked, plus "create/track/measure <X>", "measure how many/how often <X> happens", "count <event>", "metric DSL", "event metric", "success metric definition".
user-invocable: true
---

# Shipeasy metrics

A **metric** is a named query over collected events. Metrics power
experiment success criteria and standalone dashboards. They are defined
by a lexical DSL that compiles to Analytics Engine SQL — Shipeasy
materialises results on the daily analysis cron, not on read. The metric DSL
is language-neutral; the event-tracking call is language-specific — the
snippet in step 3 below is the version-correct form for this project's SDK.

CRUD runs through the `metrics_*` MCP tools or the `shipeasy metrics …` CLI.
Prerequisites: a `.shipeasy` binding and the flags module enabled — events (the
data metrics read) come with the flags install (`shipeasy install flags`, or the
guided `shipeasy setup`). Read parameter shapes from the tool (`--help` / MCP
schema), not from here.

## Concepts

- **Event.** A named user action emitted via `flags.track(name, props)`.
  All metric data comes from events. Metrics over an event that is never
  emitted return zero.
- **Aggregation.** How rows roll up — counts, sums, averages, percentiles,
  retention. The full list ships with the DSL grammar: `shipeasy metrics
  grammar` / the `metrics_grammar` MCP tool.
- **Label.** A property on the event payload. Queries can only reference
  labels the event actually carries (details in the `metrics_create` schema).

## DSL

```
name(event[{label op value, ...}][, value_label]) [by (l1, l2)] [without (l1)]
```

Match ops: `=`, `!=`, `=~`, `!~`. Strings quoted.

Examples:

```
count_users(checkout_completed)
sum(purchase{plan!="free"}, amount) by (country)
p99(req_dur{route=~"/api/.*"}, ms) by (route, status)
```

Run `shipeasy metrics grammar` (MCP: `metrics_grammar`) for the full BNF,
aggregation list, and more examples.

## Workflow — create a metric (investigate → propose → approve → create)

When the user says *"create a metric for <X>"* (or anything semantically
equivalent — "track conversion on Y", "measure how many/how often Z happens"),
run the flow below. It is **consultative**: a thorough investigation of the code
is what produces the *right* metric (the user rarely names the exact event up
front), and the user picks the definition rather than having it chosen for them.
Two rules always hold: **(1) reuse before creating** — list events and metrics
first (`metrics_events_list`, `metrics_list`) and use an existing one when it
fits; **(2) investigate, propose, then wait** — read the surface the ask names,
come back with the best candidate event + aggregation (and 1–3 alternatives when
there's a real choice), and **stop for the user to approve** before you call
`metrics_events_create` / `metrics_create`. The one exception is the Quick path
below (the user already gave a complete definition = already approved).

### 0. Scope the metric

Read the user's request. Translate into one sentence of the form
*"count/sum/average of <what>, when <which user action> happens"*. If
you can't fill in the blanks, ask the user **one** clarifying question
(2–4 options framed around concrete app surfaces, not generic phrasing).

A bare *"set up metrics (for my project)"* with no signal named is this same
scope step, not a green light to build one: the metrics platform is already
installed with the flags module, so confirm it's ready and offer to **create**
the first metric — name a concrete candidate from the code — rather than
creating anything unprompted. Wait for the user to pick the signal before you
call `metrics_create`.

### 1. Analyze what already exists (MCP tools — always do this first)

```
metrics_events_list   # already-registered events — reuse one that fits
metrics_list          # existing metrics — reuse one that already covers the ask
```

Always call **both** before creating, and reuse an existing event/metric when
one fits. This dedup check comes first because the MCP tools are always
available (a shell may be too). **Hard gate: do not propose options or create
anything until both lists have returned** — the right event usually already
exists, and the proposal in step 2 is built from what these two calls surface.

Then deepen the analysis by reading the surface the ask names (required, scoped
to that feature): find *uninstrumented* candidates — places where a new
`track(...)` call would naturally belong. Use Grep/Glob/Read for this (or the
shell if you have one); don't skip it just because there's no shell.

```bash
grep -rnE 'flags\.track\(' src apps packages 2>/dev/null | head -50   # optional
```
Candidate sites — places where a new `track(...)` call would naturally belong:

- Form submit handlers (`onSubmit`, `<form action=`).
- Click handlers on primary CTAs (`onClick` on buttons whose copy
  matches the user's intent: "Pay", "Sign up", "Add to cart", …).
- Route handlers / API endpoints that complete the action server-side.
- Existing analytics calls from other libraries (`posthog.capture`,
  `segment.track`, `gtag`, `mixpanel.track`) — mirror those.

For each candidate, capture `file:line` and the user-visible action.

### 2. Propose the metric and wait for approval

Turn the analysis into a recommendation: the best event + aggregation, plus 1–3
alternatives when there's a real choice. Present it to the user with a question
that has 2–4 options, and **stop** — don't call `metrics_events_create` /
`metrics_create` until they approve or refine one. (The Quick path below is the
only skip: if the user already handed you a complete, unambiguous definition,
that *is* the approval — go straight to step 4.) Each option label is the
*event name + one-line behaviour*. Include in the option description:

- whether the event already exists (no new instrumentation) or needs to
  be added (and where),
- the matching DSL query and aggregation choice,
- why this candidate fits the user's stated metric.

Example:

```
Q: Which event should `checkout_conversion` aggregate over?
   1. checkout_completed (existing, fired at apps/web/src/checkout/submit.ts:42)
      → count_users(checkout_completed)
      Best when "did they convert?" is binary.
   2. purchase (existing, fires per item — emits multiple rows per checkout)
      → count_users(purchase)
      Same shape, but you'd need to dedupe per session.
   3. Add a new "checkout_success" event at apps/web/src/checkout/submit.ts:42
      → count_users(checkout_success)
      Cleanest if the existing events carry extra noise.
```

If the user picks option (3) — *new event* — propose the exact
`flags.track(...)` payload (the labels you'll need for filters /
`by (...)` / value position).

**Surface the tunable knobs the user didn't pin.** A metric is more than an
event + aggregation — several statistical knobs shape how it reads, and when the
user didn't specify them, offer the ones that matter *for this metric* with the
tradeoff, rather than silently defaulting:

- **Aggregation** — when "measure X" is ambiguous, show the real choices:
  `count_users` (distinct converters — binary "did they?"), `count` (raw events
  — counts repeats), `sum(value)` (magnitude, e.g. revenue), `avg`/`p95`/`p99`
  (latency-style). The pick changes what "better" means.
- **`direction`** (`higher_better` default / `lower_better` / `neutral`) — for a
  latency, error, or cost metric the win is *down*; set `lower_better` so lift is
  read correctly. `neutral` marks a guardrail you only watch.
- **`winsorizePct`** — clip the top N% of values before aggregating. Offer it for
  long-tailed value metrics (revenue, session length): "clip the top 1% so a few
  whales don't dominate the mean — at the cost of ignoring genuine outliers."
- **`defaultMinEffectOfInterest`** (wire: `default_min_effect_of_interest`) — the
  metric-level DEFAULT smallest relative change worth acting on. Offer it when the
  metric will back an experiment: a tighter value needs more traffic/time; a looser
  one ships faster but misses small wins. It is intrinsic to *what the metric
  measures* and applies to every experiment that attaches the metric — an
  individual experiment can override it per-attachment with `min_effect_of_interest`
  when a specific decision has a different cost/risk bar (see shipeasy-experiments).
  This is the effect *of interest*, not the *detectable* effect — a run's realized
  detectable effect is reported back per result row as `realized_mde`.

Present these as part of the proposal (1–3 options where there's a real choice),
recommend a default, and let the user tune or accept. Don't dump all four on a
trivial count metric — pick the ones that genuinely apply.

### 3. Instrument — **mandatory whenever you create a new event**

Creating an event registers a *name*; it makes no data flow. Until the app
actually calls `track("<event>", …)` at the point the action happens, the metric
reads **zero**. So creating a new event is only half the job — you MUST wire the
tracking call into the code, in the same change, before the task is done. This
is not optional and not "leave it to the user": if you called
`metrics_events_create`, you also edit the code.

The `metrics_events_create` response echoes a language-correct `track(...)`
snippet (picked up from `.shipeasy`) to reinforce exactly this — follow it. Edit
one file; the tracking call below is the exact, version-correct form for this
project's SDK language — use it verbatim:

{{SDK_SNIPPET:metrics/track}}

Confirm every label referenced by the metric query — in filters, the
value position, `by (...)`, or `without (...)` — exists as a property
on this call. Then run the project's typecheck / build so the import resolves.

### 4. Create the metric

```bash
shipeasy metrics create <name> --event-name <event_name> --query '<dsl>'
```

Optional knobs (winsorization, default minimum effect of interest, direction,
folder) and all constraints are in `--help` / the `metrics_create` MCP schema —
the API validates them and returns instructive errors.

### 5. Verify

`shipeasy metrics list` → the new row appears with the rendered query.

If you instrumented a new event, run the project's typecheck / build
to make sure the import resolves.

### Quick path — when the analysis is unnecessary

Skip phases 1–2 only if **all** of the following hold:

- The user explicitly named an event that exists in the codebase, **and**
- the user gave a complete DSL query, **and**
- no new instrumentation is implied.

In that case go straight to phase 4. Otherwise, run the full flow —
"the user didn't ask to be prompted" is not a reason to skip it;
metrics over the wrong event are the most common avoidable mistake.

## Hard rules

- **A created event MUST be instrumented in the same change.** If you call
  `metrics_events_create`, you also wire the `track(...)` call into the code
  (step 3) before the task is done — an un-fired event makes every metric over
  it read zero. Never hand back a "metric created" that silently measures
  nothing.
- **List before you create** (step 1) — reuse an existing event/metric when one
  fits; the wrong-event metric is the most common avoidable mistake.
- **Surface, don't silently default, the statistical knobs** (aggregation,
  `direction`, `winsorizePct`, `minDetectableEffect`) the user didn't pin —
  offer the ones that apply with their tradeoff (step 2).

## Other operations

**"What are we measuring / tracking?" / "what metrics do we have?"** → call
`metrics_list` and report the rows. The metric definitions live in the backend
(the source of truth for what a project measures), so `metrics_list` is the
authoritative answer.

Listing, showing, and the DSL grammar run through the `metrics_list` /
`metrics_show` / `metrics_grammar` MCP tools or the `shipeasy metrics …` CLI.
Creating goes through `metrics_create` (plus
`metrics_events_create` to register a new event) — the analyze → propose →
instrument → create flow above is what this skill drives on an ask.

Deletion is **UI-only**.

## Relationship to experiments

A metric backs an experiment's `goal_metric` by name. Always
pre-register the metric before starting the experiment — adding metrics
post-hoc inflates the false-positive rate. See the `shipeasy-experiments`
skill for the experiment lifecycle.

