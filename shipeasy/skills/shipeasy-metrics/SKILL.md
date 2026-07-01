---
name: shipeasy-metrics
description: Create and inspect Shipeasy custom event metrics (deletion is UI-only). Trigger on "create metric", "track metric", "metric DSL", "event metric", "success metric definition", "what metrics do we have".
user-invocable: true
---

# Shipeasy metrics

A **metric** is a named query over collected events. Metrics power
experiment success criteria and standalone dashboards. They are defined
by a lexical DSL that compiles to Analytics Engine SQL — Shipeasy
materialises results on the daily analysis cron, not on read.

**Prerequisites live in the `shipeasy-common` skill** — the MCP ⇄ CLI ⇄ API
surfaces (`metrics_*`, or `shipeasy metrics …`), updating on version drift, the
`.shipeasy` binding, and enabling via the flags install. Events (the data
metrics read) are enabled by `shipeasy install flags` (the
`shipeasy-flags-install` skill).

## Concepts

- **Event.** A named user action emitted via `flags.track(name, props)`.
  All metric data comes from events. Metrics over an event that is never
  emitted return zero.
- **Aggregation.** How rows roll up — counts, sums, averages, percentiles,
  retention. The full list ships with the DSL grammar: `shipeasy metrics
  grammar` / the `metrics_grammar` MCP tool.
- **Label.** A property on the event payload. Any label referenced in
  filters, value position, `by`, or `without` MUST exist on the event,
  otherwise the metric returns empty.

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

## Workflow — create a metric (analyze → propose → instrument → create)

When the user says *"create a metric for <X>"* (or anything semantically
equivalent — "track conversion on Y", "measure how often Z happens"),
**do not jump straight to `shipeasy metrics create`.** Run the full
analyze-and-suggest path below; the user almost never names the right
event up front.

### 0. Scope the metric

Read the user's request. Translate into one sentence of the form
*"count/sum/average of <what>, when <which user action> happens"*. If
you can't fill in the blanks, ask **one** clarifying `AskUserQuestion`
(2–4 options framed around concrete app surfaces, not generic phrasing).

### 1. Analyze the project for candidate events

Two parallel searches:

```bash
# (a) Already-instrumented events — zero new code if one fits.
grep -rnE 'flags\.track\(\s*["'"'"']' --include='*.ts' --include='*.tsx' \
  --include='*.js' --include='*.jsx' src apps packages 2>/dev/null | head -50

# (b) Existing metrics, in case the user really just wants a tweak.
shipeasy metrics list            # generated module commands print JSON
```

Then heuristically find *uninstrumented* candidates — places where a
new `flags.track(...)` call would naturally belong:

- Form submit handlers (`onSubmit`, `<form action=`).
- Click handlers on primary CTAs (`onClick` on buttons whose copy
  matches the user's intent: "Pay", "Sign up", "Add to cart", …).
- Route handlers / API endpoints that complete the action server-side.
- Existing analytics calls from other libraries (`posthog.capture`,
  `segment.track`, `gtag`, `mixpanel.track`) — mirror those.

For each candidate, capture `file:line` and the user-visible action.

### 2. Propose with AskUserQuestion

Use `AskUserQuestion` with 2–4 options. Each option label is the
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

### 3. Instrument (only if a new event was chosen)

Pull the `flags.track` call site for this project's language from the `docs`
surface (see `shipeasy-common` → "Pulling SDK call sites"):
`docs_get { sdk: <lang>, path: "metrics" }`. The snippet below is **shape only**.

Edit one file:

```ts
// Example shape — fetch the exact call for this project's language via docs_get
import { flags } from "@shipeasy/sdk/client"; // server: flags.track(userId, event, props)
flags.track("checkout_completed", { /* labels referenced by the query */ });
```

Confirm every label referenced by the metric query — in filters, the
value position, `by (...)`, or `without (...)` — exists as a property
on this call.

### 4. Create the metric

```bash
shipeasy metrics create <name> --event-name <event_name> --query '<dsl>'
```

Optional knobs (winsorization, min detectable effect, direction, folder) are in
`--help` / the `metrics_create` MCP schema. The one trap: the event inside
`--query` must equal `--event-name` — they reference the same source event.

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
"the user didn't ask for AskUserQuestion" is not a reason to skip it;
metrics over the wrong event are the most common avoidable mistake.

## Other operations

Listing, showing, and the DSL grammar run through the `metrics_list` /
`metrics_show` / `metrics_grammar` MCP tools or the `shipeasy metrics …` CLI
(see `shipeasy-common` → surfaces). Creating goes through `metrics_create` (plus
`metrics_events_create` to register a new event) — the analyze → propose →
instrument → create flow above is what this skill drives on an ask.

Deletion is **UI-only** (see `shipeasy-common`). The dashboard additionally refuses while
the metric is referenced by a running experiment — stop the experiment first.

## Relationship to experiments

A metric backs an experiment's `goal_metric` by name. Always
pre-register the metric before starting the experiment — adding metrics
post-hoc inflates the false-positive rate. See the `shipeasy-experiments`
skill for the experiment lifecycle.

