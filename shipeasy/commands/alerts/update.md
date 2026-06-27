---
name: alerts-update
description: Update an alert rule's threshold, comparator, window, severity, name, or enabled flag (metric is immutable)
argument-hint: "<id> [--threshold <n>] [--comparator gt|gte|lt|lte] [--window <hours>] [--severity danger|warn|info] [--name <s>] [--enabled true|false]"
user-invocable: true
---

Tune an existing **alert rule**. The first argument is the rule `id`, a unique
id-prefix, or a unique `name` (run `/shipeasy:alerts:list` to find it).

**The metric is immutable.** A rule's metric pins both *what* is measured and
*how* it's aggregated, so neither can be changed after create — there is no
`--metric` flag here, and the backend rejects any attempt. To point an alert at
a different metric, `/shipeasy:alerts:delete` it and create a new one.

Everything else is tunable: `--threshold`, `--comparator`, `--window` (whole
hours, 1–720), `--severity`, `--name`, and `--enabled true|false` (to
pause/resume evaluation without deleting).

Steps:

1. If MCP is registered, prefer the typed tool:
   ```
   mcp tool: ops_alerts_update {
     "id":          "<id | id-prefix | name>",
     "threshold":   <number>,        // any subset of these
     "comparator":  "gt" | "gte" | "lt" | "lte",
     "window_hours": <1–720>,
     "severity":    "danger" | "warn" | "info",
     "name":        "<label>",
     "enabled":     true | false
   }
   ```

2. Otherwise use the CLI (pass only the fields you're changing):
   ```bash
   shipeasy alert-rules update <id> --threshold 5 --severity danger
   shipeasy alert-rules update <id> --enabled false   # pause it
   ```

3. Confirm:
   ```bash
   shipeasy alert-rules list
   ```
