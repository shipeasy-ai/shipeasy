---
name: shipeasy-metrics
description: Answers "what are we measuring / tracking", "what metrics do we have", "list/show our metrics" — the live metric definitions live in the Shipeasy backend, so read them with metrics_list (the backend is the source of truth for what a project measures). Also creates and inspects custom event metrics (deletion is UI-only). Trigger on any question about what is being measured/tracked, plus "create/track/measure <X>", "measure how many/how often <X> happens", "count <event>", "metric DSL", "event metric", "success metric definition".
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

## Workflow — create a metric (analyze → decide → instrument → create)

When the user says *"create a metric for <X>"* (or anything semantically
equivalent — "track conversion on Y", "measure how many/how often Z happens"),
run the full **analyze-and-decide** path below — a thorough analysis is what
produces the *right* metric, since the user rarely names the exact event up
front. Two rules always hold: **(1) reuse before creating** — list events and
metrics first (`metrics_events_list`, `metrics_list`) and use an existing one
when it fits; **(2) carry a clear intent through to creation** — for a concrete
ask like "measure how many checkouts complete", analyze the candidates, pick the
best event name + aggregation, create the event (`metrics_events_create`) and
the metric (`metrics_create`), then report what you built and offer to adjust.
Reserve a single clarifying question for the case where the event or aggregation
stays genuinely ambiguous after analysis — a "measure X" ask is a request to
*create* the metric, so follow through to creation.

### 0. Scope the metric

Read the user's request. Translate into one sentence of the form
*"count/sum/average of <what>, when <which user action> happens"*. If
you can't fill in the blanks, ask the user **one** clarifying question
(2–4 options framed around concrete app surfaces, not generic phrasing).

### 1. Analyze what already exists (MCP tools — always do this first)

```
metrics_events_list   # already-registered events — reuse one that fits
metrics_list          # existing metrics — reuse one that already covers the ask
```

Always call **both** before creating, and reuse an existing event/metric when
one fits. This dedup check comes first because the MCP tools are always
available (a shell may be too).

Then, **when a shell is available**, deepen the analysis: find *uninstrumented*
candidates — places where a new `track(...)` call would naturally belong. (When
Bash is available, run the scan; otherwise pick a sensible event name straight
from the request.)

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

### 2. Decide: create autonomously, or ask when genuinely ambiguous

When the request clearly implies the action to measure (e.g. "how many checkouts
complete" → a `checkout_completed` event, `count_users`), **proceed to create**
(step 3/4) with the obvious event + aggregation, then report what you built and
offer to adjust. Reserve the clarifying question for when the analysis leaves the
event or aggregation genuinely open — then ask the user **one** question with
2–4 options. Each option label is the *event name + one-line behaviour*. Include
in the option description:

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

### 3. Instrument (only if a new event was chosen)

Edit one file. The tracking call below is the exact, version-correct form for
this project's SDK language — use it verbatim:

{{SDK_SNIPPET:metrics/track}}

Confirm every label referenced by the metric query — in filters, the
value position, `by (...)`, or `without (...)` — exists as a property
on this call.

### 4. Create the metric

```bash
shipeasy metrics create <name> --event-name <event_name> --query '<dsl>'
```

Optional knobs (winsorization, min detectable effect, direction, folder) and
all constraints are in `--help` / the `metrics_create` MCP schema — the API
validates them and returns instructive errors.

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

