---
description: Create a Shipeasy kill switch (admin resource that ships in the KV blob alongside gates + configs)
argument-hint: "<switch-name>"
---

Create a kill switch. A killswitch is a **separate admin resource**
(stored alongside configs in the configs table with `kind=killswitch`)
that ships in the KV blob under the `killswitches` map. It carries a
boolean `value` plus an optional `switches` map of named overrides.

Killswitches and feature gates are **different primitives**:

- Use a **gate** (`/shipeasy:flags:create`) for in-code branching — that
  is what the public SDK reads via `gates.check(...)`. A gate row also
  has its own `killswitch` field that, when flipped on by the admin
  API, forces `gates.check` to return `false`.
- Use a **killswitch resource** (this command) when you need a
  standalone, named on/off + switches map separate from any specific
  gate — e.g. for external consumers reading the KV blob directly, or
  for grouping several feature switches under one folder.

Fields (no rollout percent, no targeting — killswitches are binary):

- `name`: **must be `folder.name`** — exactly two lowercase segments
  separated by a dot. Use `kill.<feature>` or `ks.<feature>` so intent
  reads at a glance.
- `value`: boolean default the switch returns when no per-env override
  is set. Defaults to `false` in the MCP tool — pass `true` if the
  killswitch should be **on** until explicitly tripped.
- `switches`: optional `{ switch_key: bool }` overrides — take
  precedence over `value` for that switch_key.
- `description`: optional free text.

Steps:

1. If MCP is registered, use `exp_create_killswitch` for typed errors.
   `switches` is a **JSON-encoded string**, not a raw object:

   ```
   mcp tool: exp_create_killswitch {
     "name":        "kill.<feature>",
     "value":       true,
     "switches":    "{\"checkout\":true,\"signup\":true}"   // optional
   }
   ```

2. Otherwise the CLI (parent is `killswitch`, alias `ks`; `<name>` is
   positional):

   ```bash
   shipeasy ks create kill.<feature> --value true \
     [--switches '{"checkout":true}'] \
     [--description "<text>"]
   ```

3. Flip a switch entry per env (default env `prod`):

   ```bash
   shipeasy ks set   kill.<feature> <switch_key> false
   shipeasy ks unset kill.<feature> <switch_key>
   # MCP: exp_set_killswitch_switch { name, switch_key, value, env }
   ```

4. **For runtime code branching, use a gate instead.** The SDK
   `gates.check(...)` doesn't read the standalone `killswitches` map —
   gate the new path with `/shipeasy:flags:create <name>` and flip the
   gate's `killswitch` field to force-off in an incident.
