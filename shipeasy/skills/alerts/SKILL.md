---
name: alerts
description: Create and manage Shipeasy metric-threshold alert rules — the definitions the analysis cron evaluates to raise an alert when a metric crosses a threshold. Trigger on "alert rule", "alert me when", "metric threshold", "raise an alert", "notify when <metric> exceeds", "create/update/list alert rules", "alerting".
user-invocable: true
---

# Shipeasy alert rules

An **alert rule** is a metric-threshold definition. The analysis cron evaluates
it on a schedule: when `agg(metric)` over the trailing window satisfies
`value <comparator> threshold`, it raises an alert at the rule's severity. The
raised alerts then surface in the operational inbox (see the `ops` skill —
`/shipeasy:ops:list --type alert`).

Alert *rules* are **writable** here. The *raised alerts* themselves are
read-only and belong to `ops`. Alert rules ride the flags platform install
(`/shipeasy:flags:install`) and sit on top of the `events` + `metrics` you
already defined.

> **On Claude Code** the verbs below are slash commands
> (`/shipeasy:alerts:create`, `:list`, `:update`). On every other host they
> arrive as the mirrored `alerts-*` skills (installed with the `--full-depth`
> skills-CLI flag — see the `setup` skill) and the `shipeasy` MCP tools.

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

Defaults: `--window 24` (whole **hours**, 1–720), `--severity warn`, enabled.

## Create

1. Resolve the metric first if the user gave a name — confirm it exists and grab
   its id:
   ```bash
   shipeasy metrics list
   ```
2. Prefer the typed MCP tool when the server is registered (it resolves the
   metric by id or name and returns typed errors):
   ```
   mcp tool: exp_create_alert_rule {
     "name":         "<label>",
     "metric":       "<metric id or name>",
     "comparator":   "gt" | "gte" | "lt" | "lte",
     "threshold":    <number>,
     "window_hours": <1–720>,                     // optional, default 24
     "severity":     "danger" | "warn" | "info",  // optional, default warn
     "enabled":      true | false                 // optional, default true
   }
   ```
3. Otherwise the CLI (`--metric` accepts a metric id or name):
   ```bash
   shipeasy alert-rules create "<label>" \
     --metric <id|name> --comparator gt --threshold 50 \
     --window 24 --severity warn
   ```

Sub-hour windows are not representable. If the user asks for "last 30 minutes",
use `--window 1` and call out the rounding.

## List

```
mcp tool: list_resources { "kind": "alert_rules" }
```
or `shipeasy alert-rules list [--json]`. Fields: `id`, `name`, `metricId`,
`metricName`, `comparator`, `threshold`, `windowHours`, `severity`, `enabled`,
`createdAt`, `updatedAt`. The `id` (unique id-prefix, or unique `name`) is what
update takes. These are rule *definitions* — for alerts they have *raised*, use
the `ops` skill (`/shipeasy:ops:list --type alert`).

## Update

`exp_update_alert_rule { "id": "<id|prefix|name>", … }` or
`shipeasy alert-rules update <id> [--threshold] [--comparator] [--window]
[--severity] [--name] [--enabled true|false]`. There is **no `--metric` flag**
(immutable). `--enabled false` pauses evaluation without deleting.

## When to use this skill

- "Alert me when API errors exceed 50 over the last hour."
- "Raise a warning if checkout conversion drops below 2%."
- "List / retune / pause our alert rules."

For the alerts those rules *raise* (triaging, working them), use the `ops`
skill. For the metrics the rules read, use the `metrics` skill.

## Errors → action

| Error                      | Action                                                   |
| -------------------------- | -------------------------------------------------------- |
| `403 module not enabled`   | Run `/shipeasy:flags:install` (enables events/metrics).  |
| `404 metric not found`     | Check the id/name with `shipeasy metrics list`.          |
| `400` on `--metric` update | The metric is immutable — delete + recreate the rule.    |
| `401`                      | Re-run `shipeasy login`.                                 |
