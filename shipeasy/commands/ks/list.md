---
name: ks-list
description: List killswitches with optional filters (folder, prod value, name contains)
argument-hint: "[--folder <f>] [--value on|off] [--name-contains <s>]"
user-invocable: true
---

Tabular or JSON list of all killswitch resources in the bound project.

CLI exposes `--json` only — filters apply client-side. For an unfiltered
table, run `shipeasy ks list` directly.

Steps:

1. Pull the JSON list:
   ```bash
   shipeasy ks list --json > /tmp/se-ks.json
   ```

2. Apply filters. The CLI returns each row with `envs.{dev,staging,prod}`
   — filter against the `prod` env value by default:
   ```bash
   node - <<'JS' < /tmp/se-ks.json
   const FOLDER = process.env.FOLDER || "";
   const VALUE  = process.env.VALUE || "";   // "on" | "off" | ""
   const NEEDLE = (process.env.NEEDLE || "").toLowerCase();
   const rows = JSON.parse(require("fs").readFileSync(0, "utf8"))
     .filter(k => !FOLDER || (k.folder ?? "") === FOLDER)
     .filter(k => !NEEDLE || k.name.toLowerCase().includes(NEEDLE))
     .filter(k => {
       if (!VALUE) return true;
       const prod = k.envs?.prod ?? k.envs?.staging ?? k.envs?.dev;
       return (VALUE === "on") === !!prod?.value;
     });
   for (const k of rows) {
     const prod = k.envs?.prod ?? k.envs?.staging ?? k.envs?.dev;
     const sw   = prod?.switches ? Object.keys(prod.switches).length : 0;
     console.log(`${k.name.padEnd(40)}  ${prod?.value ? "ON " : "OFF"}  switches=${sw}  ${k.updatedAt?.slice(0, 19) ?? ""}`);
   }
   console.log(`\n${rows.length} match${rows.length === 1 ? "" : "es"}.`);
   JS
   ```

Field reference: `name`, `folder`, `envs.{dev,staging,prod}.value`,
`envs.<env>.switches` (object), `updatedAt`. Killswitches are
**per-env** — the table shows `prod` (or first available) by default.
