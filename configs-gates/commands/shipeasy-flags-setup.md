---
description: Enable the gates + configs modules and verify the SDK reads them
---

Run the per-plugin setup for `configs-gates@shipeasy`. Prereq:
`base@shipeasy` is already installed and `.shipeasy` exists.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run
   `claude plugin install base@shipeasy` + `/shipeasy-setup` first.

2. Enable the modules (independent toggles — enable what you need):

   ```bash
   shipeasy modules enable gates
   shipeasy modules enable configs
   shipeasy modules list      # expect: gates ✓ configs ✓
   ```

   (Kill switches reuse the `gates` module; no separate toggle.)

3. Smoke-test the read path from a server context:

   ```ts
   import { gates, configs } from "@shipeasy/sdk/server";
   console.log(await gates.check("smoke-test")); // false (no such gate)
   console.log(await configs.get("smoke-config", "fallback")); // "fallback"
   ```

4. Print the per-plugin hand-off:
   ```
   ✅ configs-gates@shipeasy setup complete
   Modules: gates ✓ configs ✓
   Next:    Use the `shipeasy-flags` skill or `/shipeasy-flag <name> [percent]`
            to create your first gate / config / kill switch.
   ```
