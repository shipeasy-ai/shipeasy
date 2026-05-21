---
name: metrics
description: Create, inspect, and delete Shipeasy custom event metrics. Trigger on "create metric", "track metric", "metric DSL", "event metric", "success metric definition", "what metrics do we have".
user-invocable: true
---

# Shipeasy metrics

A **metric** is a named query over collected events. Metrics power
experiment success criteria and standalone dashboards. They are defined
by a lexical DSL that compiles to Analytics Engine SQL — Shipeasy
materialises results on the daily analysis cron, not on read.

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

## Workflow — create a metric

1. **Confirm the event is emitted.** Grep the app code for
   `events.track("<event>"`. If absent, instrument it first — a metric
   over a never-emitted event is silent and useless.

2. **Confirm referenced labels exist on the event payload.** If the
   query mentions `country` but `events.track("purchase", { amount })`
   omits `country`, the metric will be empty. Add it to the track call.

3. **Create:**

   ```bash
   shipeasy metrics create <name> \
     --event <event_name> \
     --query '<dsl>' \
     [--folder <folder>] \
     [--winsorize <pct>]   # default 99
     [--mde <0..1>]        # min detectable effect for power calcs
   ```

   The CLI enforces that the event inside `--query` equals `--event` —
   they reference the same source event.

4. **Verify:** `shipeasy metrics list` → the new row appears with the
   rendered query.

## Other operations

```bash
shipeasy metrics list             # all metrics
shipeasy metrics show <id>        # one metric
shipeasy metrics grammar          # DSL reference
shipeasy metrics delete <id>      # soft-delete (rejected while referenced by a running experiment)
```

Slash equivalents:

```
/shipeasy:metric:create <name> --event <event> --query '<dsl>'
/shipeasy:metric:list
/shipeasy:metric:show <id>
/shipeasy:metric:delete <id>
/shipeasy:metric:grammar
```

## Relationship to experiments

A metric becomes an experiment's `success_metric` by name. Always
pre-register the metric before starting the experiment — adding metrics
post-hoc inflates the false-positive rate. See the `experiments` skill
for the experiment lifecycle.

## Knobs

- `--winsorize <pct>` clips outliers at the Nth percentile before
  aggregating. Default `99`. Lower it (e.g. `95`) for heavy-tailed
  metrics like revenue.
- `--mde <0..1>` is the smallest effect size you want the experiment to
  detect. Used by the analysis pipeline for power / sample-size calcs.
- `--folder <name>` groups metrics in the dashboard. No semantic effect.

## API

`POST /api/admin/metrics` accepts either `query` (DSL string) or
`query_ir` (typed IR JSON).
