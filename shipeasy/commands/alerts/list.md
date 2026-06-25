---
name: alerts-list
description: List the project's metric-threshold alert rules (id, metric, condition, window, severity, on/off)
argument-hint: "[--json]"
user-invocable: true
---

Tabular or JSON list of every **alert rule** in the bound project. These are the
rule *definitions* — for the alerts they have *raised*, use
`/shipeasy:ops:list --type alert`.

Steps:

1. If MCP is registered, list via the unified resource lister:
   ```
   mcp tool: list_resources { "kind": "alert_rules" }
   ```

2. Otherwise use the CLI:
   ```bash
   shipeasy alert-rules list          # table
   shipeasy alert-rules list --json   # raw rows
   ```

3. Print the rows. Field reference: `id`, `name`, `metricId`, `metricName`,
   `comparator` (gt|gte|lt|lte), `threshold`, `windowHours`, `severity`
   (danger|warn|info), `enabled`, `createdAt`, `updatedAt`.

The `id` (or a unique id-prefix, or a unique `name`) is what
`/shipeasy:alerts:update` and `/shipeasy:alerts:delete` take.
