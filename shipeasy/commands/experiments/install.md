---
description: Enable the experiments module and verify A/B + event collection works
---

Per-feature install for `experiments`. Prereq: `/shipeasy:setup` already
run and `.shipeasy` exists.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run `/shipeasy:setup` first.

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

4. Print the hand-off:

   ```
   ✅ experiments install complete
   Module:  experiments ✓
   Next:    Use the `experiments` skill or /shipeasy:experiments:create <name>
            to design and launch your first A/B test.
   ```
