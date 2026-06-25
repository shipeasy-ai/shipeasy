---
name: experiments-stop
description: Stop a Shipeasy experiment and record the winner
argument-hint: "<name> [--winner treatment|control|null]"
user-invocable: true
---

Stop a running experiment. Freezes assignment and writes the final
result. Follow the `experiments` skill.

```
mcp tool: exp_stop_experiment { "name": "<name>", "winner": "treatment" | "control" | null }
```

CLI fallback: `shipeasy experiments stop <name>`.

When stopping, refuse to relaunch under the same name — the assignment
hash changes and re-randomizes existing users. Suggest a new name
(`<old>_v2`).
