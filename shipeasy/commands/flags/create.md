---
name: flags-create
description: Create a Shipeasy feature gate with the right rollout/targeting shape
argument-hint: "<gate-name> [percent]"
user-invocable: true
---

Create or update a Shipeasy feature gate. Follow the `flags` skill.

Defaults:

- `rollout_percent`: 0 (start dark, ramp manually).
- `default`: false (the safe path on KV failure).
- No targeting unless the user specifies attributes.

Steps:

1. If MCP is registered, use `release_flags_create` for typed errors:
   ```
   mcp tool: release_flags_create { "name": "<name>", "rollout": <pct> }
   ```
   `rollout` is a number 0–100. There is no `default` field on the gate
   row — the safe-fallback value lives on the SDK side
   (`gates.check(name, { default: false })`).
2. Otherwise:
   ```bash
   shipeasy release flags create <name> --rollout <pct>
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
