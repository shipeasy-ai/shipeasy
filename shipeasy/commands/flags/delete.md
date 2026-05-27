---
description: Delete a Shipeasy feature gate (refuses if referenced by a running experiment)
argument-hint: "<gate-name>"
---

Delete a feature gate. The admin API **refuses** if any running
experiment references the gate as its `targeting_gate` — stop or
retarget the experiment first.

Before deleting, check the gate isn't still wired into code:

```bash
rg -n 'gates\.check\(["'\'']<name>["'\'']' .
```

If call sites still exist, remove them first or flip the gate to
disabled (`shipeasy flags disable <name>`) instead — deletion makes
`gates.check` return the SDK-side default permanently.

Then delete:

```
mcp tool: exp_delete_gate { "name": "<name>" }
```

CLI fallback: `shipeasy flags delete <name>`.

Rules:

- Don't delete a gate just to "clean up" if its name is still in code —
  the next `gates.check` call silently flips to the default value.
- Don't reuse a deleted gate's name for a *new* feature gate — the
  assignment hash changes, so users previously in the rollout
  re-randomise.
