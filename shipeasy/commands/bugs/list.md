---
description: List in-app bug reports / feature requests with optional filters (status, priority, type, name contains)
argument-hint: "[--type bug|feature] [--status <s>] [--priority high|critical|medium|low] [--name-contains <s>]"
---

Tabular or JSON list of feedback items (bugs + features) in the bound
project. Follow the `bugs` skill.

The CLI exposes `--status` natively on `feedback bugs list`. Other
filters apply client-side.

Steps:

1. Pull the JSON list. Default `--type bug`; pass `--type feature` for
   feature requests:
   ```bash
   shipeasy feedback bugs list     --status open --json > /tmp/se-fb.json   # default
   # OR
   shipeasy feedback features list --status open --json > /tmp/se-fb.json
   ```

   If the user didn't pass `--status`, drop the `--status` arg — the
   CLI defaults to all statuses.

2. Apply remaining filters:
   ```bash
   node - <<'JS' < /tmp/se-fb.json
   const STATUS   = process.env.STATUS   || "";       // open|triaged|in_progress|ready_for_qa|resolved|wont_fix
   const PRIORITY = process.env.PRIORITY || "";       // critical|high|medium|low
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

Field reference: `id`, `title`, `description`, `status`, `priority`,
`pageUrl`, `createdAt`. To process the whole queue end-to-end (download
attachments, fix, mark resolved), use `/shipeasy:bugs:fix` instead.
