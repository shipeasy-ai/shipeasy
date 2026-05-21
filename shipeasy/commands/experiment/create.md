---
description: Create a Shipeasy A/B experiment (draft state)
argument-hint: "<name>"
---

Create a draft experiment. Follow the `experiments` skill.

Required design decisions before creating:

1. **Universe** — reuse `default` unless mutual exclusion with an
   existing experiment is needed.
2. **Groups** — at least `control` + one variant. Allocations sum to 100.
3. **Success metric** — pre-register one. Don't add metrics post-hoc.
   Metrics are defined by a lexical DSL query, e.g.
   `count_users(checkout_completed)` or `sum(purchase, amount)`. See
   `/shipeasy:metric:grammar` or run `shipeasy metrics grammar` for full
   syntax. Create the metric with `/shipeasy:metric:create` first.

Create:

```
mcp tool: exp_create_experiment {
  "name": "<name>",
  "universe": "default",
  "groups": [
    { "name": "control",   "allocation": 50, "params": { "variant": "v1" } },
    { "name": "treatment", "allocation": 50, "params": { "variant": "v2" } }
  ],
  "success_metric": "<metric_name>"
}
```

CLI fallback: `shipeasy experiments create --help`.

Draft experiments do not assign traffic. Start with
`/shipeasy:experiment:start <name>` when ready.
