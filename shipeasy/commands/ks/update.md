---
description: Update a Shipeasy killswitch's default value, switches map, or description
argument-hint: "<switch-name> [--value <bool>] [--switches <json>] [--description <text>]"
---

Update an existing killswitch. To flip **one** per-env entry without
touching the rest, use `/shipeasy:ks:set` semantics (`shipeasy ks set
<name> <switch_key> <value> [--env <env>]`) — much narrower blast
radius than a full wholesale update.

This command is for **definition-level** changes (default value,
switches map shape, description).

Steps:

1. Pick the change:
   - Default `value` flip → applies when no per-env switch entry is set.
   - `switches` replacement → **wholesale replace** of the map; pass the
     full intended map, not a patch.
   - `description` change → free text.

2. MCP. `switches` is a **JSON-encoded string**:
   ```
   mcp tool: exp_update_killswitch {
     "name":        "<folder.name>",
     "value":       true,
     "switches":    "{\"checkout\":true,\"signup\":false}",
     "description": "<text>"
   }
   ```

3. CLI fallback:
   ```bash
   shipeasy ks update <folder.name> \
     [--value <bool>] \
     [--switches '<json>'] \
     [--description "<text>"]
   ```

4. To trip a single switch in an incident, prefer the narrow path:
   ```bash
   shipeasy ks set   <folder.name> <switch_key> false --env prod
   shipeasy ks unset <folder.name> <switch_key>       --env prod
   ```
