---
description: List metrics with optional filters (folder, event, aggregation, name contains)
argument-hint: "[--folder <f>] [--event <name>] [--agg <count|sum|avg|...>] [--name-contains <s>]"
---

Tabular or JSON list of all metrics in the bound project. Follow the
`metrics` skill.

Unfiltered tabular view:
```bash
shipeasy metrics list
```

For filtered queries, CLI exposes `--json` only — apply filters
client-side:

```bash
shipeasy metrics list --json > /tmp/se-metrics.json
node - <<'JS' < /tmp/se-metrics.json
const FOLDER = process.env.FOLDER || "";
const EVENT  = process.env.EVENT  || "";
const AGG    = process.env.AGG    || "";
const NEEDLE = (process.env.NEEDLE || "").toLowerCase();
const rows = JSON.parse(require("fs").readFileSync(0, "utf8"))
  .filter(m => !FOLDER || (m.folder ?? "") === FOLDER)
  .filter(m => !EVENT  || m.eventName === EVENT)
  .filter(m => !AGG    || m.aggregation === AGG)
  .filter(m => !NEEDLE || m.name.toLowerCase().includes(NEEDLE));
for (const m of rows) console.log(
  `${m.id.slice(0, 8)}  ${m.name.padEnd(30)}  ${(m.folder ?? "—").padEnd(15)}  ${m.eventName.padEnd(25)}  ${m.aggregation}`
);
console.log(`\n${rows.length} match${rows.length === 1 ? "" : "es"}.`);
JS
```

Field reference: `id`, `name`, `folder`, `eventName`, `aggregation`
(`count`, `count_users`, `sum`, `avg`, `min`, `max`, `unique`,
`p50`…`p999`, `retention_<N>d`), `queryIr`.
