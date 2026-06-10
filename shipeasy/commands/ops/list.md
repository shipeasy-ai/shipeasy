---
description: List operational items — bug reports, feature requests, tracked production errors, or active alerts — with a --type filter
argument-hint: "[--type bug|feature|error|alert] [--status <s>] [--priority high|critical|medium|low] [--name-contains <s>]"
---

Unified read view over the bound project's operational inbox. One command,
four sources, picked with `--type`. This replaces the old per-namespace
`/shipeasy:bugs:list`. Follow the `bugs` skill for triage semantics.

`--type` (default `bug`):

| `--type`  | Source CLI                       | What it is                                  |
| --------- | -------------------------------- | ------------------------------------------- |
| `bug`     | `shipeasy feedback bugs list`    | In-app bug reports                          |
| `feature` | `shipeasy feedback features list`| In-app feature requests                     |
| `error`   | `shipeasy ops.errors list`       | see()-tracked production errors             |
| `alert`   | `shipeasy alerts list`           | Active metric-threshold / built-in alerts   |

`error` and `alert` rows are produced by the platform, never filed by hand.
Errors support one write — status (open/resolved/ignored) via
`PATCH /api/admin/errors/<id>`; a resolved error reopens automatically if it
recurs. Alerts are fully read-only. To act on either end-to-end, use
`/shipeasy:ops:work`.

## Steps

1. Parse `$ARGUMENTS` for `--type` (default `bug`). Pull the matching JSON:

   ```bash
   # bug (default) / feature
   shipeasy feedback bugs list     --json > /tmp/se-ops.json   # --type bug
   shipeasy feedback features list --json > /tmp/se-ops.json   # --type feature
   # error
   shipeasy ops.errors list        --json > /tmp/se-ops.json   # --type error
   # alert  (requires CLI ≥ 1.8.0 — `shipeasy alerts` was added there)
   shipeasy alerts list            --json > /tmp/se-ops.json   # --type alert
   ```

   The CLI exposes `--status` natively on `feedback bugs list`,
   `feedback features list`, and `ops.errors list`. Other filters apply
   client-side.

2. Apply the remaining filters and print a compact table. For **bug** /
   **feature** (priority + status + name):

   ```bash
   node - <<'JS' < /tmp/se-ops.json
   const STATUS   = process.env.STATUS   || "";
   const PRIORITY = process.env.PRIORITY || "";
   const NEEDLE   = (process.env.NEEDLE   || "").toLowerCase();
   const RANK = { critical: 4, high: 3, medium: 2, low: 1 };
   const rows = JSON.parse(require("fs").readFileSync(0, "utf8"))
     .filter(b => !STATUS   || b.status === STATUS)
     .filter(b => !PRIORITY || b.priority === PRIORITY)
     .filter(b => !NEEDLE   || (b.title ?? "").toLowerCase().includes(NEEDLE))
     .sort((a, b) =>
       (RANK[b.priority] || 0) - (RANK[a.priority] || 0) ||
       (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
   for (const b of rows) console.log(
     `${b.id.slice(0, 8)}  ${(b.priority ?? "—").padEnd(8)}  ${(b.status ?? "").padEnd(12)}  ${(b.title ?? "").slice(0, 60)}`
   );
   console.log(`\n${rows.length} match${rows.length === 1 ? "" : "es"}.`);
   JS
   ```

   For **error**, sort by `count desc, lastSeenAt desc` and print
   `id, errorType, count, status, message`. For **alert**, sort by
   `severity (danger>warn>info), createdAt desc` and print
   `id, severity, source, title`.

Field references:

- bug/feature — `id`, `title`, `description`, `status`, `priority`,
  `pageUrl`, `createdAt`.
- error — `id`, `fingerprint`, `message`, `errorType`, `source`, `status`,
  `count`, `firstSeenAt`, `lastSeenAt`.
- alert — `id`, `severity`, `source`, `title`, `detail`, `href`,
  `observedValue`, `status`, `createdAt`.

To process the whole queue end-to-end (investigate + fix + resolve), use
`/shipeasy:ops:work`. To file a new bug or feature, use `/shipeasy:ops:report`.
