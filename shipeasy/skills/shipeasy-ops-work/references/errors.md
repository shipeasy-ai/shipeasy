# Runbook: `error` items

Auto-filed by the platform when a tracked production error crosses the
occurrence threshold. The investigation context is already baked into the
ticket — you're fixing a throw, not diagnosing from scratch. Shared mechanics
(atomic diff, gate, status lifecycle) are in SKILL.md §1a; this is the
error-specific flow.

1. The ticket's `description` carries the consequence, count, seen URLs,
   fingerprint, and stack head; `context.error.{id,fingerprint}` ties it to
   the underlying tracked error. Re-read any time with `shipeasy ops get
   <handle>`. The raw `errors` source is for *diagnosis* while working the
   ticket, not for building the queue.
2. Locate the throw site from the stack frame / message; reproduce if
   feasible. **When the fix adds a catch block, instrument it** with
   `see(e).causes_the(…).to(…)` from `@shipeasy/sdk` (the `shipeasy-see` skill
   carries the consequence-writing rules) — a swallowed error that recurs
   silently is worse than the original.
3. **Note the fingerprint in your summary.** The underlying tracked error
   auto-resolves with the ticket and **reopens automatically if it recurs** —
   so flipping the ticket pre-deploy is safe; a real regression re-files
   itself rather than being lost.
