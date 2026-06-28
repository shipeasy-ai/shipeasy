---
name: flags-install
description: One-shot install for the whole flags + experimentation platform — gates, dynamic configs, kill switches, A/B experiments, and event metrics
user-invocable: true
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

There is no per-feature install for each of these — this one command turns on
the whole platform. The other two install sections are `/shipeasy:ops:install`
(feedback + production errors) and `/shipeasy:i18n:install` (translations).

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
   shipeasy release flags list        # [] or rows
   shipeasy release configs list      # [] or rows
   shipeasy release ks list           # [] or rows
   shipeasy release experiments list  # [] or rows
   shipeasy metrics list      # [] or rows
   shipeasy alert-rules list  # [] or rows
   ```

5. Print the hand-off:

   ```
   ✅ flags platform install complete
   Modules: gates ✓  configs ✓  events ✓  experiments ✓   (kill switches need no module)
   Next — create resources via the shipeasy MCP server (or the CLI):
     release_flags_create       { "name": "<name>", "rollout_percent": <n> }   # gate
     release_configs_create     { "name": "<name>", ... }                      # dynamic config
     release_killswitch_create  { "name": "<folder.name>" }                    # kill switch
     ops_alerts_create          { "name": "<name>", "metric": "<m>", ... }     # alert rule
   Workflows (slash commands):
     /shipeasy:experiments:create <name>                # design + draft an A/B test
     /shipeasy:metrics:create <name>                    # analyze + instrument + create a metric
   Or just ask — the `flags`, `experiments`, `metrics`, and `alerts` skills
   carry the guidance and always delegate to the MCP server or CLI.
   ```
