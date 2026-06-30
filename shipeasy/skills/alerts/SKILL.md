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

> **There are no per-verb `alerts` slash commands.** Create / list / update alert
> rules through the `shipeasy` MCP tools (`ops_alerts_create`, `ops_alerts_list`,
> `ops_alerts_update`) when the server is registered, or the `shipeasy ops alerts`
> CLI as the fallback. This is the same on every host.

## First fix: update before you debug

Most failures here — `unknown command`/`unknown option`, an unexpected
`400`/`404`, or something that worked before — are **version drift**: the CLI or
plugin is older than the feature. Update and retry once:

- **CLI:** `npm i -g @shipeasy/cli@latest` (or one-off `npx @shipeasy/cli@latest …`).
- **MCP server:** pinned to `@shipeasy/mcp@latest` — restart the session.

## Key constraint: the metric is immutable

A rule's metric pins **both** what is measured and how it is aggregated, so
neither can change after create. There is no way to repoint a rule at a
different metric — tune everything else with an update, or delete + recreate to
change the metric. Deletion is **UI-only** (no delete command ships).

Defaults: `--window-hours 24` (whole **hours**, 1–720), `--severity warn`, enabled.

## Create

1. Resolve the metric first if the user gave a name — confirm it exists and grab
   its id:
   ```bash
   shipeasy metrics list
   ```
2. Prefer the typed MCP tool when the server is registered (it resolves the
   metric by id or name and returns typed errors):
   ```
   mcp tool: ops_alerts_create {
     "name":         "<label>",
     "metricId":     "<metric id or name>",
     "comparator":   "gt" | "gte" | "lt" | "lte",
     "threshold":    <number>,
     "windowHours":  <1–720>,                     // optional, default 24
     "severity":     "danger" | "warn" | "info",  // optional, default warn
     "enabled":      true | false,                // optional, default true
     "notify":       <Slack/email target>         // optional; null → project default
   }
   ```
3. Otherwise the CLI (`--metric-id` accepts a metric id or name):
   ```bash
   shipeasy ops alerts create \
     --name "<label>" --metric-id <id|name> --comparator gt --threshold 50 \
     --window-hours 24 --severity warn
   ```

Sub-hour windows are not representable. If the user asks for "last 30 minutes",
use `--window-hours 1` and call out the rounding.

## List

```
mcp tool: ops_alerts_list
```
or `shipeasy ops alerts list [--json]`. Fields: `id`, `name`, `metricId`,
`metricName`, `comparator`, `threshold`, `windowHours`, `severity`, `enabled`,
`createdAt`, `updatedAt`. The `id` (unique id-prefix, or unique `name`) is what
update takes. These are rule *definitions* — for alerts they have *raised*, use
the `ops` skill (`ops_list` MCP tool / `shipeasy ops` CLI, `--type alert`).

## Update

`ops_alerts_update { "id": "<id|prefix|name>", … }` or
`shipeasy ops alerts update <id> [--threshold] [--comparator] [--window-hours]
[--severity] [--name] [--enabled true|false] [--notify]`. There is **no
`--metric-id` flag** (immutable). `--enabled false` pauses evaluation without
deleting.

## When to use this skill

- "Alert me when API errors exceed 50 over the last hour."
- "Raise a warning if checkout conversion drops below 2%."
- "List / retune / pause our alert rules."

For the alerts those rules *raise* (triaging, working them), use the `ops`
skill. For the metrics the rules read, use the `metrics` skill.

## Errors → action

| Error                         | Action                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `403 module not enabled`      | Run `shipeasy install flags` (enables events/metrics; in Claude Code, `/shipeasy:flags:install`). |
| `404 metric not found`        | Check the id/name with `shipeasy metrics list`.                                     |
| `400` on `--metric-id` update | The metric is immutable — delete + recreate the rule.                               |
| `401`                         | Re-run `shipeasy login`.                                                            |
