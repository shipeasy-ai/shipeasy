---
name: ops-list
description: List operational items — bug reports, feature requests, tracked production errors, or active alerts — with a --type filter
argument-hint: "[--type bug|feature|error|alert|all] [--status <s>] [--priority high|critical|medium|nice_to_have] [--name-contains <s>]"
user-invocable: true
---

Read view over the bound project's operational inbox — the unified `feedback`
queue, which holds all four item types. One command, one table:

```bash
shipeasy ops.list --type <bug|feature_request|error|alert|all> --status <status|all> [--priority <p>] [--json]
```

`ops.list` defaults to `--type all --status open`, sorted `priority desc` then
oldest-first. `error`/`alert` rows are the **tickets** the platform auto-files
(an `error` ticket when a tracked error crosses the occurrence threshold; an
`alert` ticket when an alert triggers) — never filed by hand. **Use the CLI for
everything here — never `curl` the admin API.**

## Steps

1. Parse `$ARGUMENTS` for `--type` (default `all`), `--status`, `--priority`,
   `--name-contains`. Pull the queue:

   ```bash
   shipeasy ops.list --type "${TYPE:-all}" --status "${STATUS:-open}" --json > /tmp/se-ops.json
   ```

   `--type`, `--status`, and `--priority` are native flags; `--name-contains`
   filters client-side. Drop `--json` for the built-in table.

2. If `--name-contains` was passed, filter `title` client-side, then print a
   compact table (`#number  priority  status  type  title`).

## Raw sources (for diagnosis while triaging)

The tickets above are the work queue. The underlying raw records are still
readable when you need deeper detail on an `error` or `alert`:

| source  | CLI                          | what it is                                |
| ------- | ---------------------------- | ----------------------------------------- |
| errors  | `shipeasy ops.errors list`   | see()-tracked production errors (id/count/fingerprint/status) |
| alerts  | `shipeasy alerts list`       | active metric-threshold / built-in alerts |

Errors support one write — `shipeasy ops.errors update <id> --status
<open|resolved|ignored>`; a resolved error reopens automatically if it recurs.
Raw alerts are read-only (they auto-resolve when the condition clears).

To process the whole queue end-to-end (investigate + fix + resolve + link the
PR), use `/shipeasy:ops:work`. To file a new bug or feature, use
`/shipeasy:ops:report`.
