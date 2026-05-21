---
description: Start a Shipeasy A/B experiment (draft → running)
argument-hint: "<name>"
---

Start a draft experiment so it begins assigning traffic. Follow the
`experiments` skill.

```
mcp tool: exp_start_experiment { "name": "<name>" }
```

CLI fallback: `shipeasy experiments start <name>`.

Once running, the experiment is immutable — groups, allocation, and
success metric cannot change. To modify, stop and recreate under a new
name (the assignment hash changes; never reuse the old name).
