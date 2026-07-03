---
name: shipeasy-alerts
description: Create and manage Shipeasy metric-threshold alert rules — the definitions the analysis cron evaluates to raise an alert when a metric crosses a threshold. Trigger on "alert rule", "alert me when", "metric threshold", "raise an alert", "notify when <metric> exceeds", "create/update/list alert rules", "alerting".
user-invocable: true
---

# Shipeasy alert rules

An **alert rule** is a metric-threshold definition. The analysis cron evaluates
it on a schedule: when `agg(metric)` over the trailing window satisfies
`value <comparator> threshold`, it raises an alert at the rule's severity. The
raised alerts then surface in the operational inbox (see the `shipeasy-ops` skill — list
them with the `ops_list` MCP tool / `shipeasy ops` CLI, `--type alert`).

Alert *rules* are **writable** here. The *raised alerts* themselves are
read-only and belong to `shipeasy-ops`. Alert rules ride the flags platform
install (`shipeasy install flags` or `shipeasy setup`) and sit on top of the
`events` + `metrics` you already defined.

Create / list / update alert rules through the `ops_alerts_create` /
`ops_alerts_list` / `ops_alerts_update` MCP tools or the `shipeasy ops alerts …`
CLI (same on every host). Prerequisites: a `.shipeasy` binding and the flags
platform install above. Parameter shapes, defaults, ranges, and constraints
(e.g. which fields are immutable) live in the tool schema / `--help` and the API
docs — the API enforces them and returns instructive errors, so don't restate
them from memory.

## Create

1. Resolve the metric first if the user gave a name — `shipeasy metrics list`
   to confirm it exists (the tool accepts a metric id **or** name). If the metric
   (or its underlying event) doesn't exist yet, create those first.
2. **List existing alert rules** with `ops_alerts_list` and check none already
   watches this metric+threshold — reuse or update it instead of creating a
   duplicate.
3. Only if nothing matches, call `ops_alerts_create { name, metricId, comparator,
   threshold, … }` (or `shipeasy ops alerts create --name … --metric-id <id|name>
   --comparator gt --threshold 50`).

## List & update

`ops_alerts_list` (or `shipeasy ops alerts list`) returns the rule
*definitions*; the `id` (unique id-prefix or unique `name`) is what update takes.
For the alerts these rules have *raised*, use the `shipeasy-ops` skill (`ops_list` /
`shipeasy ops`, `--type alert`).

`ops_alerts_update { "id": …, … }` retunes a rule; `enabled: false` pauses
evaluation without deleting.

## When to use this skill

- "Alert me when API errors exceed 50 over the last hour."
- "Raise a warning if checkout conversion drops below 2%."
- "List / retune / pause our alert rules."

For the alerts those rules *raise* (triaging, working them), use the
`shipeasy-ops` skill. For the metrics the rules read, use the
`shipeasy-metrics` skill.
