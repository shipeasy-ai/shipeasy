# Runbook: `alert` items

Auto-filed by the platform when an alert transitions to active. The *alert*
auto-resolves when its condition clears; the **ticket** is the work record.
Not every alert is a code bug — triage the source first. Shared mechanics
(atomic diff, gate, status lifecycle) are in SKILL.md §1a; this is the
alert-specific flow.

1. `context.alert` is hydrated: `source`, `severity`, `observedValue`,
   `status`/`activeSince`/`resolvedAt` (live alert state), `rule`
   (`comparator`/`threshold`/`windowHours` — the exact condition that tripped),
   and `metric` (`{id, name, events[]}` — the metric and the event name(s) it
   aggregates). **`context.alert.source` decides the path**:
   - `metric_rule` — a user-defined threshold tripped. Confirm the breach is
     real against `rule` + `observedValue` (not a bad threshold), then **grep
     for `track('<event>')` for each name in `context.alert.metric.events`** —
     that's the instrumentation feeding the metric; fix the regression behind
     the move.
   - `experiment_srm` / `experiment_peek` — a sample-ratio mismatch or an
     early-peek warning on a running experiment. Usually an assignment or
     instrumentation bug — investigate (see the `shipeasy-experiments` skill),
     don't just acknowledge.
   - `guardrail` — a guardrail metric moved the wrong way. Treat like a bug in
     the change that moved it.
   (Killswitch-armed alerts never file tickets — arming one is usually
   intentional incident response.)
2. **Two terminal shapes.** If it's a genuine ops acknowledgement (bad
   threshold, expected spike), flip the ticket to `resolved` with a one-line
   note — no code change. If the right fix IS a rule change (new
   threshold/comparator/window), that's a human edit the ops key can't make —
   **escalate via `ops notify`** with the exact new values.
