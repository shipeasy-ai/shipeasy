---
description: Enable the configs module and verify the SDK read path for dynamic configs
---

Per-feature install for `configs` (dynamic/remote configs — typed JSON
values, not booleans). Prereq: `/shipeasy:setup` already run and
`.shipeasy` exists.

Boolean feature gates live in the `gates` module — see
`/shipeasy:flags:install`. Kill switches reuse `gates` — see
`/shipeasy:ks:install`.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run `/shipeasy:setup` first.

2. Enable the module:

   ```bash
   shipeasy modules enable configs
   shipeasy modules list      # expect: configs ✓
   ```

3. Smoke-test the read path from a server context:

   ```ts
   import { configs } from "@shipeasy/sdk/server";
   console.log(await configs.get("smoke-config", "fallback")); // "fallback"
   ```

   `configs.get(name, fallback)` returns `fallback` when the config
   doesn't exist or KV is unreachable — the SDK never throws on the read
   path.

4. Print the hand-off:

   ```
   ✅ configs install complete
   Module:  configs ✓
   Next:    /shipeasy:configs:create <name>   # first dynamic config
            (the `flags` skill covers gates + configs + kill switches).
   ```
