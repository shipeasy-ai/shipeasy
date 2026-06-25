---
name: experiments-update
description: Update an experiment's allocation, groups, targeting gate, or stats thresholds
argument-hint: "<name> [--allocation <pct>] [--groups <json>] [--targeting-gate <name>] [--significance <p>] [--min-runtime-days <n>] [--min-sample-size <n>]"
user-invocable: true
---

Update a draft (or running) experiment. Follow the `experiments` skill.

**Mutability rules** (the admin API enforces these — match them
client-side to fail fast):

- **Draft** → all fields editable (allocation, groups, params,
  targeting gate, stats thresholds).
- **Running** → only stats thresholds (`significance`,
  `min-runtime-days`, `min-sample-size`) and `targeting-gate` are
  editable. The API refuses changes to `allocation`, `groups`, `params`,
  `universe`, and `salt` on a running experiment — these all affect
  the assignment hash, so touching any of them would **re-randomise**
  users already enrolled. If the user needs to change one, stop +
  recreate under `<old>_v2`.

Steps:

1. Check current state first:
   ```
   mcp tool: exp_experiment_status { "name": "<name>" }
   ```
   If state is `stopped` or `archived`, this command can't help — those
   are terminal.

2. Build the patch. Pass only the fields you're changing — omitted
   fields are left untouched. Use MCP:
   ```
   mcp tool: exp_update_experiment {
     "name":                   "<name>",
     "allocation":             <pct>,            // 0–100
     "groups":                 "<json-string>",  // JSON-encoded array
     "targeting_gate":         "<gate-name>",    // "" to leave unchanged
     "significance_threshold": 0.05,
     "min_runtime_days":       7,
     "min_sample_size":        1000
   }
   ```

3. CLI fallback:
   ```bash
   shipeasy experiments update <name> \
     [--allocation <pct>] \
     [--groups '<json>'] \
     [--params '<json>'] \
     [--targeting-gate <gate-name>|null] \
     [--significance <p>] \
     [--min-runtime-days <n>] \
     [--min-sample-size <n>]
   ```

4. After the update, re-check status to confirm the change landed:
   `shipeasy experiments status <name>`.

Hard rules:

- One success metric, pre-registered at creation. Don't add a second
  via update — `exp_update_experiment` doesn't accept `success_*`
  fields for that reason.
- Don't widen `targeting-gate` on a running experiment mid-flight to
  "rescue" a slow ramp — that's a fresh exposure population and
  invalidates the test.
