---
name: experiments-archive
description: Archive a stopped Shipeasy experiment (hides from default list, preserves results)
argument-hint: "<name>"
user-invocable: true
---

Archive a stopped experiment. Archiving moves the experiment out of the
default `list`/dashboard views while preserving its results and
assignment history. The transition is `stopped → archived`. The
experiment must already be stopped — call `/shipeasy:experiments:stop`
first if it's still running.

Prefer `archive` over `delete` for completed experiments: archive keeps
the record (winner, p-value, enrolled counts) auditable; delete erases
it.

```bash
shipeasy release experiments archive <name>
```

(No MCP tool — CLI only.)

Rules:

- Refuses on `draft` or `running` experiments.
- Archived experiments cannot be restarted — same naming rule as
  `stop`: never reuse the name for a new experiment (assignment hash
  changes, users re-randomise). Use `<old>_v2`.
