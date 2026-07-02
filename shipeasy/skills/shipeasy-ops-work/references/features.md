# Runbook: `feature_request` items

Human-filed feature requests. Unlike a bug, the *shape* is undecided — the
risk is building the wrong thing or building too much. Shared mechanics
(atomic diff, gate, status lifecycle) are in SKILL.md §1a; this is the
feature-specific flow.

1. Read `title`, `description`, `useCase`, `priority`, and
   `context.browser.pageUrl` (the page it was filed from) from the queue JSON.
2. **Design before you build.** Locate the surface area (grep keywords +
   `context.browser.pageUrl`). In interactive runs, ask the user to choose among 2–4
   implementation shapes (file:line scope, behaviour delta, trade-off);
   unattended runs pick the smallest shape that satisfies the `useCase`. Stop
   scope creep — flag larger refactors as follow-up items, not part of this
   diff.
3. **A partial feature is worse than none.** If the chosen shape can't land in
   one atomic diff (missing API, schema change the ops key can't apply), don't
   ship half — note the gap, escalate with the blocker + next steps, and skip.
