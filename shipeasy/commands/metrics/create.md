---
name: metrics-create
description: Create a Shipeasy metric (event-backed query) for tracking or experiment success
argument-hint: "<name> --event <event> --query '<dsl>'"
user-invocable: true
---

Create a new metric. Follow the `metrics` skill.

Prereqs:

- `.shipeasy` bound.
- The `shipeasy` MCP server is available — this workflow creates the metric
  (and instruments any backing event) through it (`metrics_create`,
  `events_create`); the `shipeasy` CLI is the fallback.

Workflow:

1. Pick metric `<name>` and source `<event>`.
2. Pick DSL:
   `aggregation(event[{label op value, ...}][, value_label]) [by (...)] [without (...)]`.
   Run `shipeasy metrics grammar` for full syntax. Aggregations:
   `count_users`, `count`, `sum`, `avg`, `min`, `max`, `unique`,
   `p50/p75/p90/p95/p99/p999`, `retention_<N>d`. Match ops: `=`, `!=`,
   `=~`, `!~`.
3. If the event is not yet emitted in app code, instrument it first.
   Labels referenced by the query must exist on the event payload.

   **Pull the `events.track` call for this project's SDK language from the
   `docs` MCP.** Detect the language from `.shipeasy` or the subproject's manifest
   (`package.json`, `pyproject.toml`, `Gemfile`, `go.mod`, `pom.xml`,
   `build.gradle*`, `composer.json`, `Package.swift`), then fetch the snippet:
   `docs_get { sdk: <lang>, path: "metrics" }` (run `docs_list { sdk: <lang> }` to
   find the handle; CLI `shipeasy docs get --sdk <lang> metrics`). The example
   below shows the shape — use the docs snippet for the exact call.

   ```ts
   // Example shape — fetch the exact call for this project's language via docs_get
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
