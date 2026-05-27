---
description: Delete a Shipeasy experiment (prefer archive for completed experiments)
argument-hint: "<name>"
---

Delete an experiment by name. Use this for **draft** experiments
that were misconfigured and won't run. For completed (`stopped`)
experiments, prefer `/shipeasy:experiments:archive` — it preserves the
result record.

```
mcp tool: exp_delete_experiment { "name": "<name>" }
```

CLI fallback: `shipeasy experiments delete <name>`.

Rules:

- Don't delete a `running` experiment to "abort" it. Stop it
  (`/shipeasy:experiments:stop <name> --winner null`) so assignments
  freeze cleanly and the audit trail records *why* the test ended.
- Never reuse a deleted experiment's name for a new one — the
  assignment hash changes, so users previously enrolled re-randomise.
  Use `<old>_v2`.
