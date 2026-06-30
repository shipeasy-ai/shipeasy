---
name: metrics
description: Create and inspect Shipeasy custom event metrics (deletion is UI-only). Trigger on "create metric", "track metric", "metric DSL", "event metric", "success metric definition", "what metrics do we have".
user-invocable: true
---

# Shipeasy metrics

A **metric** is a named query over collected events. Metrics power
experiment success criteria and standalone dashboards. They are defined
by a lexical DSL that compiles to Analytics Engine SQL — Shipeasy
materialises results on the daily analysis cron, not on read.

## First fix: update before you debug

Most failures here — `unknown command` / `unknown option`, a missing
subcommand, an unexpected `400`/`404`, or something that worked before — are
**version drift**: the CLI or plugin is older than the feature being invoked.
Before deeper debugging, update to latest and retry once:

- **CLI:** `npm i -g @shipeasy/cli@latest` (or one-off: `npx @shipeasy/cli@latest <cmd>`).
- **MCP server:** pinned to `@shipeasy/mcp@latest` — restart the session to
  pick up a new release.
- **In Claude Code only:** also refresh the plugin — `/plugin marketplace update
  shipeasy` then `/plugin install shipeasy@shipeasy` (or enable auto-update on the
  `shipeasy` marketplace via `/plugin`).

Only treat it as a real bug if it still fails on the latest CLI **and** MCP.

## Concepts

- **Event.** A named user action emitted via `events.track(name, props)`.
  All metric data comes from events. Metrics over an event that is never
  emitted return zero.
- **Aggregation.** How rows roll up — `count_users`, `count`, `sum`,
  `avg`, `min`, `max`, `unique`, `p50`/`p75`/`p90`/`p95`/`p99`/`p999`,
  `retention_<N>d`.
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
count(checkout_completed{country="US"})
sum(purchase, amount)
sum(purchase{plan!="free"}, amount) by (country)
avg(req_dur{tier!="free"}, ms) without (region)
p99(req_dur{route=~"/api/.*"}, ms) by (route, status)
retention_7d(session_start)
```

Run `shipeasy metrics grammar` for the full BNF.

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
grep -rnE 'events\.track\(\s*["'"'"']' --include='*.ts' --include='*.tsx' \
  --include='*.js' --include='*.jsx' src apps packages 2>/dev/null | head -50

# (b) Existing metrics, in case the user really just wants a tweak.
shipeasy metrics list            # generated module commands print JSON
```

Then heuristically find *uninstrumented* candidates — places where a
new `events.track(...)` call would naturally belong:

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
`events.track(...)` payload (the labels you'll need for filters /
`by (...)` / value position).

### 3. Instrument (only if a new event was chosen)

**Pull the `events.track` call site for this project's SDK language from the
`docs` MCP.** Detect the language from `.shipeasy` or the subproject's manifest
(`package.json`, `pyproject.toml`, `Gemfile`, `go.mod`, `pom.xml`,
`build.gradle*`, `composer.json`, `Package.swift`), then fetch the snippet:
`docs_get { sdk: <lang>, path: "metrics" }` (run `docs_list { sdk: <lang> }` to
find the handle; CLI `shipeasy docs get --sdk <lang> metrics`). The example below
shows the shape — use the docs snippet for the exact call.

Edit one file:

```ts
// Example shape — fetch the exact call for this project's language via docs_get
import { events } from "@shipeasy/sdk/client"; // or "@shipeasy/sdk/server"
events.track("<event>", { /* labels referenced by the query */ });
```

Confirm every label referenced by the metric query — in filters, the
value position, `by (...)`, or `without (...)` — exists as a property
on this call.

### 4. Create the metric

```bash
shipeasy metrics create <name> \
  --event-name <event_name> \
  --query '<dsl>' \
  [--folder <folder>] \
  [--winsorize-pct <pct>]            # default 99
  [--min-detectable-effect <0..1>]   # min detectable effect for power calcs
  [--direction <higher_better|lower_better|neutral>]
```

The CLI enforces that the event inside `--query` equals `--event-name` —
they reference the same source event.

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

## Legacy quick reference

1. **Confirm the event is emitted.** Grep the app code for
   `events.track("<event>"`. If absent, instrument it first — a metric
   over a never-emitted event is silent and useless.

2. **Confirm referenced labels exist on the event payload.** If the
   query mentions `country` but `events.track("purchase", { amount })`
   omits `country`, the metric will be empty. Add it to the track call.

3. **Create:**

   ```bash
   shipeasy metrics create <name> \
     --event-name <event_name> \
     --query '<dsl>' \
     [--folder <folder>] \
     [--winsorize-pct <pct>]            # default 99
     [--min-detectable-effect <0..1>]   # min detectable effect for power calcs
   ```

   The CLI enforces that the event inside `--query` equals `--event-name` —
   they reference the same source event.

4. **Verify:** `shipeasy metrics list` → the new row appears with the
   rendered query.

## Other operations — MCP server or CLI

Listing, showing, and the DSL grammar have **no per-verb slash command** — use
the MCP tools (`metrics_list`, `metrics_show`, `metrics_grammar`) when the
`shipeasy` MCP server is registered, or the CLI as the fallback:

```bash
shipeasy metrics list             # all metrics
shipeasy metrics show <id>        # one metric
shipeasy metrics grammar          # DSL reference
```

Deleting a metric is **UI-only** — remove it from the dashboard (there is no
delete tool or command). The dashboard refuses while the metric is referenced by
a running experiment; stop the experiment first.

The analyze → propose → instrument → create flow documented above runs through
the `metrics_create` MCP tool (plus `metrics_events_create` to register a new
event) or `shipeasy metrics create`. In Claude Code it's the workflow this
`metrics` skill drives when you ask to create a metric; the MCP/CLI path is the
harness-agnostic equivalent.

## Relationship to experiments

A metric backs an experiment's `goal_metric` by name. Always
pre-register the metric before starting the experiment — adding metrics
post-hoc inflates the false-positive rate. See the `experiments` skill
for the experiment lifecycle.

## Knobs

- `--winsorize-pct <pct>` clips outliers at the Nth percentile before
  aggregating. Default `99`. Lower it (e.g. `95`) for heavy-tailed
  metrics like revenue.
- `--min-detectable-effect <0..1>` is the smallest effect size you want the
  experiment to detect. Used by the analysis pipeline for power / sample-size calcs.
- `--direction <higher_better|lower_better|neutral>` declares the desired
  direction of movement (`higher_better` default; `neutral` = guardrail).
- `--folder <name>` groups metrics in the dashboard. No semantic effect.

## API

`POST /api/admin/metrics` accepts either `query` (DSL string) or
`query_ir` (typed IR JSON).
