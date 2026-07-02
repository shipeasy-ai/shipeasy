# Runbook: `measure_plan` items

Auto-filed by the in-dashboard website assistant, which can create
metrics/experiments/alert rules over the API but **can't edit the repo** — it
created what it could and filed the rest here for you.

Read `context.measurePlan`:

- `created[]` — resources already live (`{kind,id,name}`); don't recreate them.
- `pending[]` — resources it couldn't make yet (usually a metric whose backing
  event isn't emitted); create these **after** you add the instrumentation.
- `instrumentation[]` — the code work: for each, emit the `event` at the place
  `detail` describes (follow the `flags`/`experiments` skills for the SDK call).

Working one:

1. Flip to `in_progress`, then implement the `instrumentation[]` events.
2. Create the `pending[]` resources (the ops key is allow-listed for
   create-only dev operations — see the skill's "Dev operations" section).
3. Verify the `created[]` metrics now bind to a real event.
4. Ship it like any other item (one atomic diff; `ready_for_qa` when
   implemented).
