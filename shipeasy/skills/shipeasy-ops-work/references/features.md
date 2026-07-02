# Runbook: `feature_request` items

Human-filed feature requests.

1. Read `title`, `description`, `useCase`, `priority`, `pageUrl` from the
   queue JSON.
2. **Design first** with `AskUserQuestion` (interactive runs only — unattended
   runs pick the smallest shape): locate the surface area (grep keywords +
   `pageUrl`), propose 2–4 implementation shapes (file:line scope, behaviour
   delta, trade-off). Stop scope creep — propose the smallest shape that
   satisfies the use case; flag larger refactors as follow-ups.
3. Implement as **one atomic diff**. No half-finished work — if it genuinely
   can't land in one pass (missing API, schema change you can't apply), note
   the gap, **escalate via `ops notify`** (the skill's "Escalate" section)
   with the blocker + next steps, and skip; don't land a partial. Reuse
   existing utilities before adding abstractions. Run the gate (incl. an e2e
   spec for new UI workflows — see CLAUDE.md).
4. Flip to `ready_for_qa` when implemented; `resolved` is the human's call
   after it ships.
