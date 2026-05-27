---
description: Enable the gates module and verify the SDK read path
---

Per-feature install for `flags` (boolean feature gates). Prereq:
`/shipeasy:setup` already run and `.shipeasy` exists.

Dynamic configs and kill switches have their own installs:
`/shipeasy:configs:install`, `/shipeasy:ks:install` (the latter reuses
the `gates` module, so installing flags also unblocks kill switches).

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run `/shipeasy:setup` first.

2. Enable the module:

   ```bash
   shipeasy modules enable gates
   shipeasy modules list      # expect: gates ✓
   ```

3. Smoke-test the read path from a server context:

   ```ts
   import { gates } from "@shipeasy/sdk/server";
   console.log(await gates.check("smoke-test")); // false (no such gate)
   ```

4. Print the hand-off:

   ```
   ✅ flags install complete
   Module:  gates ✓
   Next:    Use the `flags` skill or /shipeasy:flags:create <name> [percent]
            to create your first gate. Kill switches reuse this module —
            see /shipeasy:ks:create.
   ```
