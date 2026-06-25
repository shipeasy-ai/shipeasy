---
name: experiments-list
description: List experiments with optional filters (status, universe, name contains)
argument-hint: "[--status draft|running|stopped|archived] [--universe <name>] [--name-contains <s>]"
user-invocable: true
---

Tabular or JSON list of all experiments in the bound project. Follow
the `experiments` skill.

CLI exposes `--json` only — filters apply client-side. For an unfiltered
table, run `shipeasy experiments list` directly.

Steps:

1. Pull the JSON list:
   ```bash
   shipeasy experiments list --json > /tmp/se-exp.json
   ```

2. Apply filters:
   ```bash
   node - <<'JS' < /tmp/se-exp.json
   const STATUS   = process.env.STATUS || "";    // draft|running|stopped|archived
   const UNIVERSE = process.env.UNIVERSE || "";
   const NEEDLE   = (process.env.NEEDLE || "").toLowerCase();
   const rows = JSON.parse(require("fs").readFileSync(0, "utf8"))
     .filter(e => !STATUS   || e.status === STATUS)
     .filter(e => !UNIVERSE || e.universe === UNIVERSE)
     .filter(e => !NEEDLE   || e.name.toLowerCase().includes(NEEDLE));
   for (const e of rows) console.log(
     `${e.name.padEnd(40)}  ${e.status.padEnd(9)}  ${(e.universe ?? "").padEnd(20)}  ${String((e.allocationPct ?? 10000) / 100)}%`
   );
   console.log(`\n${rows.length} match${rows.length === 1 ? "" : "es"}.`);
   JS
   ```

3. Common one-liners:
   - **What's running right now?** `--status running`
   - **Anything ready to archive?** `--status stopped` (then `/shipeasy:experiments:archive`).
   - **Drafts I forgot to start?** `--status draft`.

Field reference: `name`, `status` (`draft|running|stopped|archived`),
`universe`, `allocationPct` (0–10000 basis points), `successMetric`.
