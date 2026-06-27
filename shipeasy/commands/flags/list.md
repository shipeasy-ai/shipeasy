---
name: flags-list
description: List feature gates with optional filters (folder, enabled, rollout, name contains)
argument-hint: "[--folder <f>] [--enabled true|false] [--min-rollout <pct>] [--name-contains <s>]"
user-invocable: true
---

Tabular or JSON list of all gates in the bound project. Follow the
`flags` skill.

The CLI itself only exposes `--json` — filtering is applied
**client-side** here. For a one-shot tabular view with no filter, just
run `shipeasy release flags list` directly.

Steps:

1. Pull the JSON list:
   ```bash
   shipeasy release flags list --json > /tmp/se-flags.json
   ```

2. Apply requested filters from `$ARGUMENTS` (skip any flag the user
   didn't pass). Use Node — no `jq` dependency:
   ```bash
   node - <<'JS' < /tmp/se-flags.json
   const FOLDER = process.env.FOLDER || "";
   const ENABLED = process.env.ENABLED;            // "true" | "false" | ""
   const MIN_ROLLOUT = Number(process.env.MIN_ROLLOUT || 0);  // 0–100
   const NEEDLE = (process.env.NEEDLE || "").toLowerCase();
   const rows = JSON.parse(require("fs").readFileSync(0, "utf8"))
     .filter(g => !FOLDER || (g.folder ?? "") === FOLDER)
     .filter(g => !ENABLED || String(!!g.enabled) === ENABLED)
     .filter(g => (g.rolloutPct ?? 0) / 100 >= MIN_ROLLOUT)
     .filter(g => !NEEDLE || g.name.toLowerCase().includes(NEEDLE));
   for (const g of rows) console.log(
     `${g.name.padEnd(40)} ${(g.enabled ? "on " : "off")} ${String((g.rolloutPct ?? 0) / 100).padStart(3)}%  ${g.folder ?? ""}`
   );
   console.log(`\n${rows.length} match${rows.length === 1 ? "" : "es"}.`);
   JS
   ```

3. Print the filtered table.

Field reference: `name`, `folder`, `enabled` (1|0), `rolloutPct` (0–10000
basis points; divide by 100 for percent).
