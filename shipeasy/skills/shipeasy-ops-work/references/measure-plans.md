# Runbook: `measure_plan` items

Auto-filed by the in-dashboard website assistant, which can create
metrics/experiments/alert rules over the API but **can't edit the repo** — it
created what it could and filed the rest here for you. The item is
half-instrumented by design; your job is the code half. Shared mechanics
(atomic diff, gate, status lifecycle) are in SKILL.md §1a; this is the
measure-plan-specific flow.

Read `context.measurePlan`:

- `created[]` — resources already live (`{kind,id,name}`); don't recreate them.
- `pending[]` — resources it couldn't make yet (usually a metric whose backing
  event isn't emitted); create these **after** you add the instrumentation.
- `instrumentation[]` — the code work: for each, emit the `event` at the place
  `detail` describes (follow the `flags`/`experiments` skills for the SDK call).

Order matters — the `pending[]` metric can't bind to an event that doesn't
exist yet:

1. Implement the `instrumentation[]` events.
2. Create the `pending[]` resources (the ops key is allow-listed for
   create-only dev operations — see the skill's "Dev operations" section).
3. Verify the `created[]` metrics now bind to a real event.
