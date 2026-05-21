---
description: Create a Shipeasy feature gate with the right rollout/targeting shape
argument-hint: "<gate-name> [percent]"
---

Create or update a Shipeasy feature gate. Follow the `flags` skill.

Defaults:

- `rollout_percent`: 0 (start dark, ramp manually).
- `default`: false (the safe path on KV failure).
- No targeting unless the user specifies attributes.

Steps:

1. If MCP is registered, use `exp_create_gate` for typed errors:
   ```
   mcp tool: exp_create_gate { "name": "<name>", "rollout_percent": <pct>, "default": false }
   ```
2. Otherwise:
   ```bash
   shipeasy flags create --name <name> --percent <pct>
   ```
3. Show the user the SDK call sites they need to add:
   ```ts
   import { gates } from "@shipeasy/sdk/server"; // or /client
   if (await gates.check("<name>", { user_id })) {
     /* new path */
   }
   ```
4. Remind: ramp is manual (5 → 25 → 50 → 100). Don't mention "automatic
   rollout" — Shipeasy doesn't auto-ramp.
