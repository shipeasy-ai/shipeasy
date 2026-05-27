---
description: Update a Shipeasy feature gate's rollout, rules, or enabled flag
argument-hint: "<gate-name> [--rollout <pct>] [--rules <json>] [--enable|--disable]"
---

Update an existing feature gate. Follow the `flags` skill.

Pick the smallest change that fits the user's ask. The KV blob rebuild
fires on every write — batch related changes into one call.

Steps:

1. **Rollout bump only** (most common): use the dedicated CLI verb.
   ```bash
   shipeasy flags rollout <name> <pct>      # 0–100
   ```

2. **Enable / disable** a gate without changing its config:
   ```bash
   shipeasy flags enable  <name>
   shipeasy flags disable <name>
   ```
   Disabling makes `gates.check` return the SDK-side default (typically
   `false`) regardless of rollout — useful for incident response.

3. **Combined changes** (rollout + rules + enabled in one call) via MCP:
   ```
   mcp tool: exp_update_gate {
     "name":    "<name>",
     "rollout": <pct>,
     "rules":   "<json-encoded rules array>",
     "enabled": true | false
   }
   ```
   `rules` is a JSON-encoded **string**, not a raw array.

4. After ramping past 25%, remind the user to monitor error/latency
   dashboards before the next bump. Don't auto-advance the ramp.
