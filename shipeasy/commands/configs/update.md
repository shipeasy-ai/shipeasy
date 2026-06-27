---
name: configs-update
description: Update a Shipeasy dynamic config's value (flat update, all envs)
argument-hint: "<config-name> <json-value>"
user-invocable: true
---

Update an existing config's value. The flat-update path applies to
**all envs at once** — for per-env staging, use the draft → publish
flow in the dashboard (`shipeasy release configs draft` / `shipeasy configs
publish`).

Steps:

1. Confirm the shape hasn't changed in a way that breaks call sites.
   The admin API validates the new value against the stored JSON Schema
   and rejects mismatches.

2. Flat update via MCP. **`value` is a JSON-encoded string**:
   ```
   mcp tool: release_configs_update {
     "name":  "<name>",
     "value": "{\"max_items\":20}"
   }
   ```

3. CLI fallback:
   ```bash
   shipeasy release configs update <name> --value '<json-value>'
   ```

4. Per-env staging (preferred for production-facing configs — lets you
   land a change in `staging` first, verify, then promote to `prod`):
   ```bash
   shipeasy release configs draft   <name> --env staging --value '<json>'
   shipeasy release configs publish <name> --env staging
   ```

5. After the update, the KV blob rebuild + CDN purge fire automatically.
   Edge picks up the new value on next read.
