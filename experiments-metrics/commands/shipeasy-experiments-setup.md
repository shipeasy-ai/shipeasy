---
description: Enable the experiments module and verify A/B + event collection works
---

Run the per-plugin setup for `shipeasy@experiments-metrics`. Prereq:
`shipeasy@base` is already installed and `.shipeasy` exists.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run
   `claude plugin install shipeasy@base` + `/shipeasy-setup` first.

2. Enable the module:

   ```bash
   shipeasy modules enable experiments
   shipeasy modules list      # expect: experiments ✓
   ```

3. Smoke-test the assignment endpoint from a server context (just to
   confirm wiring, not to actually create an experiment):

   ```ts
   import { experiments } from "@shipeasy/sdk/server";
   const { group } = await experiments.assign("smoke-test", { user_id: "anon" });
   console.log({ group }); // returns the default group; no experiment exists yet
   ```

4. Print the per-plugin hand-off:
   ```
   ✅ shipeasy@experiments-metrics setup complete
   Module:  experiments ✓
   Next:    Use the `shipeasy-experiments` skill or `/shipeasy-experiment <name>`
            to design and launch your first A/B test.
   ```
