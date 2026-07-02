# Runbook: `error` items

Auto-filed by the platform when a tracked production error crosses the
occurrence threshold.

1. The ticket's `description` already carries the consequence, count, seen
   URLs, fingerprint, and stack head; `context.error.{id,fingerprint}` ties it
   to the underlying tracked error. Re-read the ticket any time with
   `shipeasy ops get <handle>`. The raw `errors` source is for *diagnosis*
   while working the ticket, not for building the queue.
2. Locate the throw site from the stack frame / message. Reproduce if
   feasible. Fix the root cause (same hard rules as bugs). When the fix adds
   a catch block, instrument it with `see(e).causes_the(…).to(…)` from
   `@shipeasy/sdk` (see the `shipeasy-see` skill for consequence-writing rules).
3. Flip the ticket when the fix lands. The underlying tracked error
   auto-resolves with the ticket and **reopens automatically if it recurs**,
   so this is safe pre-deploy. Note the fingerprint in your summary.
