# Runbook: `alert` items

Auto-filed by the platform when an alert transitions to active (metric rule,
SRM/peek, guardrail).

1. The ticket's `description` carries the alert detail, source, observed
   value, and dashboard link; `context.alert.source` tells you the origin:
   - `metric_rule` — a user-defined threshold tripped. Open the metric
     (`shipeasy metrics list`), confirm the breach is real (not a bad
     threshold), and fix the underlying regression if there is one.
   - `experiment_srm` / `experiment_peek` — a sample-ratio mismatch or an
     early-peek warning on a running experiment. Usually an assignment or
     instrumentation bug — investigate, don't just acknowledge.
   - `guardrail` — a guardrail metric moved the wrong way. Treat like a bug
     in the change that moved it.
   (Killswitch-armed alerts never file tickets — arming one is usually
   intentional incident response.)
2. The *alert* auto-resolves when its condition clears; the **ticket** is the
   work record. If code needs to change, land the fix as its own atomic diff
   and flip the ticket. If it's an ops acknowledgement (bad threshold,
   expected spike), say so and flip the ticket to `resolved` with a one-line
   note in your summary. When the right fix IS a rule change (new
   threshold/comparator/window), that's a human edit the ops key can't make —
   **escalate via `ops notify`** (the skill's "Escalate" section) with the
   exact new values.
