---
description: Create or check the status of a Shipeasy A/B experiment
argument-hint: "<name> [start|status|stop]"
---

Manage a Shipeasy experiment. Follow the `shipeasy-experiments` skill.

Parse `$ARGUMENTS` as `<name> [action]`. Default action: `status` if the
experiment exists, otherwise prompt the user for the design (groups,
allocation, success metric) and create a draft.

Required design decisions before creating:

1. **Universe** — reuse `default` unless mutual exclusion with an existing
   experiment is needed.
2. **Groups** — at least `control` + one variant. Allocations sum to 100.
3. **Success metric** — pre-register one. Don't add metrics post-hoc.
   Metrics are defined by a lexical DSL query, e.g.
   `count_users(checkout_completed)` or `sum(purchase, amount)`. See
   `shipeasy metrics grammar` for full syntax.

Commands:

```
mcp tool: exp_create_experiment   { ... }
mcp tool: exp_start_experiment    { "name": "<name>" }
mcp tool: exp_experiment_status   { "name": "<name>" }
mcp tool: exp_stop_experiment     { "name": "<name>", "winner": "treatment" | "control" | null }
```

When stopping, refuse to relaunch under the same name — the assignment hash
changes and re-randomizes existing users. Suggest a new name (`<old>_v2`).
