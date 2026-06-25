---
name: experiments-status
description: Show enrolment + significance state for a Shipeasy experiment
argument-hint: "<name>"
user-invocable: true
---

Show experiment status. Follow the `experiments` skill.

```
mcp tool: exp_experiment_status { "name": "<name>" }
```

CLI fallback: `shipeasy experiments status <name>`.

Returns: enrolled count per group, current p-value, whether the metric
has reached significance at the configured alpha, and a recommendation
(`keep_running`, `ship_treatment`, `ship_control`, `inconclusive`).
