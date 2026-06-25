---
name: ks-toggle_switch
description: Toggle one named override switch on a kill switch (set or unset a per-key boolean override on one env) — the dashboard "switches" feature
argument-hint: "<folder.name> <switch-key> [on|off] [--env prod|staging|dev]"
user-invocable: true
---

Flip a single **named override** on an existing kill switch. This replaces
the old `/shipeasy:ks:update` — there is no longer a wholesale,
definition-level update command. Edit a kill switch's behaviour the way the
dashboard does: one named switch at a time, per env, with a narrow blast
radius. (Definition edits like renaming or changing the description happen in
the UI.)

## How a kill switch's value resolves

A kill switch delivers this payload to clients:

```jsonc
{ "value": <bool>, "switches": { "<switch-key>": <bool>, … } }
```

- **`value`** is the flat default — a single boolean (on/off) returned when no
  named override matches.
- **`switches`** is a map of **named overrides**. This is the "switches"
  feature you see in the UI. Each entry is a key you **name yourself** — an
  arbitrary custom string label (lowercase, no dots — e.g. `checkout`,
  `eu-traffic`, `legacy_api`) — paired with **its own boolean**. When a
  caller's switch key matches an entry, that entry's boolean takes precedence
  over the flat `value` for that caller.

The point of a named override is to carve out an **exception** that holds the
**opposite** value from the default: e.g. the kill switch defaults `value:
false` (feature live), but the `checkout` override is `true` (feature killed
only for the checkout surface). Or the inverse — default `true` (globally
killed) with a `beta` override of `false` to keep it alive for one cohort.

> The override **value is a boolean**, not free text — the switch *key* is the
> custom string you choose, and its value is on/off. (Typed/string values are
> a dynamic-config feature: see `/shipeasy:configs:create`, not kill switches.)

## Toggle one override

Parse `$ARGUMENTS`: `<folder.name>` (the kill switch), `<switch-key>` (the
named override — yours to name), an optional `on`/`off` (default `on` when
setting), and `--env` (default `prod`).

1. **Set / update** the override (creates the named key if absent):

   ```bash
   shipeasy ks set <folder.name> <switch-key> <on|off> --env <env>
   # e.g. carve out an exception that flips checkout off while the default stays on:
   shipeasy ks set payments.legacy checkout off --env prod
   ```

   MCP equivalent (typed errors):

   ```
   mcp tool: exp_set_killswitch_switch {
     "name":      "<folder.name>",
     "switch_key":"<switch-key>",
     "value":     true,
     "env":       "prod"
   }
   ```

2. **Unset** (remove the override, so that caller falls back to the flat
   `value` again):

   ```bash
   shipeasy ks unset <folder.name> <switch-key> --env <env>
   # MCP: exp_unset_killswitch_switch { name, switch_key, env }
   ```

3. Confirm with `/shipeasy:ks:list` (the prod-env switch count + value column
   reflect the change).

## Notes

- **One key, one env, per call** — much narrower than the old wholesale
  update. To trip a different surface, run it again with another key.
- **The flat default** (`value`) is set at create time
  (`/shipeasy:ks:create`). To flip the whole kill switch on/off rather than a
  named exception, change that default via the dashboard quick-toggle.
- **No SDK reader.** The public SDK reads gates + configs, not the standalone
  `killswitches` map. For in-code branching, gate the path with
  `/shipeasy:flags:create` and flip that gate's `killswitch` field instead.
- **Deletion is UI-only** — this plugin ships no `ks:delete`. Remove a kill
  switch from the dashboard.
