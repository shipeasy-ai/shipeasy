---
name: alerts-create
description: Create a metric-threshold alert rule (the cron raises an alert when the metric crosses the threshold)
argument-hint: "<name> --metric <id|name> --comparator gt|gte|lt|lte --threshold <n> [--window <hours>] [--severity danger|warn|info] [--disabled]"
user-invocable: true
---

Create an **alert rule** — a metric-threshold definition the analysis cron
evaluates on a schedule. When `agg(metric)` over the trailing window satisfies
`value <comparator> threshold`, an alert is raised at the given severity (it
then shows up under `/shipeasy:ops:list --type alert`).

Alert rules are part of the **flags platform** (`/shipeasy:flags:install`) — they
sit on top of the `events` + `metrics` you already defined. They are writable;
the *raised* alerts themselves are read-only (`/shipeasy:ops`).

Key constraint: **a rule's metric is fixed for its life.** The metric also pins
the aggregation, so there is no way to change either after create — use
`/shipeasy:alerts:update` for the threshold/comparator/window/severity/name, or
delete + recreate to repoint at a different metric.

Defaults: `--window 24` (whole hours, 1–720), `--severity warn`, enabled.

Steps:

1. Resolve the metric first if the user gave a name — list to confirm it exists
   and grab its id:
   ```bash
   shipeasy metrics list
   ```

2. If MCP is registered, prefer the typed tool (resolves the metric by id or
   name for you and returns typed errors):
   ```
   mcp tool: ops_alerts_create {
     "name":        "<label>",
     "metric":      "<metric id or name>",
     "comparator":  "gt" | "gte" | "lt" | "lte",
     "threshold":   <number>,
     "window_hours": <1–720>,        // optional, default 24
     "severity":    "danger" | "warn" | "info",   // optional, default warn
     "enabled":     true | false      // optional, default true
   }
   ```

3. Otherwise use the CLI (`--metric` accepts a metric id or name):
   ```bash
   shipeasy alert-rules create "<label>" \
     --metric <id|name> --comparator gt --threshold 0 \
     --window 24 --severity warn
   ```

4. Confirm it landed:
   ```bash
   shipeasy alert-rules list
   ```

Note: the window is whole **hours** (minimum 1) — sub-hour windows are not
representable. If the user asks for "last 30 minutes", use `--window 1` and call
out the rounding.
