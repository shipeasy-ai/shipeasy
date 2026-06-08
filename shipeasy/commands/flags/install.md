---
description: One-shot install for the whole flags + experimentation platform — gates, dynamic configs, kill switches, A/B experiments, and event metrics
---

Per-project install for the **flags platform** — the single command that
turns on every "decide-at-runtime" feature module in one pass:

- **gates** — boolean feature gates (`gates.check`)
- **configs** — typed JSON dynamic configs (`configs.get`)
- **kill switches** — standalone admin on/off resources (ride the same KV
  blob; no separate module toggle)
- **experiments** — A/B assignment (`experiments.assign`)
- **events** — the event stream that powers metrics + experiment success
  criteria (`events.track`)
- **alert rules** — metric-threshold rules the cron evaluates to raise alerts
  (built on top of `events` + `metrics`; no separate module toggle)

There is no longer a per-feature install for each of these — this command
replaces the old `/shipeasy:configs:install`, `/shipeasy:ks:install`,
`/shipeasy:experiments:install`, and `/shipeasy:metrics:install`. The other
two install sections are `/shipeasy:ops:install` (feedback + production
errors) and `/shipeasy:i18n:install` (translations).

Prereq: `/shipeasy:setup` already ran and `.shipeasy` exists at the repo root.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run `/shipeasy:setup` first.

2. Enable every platform module in one go:

   ```bash
   shipeasy modules enable gates
   shipeasy modules enable configs
   shipeasy modules enable events         # source data for metrics
   shipeasy modules enable experiments    # A/B assignment + metric-gated tests
   shipeasy modules list                  # expect: gates ✓ configs ✓ events ✓ experiments ✓
   ```

   Kill switches need no module — they ride in the same KV blob configs
   publish through. Enabling `configs` above already covers that path.

3. Smoke-test each read path from a server context (wiring check only — no
   resources exist yet, every call returns its safe fallback):

   ```ts
   import { gates, configs, experiments } from "@shipeasy/sdk/server";

   console.log(await gates.check("smoke-test"));               // false (no such gate)
   console.log(await configs.get("smoke-config", "fallback")); // "fallback"
   const { group } = await experiments.assign("smoke-test", { user_id: "anon" });
   console.log({ group });                                     // default group; no experiment yet
   ```

   `gates.check` / `configs.get` never throw on the read path — they return
   the default/fallback when the resource is missing or KV is unreachable.

4. Verify the admin paths the CLI uses are reachable (never `403`):

   ```bash
   shipeasy flags list        # [] or rows
   shipeasy configs list      # [] or rows
   shipeasy ks list           # [] or rows
   shipeasy experiments list  # [] or rows
   shipeasy metrics list      # [] or rows
   shipeasy alert-rules list  # [] or rows
   ```

5. Print the hand-off:

   ```
   ✅ flags platform install complete
   Modules: gates ✓  configs ✓  events ✓  experiments ✓   (kill switches need no module)
   Next:
     /shipeasy:flags:create <name> [percent]            # boolean feature gate
     /shipeasy:configs:create <name> [json-default]     # typed dynamic config
     /shipeasy:ks:create <folder.name>                  # standalone kill switch
     /shipeasy:experiments:create <name>                # design + draft an A/B test
     /shipeasy:metrics:create <name> --event <e> --query '<dsl>'
     /shipeasy:alerts:create <name> --metric <m> --comparator gt --threshold <n>
   Or use the `flags`, `experiments`, or `metrics` skills.
   ```
