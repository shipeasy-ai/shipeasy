# Runbook: `measure_plan` items

Auto-filed by the in-dashboard website assistant, which can create
metrics/experiments/alert rules over the API but **can't edit the repo** — it
created what it could and filed the rest here for you. The item is
half-instrumented by design; your job is the code half. Shared mechanics
(atomic diff, gate, status lifecycle) are in SKILL.md §1a; this is the
measure-plan-specific flow.

## The plan is a best-effort proposal, not a spec

The assistant wrote this plan **without access to your repo** — it doesn't know
your event names, your call sites, or how the code is actually wired. So treat
the plan as a starting point, not a contract:

- **`context.measurePlan.goal` is the target** — the customer's own statement of
  WHAT they want to learn/achieve and WHY. Everything below is one proposed way
  to get there. When the goal and a literal step conflict, **serve the goal.**
- **What you find in the code takes precedence.** If the codebase already emits
  a suitable event under a different name, reuse it instead of adding the one the
  plan invented. If the real user moment lives at a different call site than the
  plan assumed, instrument the real one.
- **Create whatever additional metrics/events the goal needs — even off-plan.**
  The ops key is allow-listed for create-only dev operations (metrics, events,
  alert rules — see SKILL.md "Dev operations"). If achieving the goal takes an
  event or metric the plan never listed, **create it**; a plan that measured the
  wrong thing precisely is a failure. Note any deviation in your run summary so
  the reviewer sees why the diff diverged from the ticket.

## What's on the ticket

Read `context.measurePlan`:

- `goal` — the customer's intent (see above). May be absent on older/terse plans;
  when it is, infer the intent from the `title` + steps and still optimize for it.
- `created[]` — resources already live (`{kind,id,name}`); don't recreate them,
  but you **may** add to them if the goal needs more.
- `pending[]` — resources it couldn't make yet (usually a metric whose backing
  event isn't emitted); create these **after** you add the instrumentation.
- `instrumentation[]` — the code work. Each step has `event` (the name to
  emit), `description` (conceptually **what** user moment to capture and
  **why** — the assistant has no repo access, so it never names files; you
  locate the call site), and `properties[]` (the event properties the metric
  needs attached). Some steps carry `attribute` instead — a new user attribute
  to start sending on the identify/evaluate context. Follow the
  `flags`/`experiments` skills for the SDK call.

Order matters — the `pending[]` metric can't bind to an event that doesn't
exist yet:

1. Implement the `instrumentation[]` events (reusing/renaming to match the code,
   and adding any the goal needs).
2. Create the `pending[]` resources — plus any extra metric/event the goal
   requires (the ops key is allow-listed for create-only dev operations — see
   the skill's "Dev operations" section).
3. Verify the `created[]` (and any newly-created) metrics now bind to a real
   event.
