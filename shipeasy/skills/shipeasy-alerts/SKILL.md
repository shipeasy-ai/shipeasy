---
name: shipeasy-alerts
description: Create and manage Shipeasy metric-threshold alert rules — the definitions the analysis cron evaluates to raise an alert when a metric crosses a threshold. Trigger on "alert rule", "alert me when", "ping me when/if <metric>", "metric threshold", "raise an alert", "notify when <metric> exceeds", "create/update/list alert rules", "mute/pause/snooze an alert", "disable/enable an alert", "change/bump/retune an alert threshold", "what alerts do we have", "alerting".
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

An alert watches a metric, and a metric rolls up an event — so build the whole
chain when a piece is missing, and carry through to the alert. A "ping me when
X exceeds Y" ask is a request to create the rule, so follow the flow to the
final `ops_alerts_create` call:

1. **Analyze the metric.** `metrics_events_list` + `metrics_list` (the tool
   accepts a metric id **or** name). When a fitting metric already exists, reuse
   it. When it's missing, build it first: `metrics_events_create` for the event
   (e.g. a `checkout_error` event) and `metrics_create` for the metric (e.g. an
   error-rate metric) — see the `shipeasy-metrics` skill for the DSL.
2. **Analyze existing rules.** `ops_alerts_list` — reuse or retune a rule that
   already watches this metric+threshold when one is found.
3. **Create the rule.** `ops_alerts_create { name, metricId, comparator,
   threshold, … }` (or `shipeasy ops alerts create --name … --metric-id <id|name>
   --comparator gt --threshold 50`). This call is the culmination of the ask.

## Pause, retune, or change a rule

Alerts are referenced by name, so resolve the id first, then apply the change —
both steps run every time, because the list gives the update its `id`:

1. **Find it.** `ops_alerts_list` (or `shipeasy ops alerts list`) returns the
   rule *definitions*; match the user's name and read its `id`.
2. **Apply the change** with `ops_alerts_update { "id": …, … }`:
   - **Pause / mute / snooze** → `enabled: false` (evaluation stops, the rule
     stays; `enabled: true` re-enables it).
   - **Retune / bump the threshold** → `threshold: <new>` on the same rule.

A "mute the X alert" or "bump the X alert to Y" ask always ends in an
`ops_alerts_update` call on the id the list resolved.

For the alerts these rules have *raised* (triaging, working them), use the
`shipeasy-ops` skill (`ops_list` / `shipeasy ops`, `--type alert`).

## When to use this skill

- "Alert me when API errors exceed 50 over the last hour."
- "Raise a warning if checkout conversion drops below 2%."
- "List / retune / pause our alert rules."

For the alerts those rules *raise* (triaging, working them), use the
`shipeasy-ops` skill. For the metrics the rules read, use the
`shipeasy-metrics` skill.
