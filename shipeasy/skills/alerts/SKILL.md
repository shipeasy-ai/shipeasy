---
name: alerts
description: Create and manage Shipeasy metric-threshold alert rules — the definitions the analysis cron evaluates to raise an alert when a metric crosses a threshold. Trigger on "alert rule", "alert me when", "metric threshold", "raise an alert", "notify when <metric> exceeds", "create/update/list alert rules", "alerting".
user-invocable: true
---

# Shipeasy alert rules

An **alert rule** is a metric-threshold definition. The analysis cron evaluates
it on a schedule: when `agg(metric)` over the trailing window satisfies
`value <comparator> threshold`, it raises an alert at the rule's severity. The
raised alerts then surface in the operational inbox (see the `ops` skill — list
them with the `ops_list` MCP tool / `shipeasy ops` CLI, `--type alert`).

Alert *rules* are **writable** here. The *raised alerts* themselves are
read-only and belong to `ops`. Alert rules ride the flags platform install
(`shipeasy install flags`; in Claude Code, `/shipeasy:flags:install`) and sit on
top of the `events` + `metrics` you already defined.

**Prerequisites live in the `common` skill.** Create / list / update alert rules
through the `ops_alerts_create` / `ops_alerts_list` / `ops_alerts_update` MCP
tools or the `shipeasy ops alerts …` CLI (same on every host; see `common` →
surfaces). Read parameter shapes from the tool (`--help` / MCP schema).

## Key constraint: the metric is immutable

A rule's metric pins **both** what is measured and how it is aggregated, so
neither can change after create. There is no way to repoint a rule at a
different metric — tune everything else with an update, or delete + recreate to
change the metric. Deletion is **UI-only** (no delete command ships).

Defaults (from the tool): `windowHours` 24 (whole hours, 1–720), `severity`
warn, enabled. See the tool schema / `--help` for the full param list.

## Create

1. Resolve the metric first if the user gave a name — `shipeasy metrics list`
   to confirm it exists (the tool accepts a metric id **or** name).
2. Call `ops_alerts_create { name, metricId, comparator, threshold, … }` (or
   `shipeasy ops alerts create --name … --metric-id <id|name> --comparator gt
   --threshold 50`).

Gotcha: **sub-hour windows aren't representable.** If the user asks for "last 30
minutes", use `windowHours: 1` and call out the rounding.

## List & update

`ops_alerts_list` (or `shipeasy ops alerts list [--json]`) returns the rule
*definitions*; the `id` (unique id-prefix or unique `name`) is what update takes.
For the alerts these rules have *raised*, use the `ops` skill (`ops_list` /
`shipeasy ops`, `--type alert`).

`ops_alerts_update { "id": …, … }` retunes threshold / comparator / window /
severity / name / enabled. There is **no `--metric-id`** (immutable);
`enabled: false` pauses evaluation without deleting.

## When to use this skill

- "Alert me when API errors exceed 50 over the last hour."
- "Raise a warning if checkout conversion drops below 2%."
- "List / retune / pause our alert rules."

For the alerts those rules *raise* (triaging, working them), use the `ops`
skill. For the metrics the rules read, use the `metrics` skill.
