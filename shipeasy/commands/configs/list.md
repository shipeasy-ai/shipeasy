---
name: configs-list
description: List dynamic configs with optional filters (folder, name contains)
argument-hint: "[--folder <f>] [--name-contains <s>]"
user-invocable: true
---

Tabular or JSON list of all configs in the bound project. Follow the
`flags` skill (configs share the flags namespace).

CLI exposes `--json` only — filters apply client-side. For an unfiltered
table, run `shipeasy release configs list` directly.

Steps:

1. Pull the JSON list:
   ```bash
   shipeasy release configs list --json > /tmp/se-configs.json
   ```

2. Apply filters (skip any flag not passed):
   ```bash
   node - <<'JS' < /tmp/se-configs.json
   const FOLDER = process.env.FOLDER || "";
   const NEEDLE = (process.env.NEEDLE || "").toLowerCase();
   const rows = JSON.parse(require("fs").readFileSync(0, "utf8"))
     .filter(c => !FOLDER || (c.folder ?? "") === FOLDER)
     .filter(c => !NEEDLE || c.name.toLowerCase().includes(NEEDLE));
   for (const c of rows) console.log(
     `${c.name.padEnd(40)}  ${(c.folder ?? "").padEnd(20)}  ${c.updatedAt?.slice(0, 19) ?? ""}`
   );
   console.log(`\n${rows.length} match${rows.length === 1 ? "" : "es"}.`);
   JS
   ```

Field reference: `name`, `folder`, `schema` (JSON object), `updatedAt`.
For one config's full value, use `shipeasy release configs get <name> --json`.
