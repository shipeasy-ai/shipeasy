---
description: Enable the events module so Shipeasy can collect metric data (plus optional experiments wiring)
---

Per-plugin setup for metrics. Prereq: `base@shipeasy` installed and
`.shipeasy` exists.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run
   `claude plugin install base@shipeasy` + `/shipeasy-setup` first.

2. Enable modules:

   ```bash
   shipeasy modules enable events         # required: source data for metrics
   shipeasy modules enable experiments    # required if metrics gate A/B tests
   shipeasy modules list                  # expect: events ✓ (experiments ✓)
   ```

3. Smoke-test event tracking + metric round-trip:

   ```ts
   // in app code, somewhere it can run
   import { events } from "@shipeasy/sdk/client"; // or "@shipeasy/sdk/server"
   events.track("smoke_test", { amount: 1 });
   ```

   ```bash
   shipeasy metrics create smoke_count \
     --event smoke_test \
     --query 'count(smoke_test)'
   shipeasy metrics list                       # expect: smoke_count row
   shipeasy metrics delete <id-from-above>     # clean up
   ```

4. Hand-off:

   ```
   ✅ metrics setup complete
   Modules: events ✓ [experiments ✓]
   Next:    /shipeasy:metric:create <name> --event <event> --query '<dsl>'
            or use the `metrics` skill.
   ```
