---
description: Create a Shipeasy metric (event-backed query) for tracking or experiment success
argument-hint: "<name> --event <event> --query '<dsl>'"
---

Create a new metric. Follow the `metrics` skill.

Prereqs:

- `base@shipeasy` installed, `.shipeasy` bound.
- `events` module enabled (and `experiments` if the metric will be a
  success criterion). If unsure, run
  `/shipeasy:metrics:install` first.

Workflow:

1. Pick metric `<name>` and source `<event>`.
2. Pick DSL:
   `aggregation(event[{label op value, ...}][, value_label]) [by (...)] [without (...)]`.
   Run `shipeasy metrics grammar` for full syntax. Aggregations:
   `count_users`, `count`, `sum`, `avg`, `min`, `max`, `unique`,
   `p50/p75/p90/p95/p99/p999`, `retention_<N>d`. Match ops: `=`, `!=`,
   `=~`, `!~`.
3. If the event is not yet emitted in app code, instrument it first.
   Labels referenced by the query must exist on the event payload:

   ```ts
   import { events } from "@shipeasy/sdk/client"; // or "@shipeasy/sdk/server"
   events.track("checkout_completed", { amount, country });
   ```

4. Create:

   ```bash
   shipeasy metrics create <name> \
     --event <event_name> \
     --query '<dsl>' \
     [--folder <folder>] \
     [--winsorize <pct>]   # default 99
     [--mde <0..1>]        # min detectable effect for power calcs
   ```

   The event inside `--query` must equal `--event` — the CLI enforces this.

5. Verify: `shipeasy metrics list` (expect the new row with the rendered query).
