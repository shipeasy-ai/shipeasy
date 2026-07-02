# Runbook: `error` items

Auto-filed by the platform when a tracked production error crosses the
occurrence threshold. The investigation context is already baked into the
ticket — you're fixing a throw, not diagnosing from scratch. Shared mechanics
(atomic diff, gate, status lifecycle) are in SKILL.md §1a; this is the
error-specific flow.

1. `context.error` is hydrated from the live tracked-error row — `errorType`,
   `message`, `subject`, `outcome` (the `see()` consequence), `kind`, `side`,
   `env`, `count`, `firstSeenAt`, `lastSeenAt`, `seenUrls[]`, `fingerprint`.
   (`count`/`lastSeenAt` reflect the current state, not file time.) The item
   `title` is the full see() sentence — "`<errorType>` causes the `<subject>`
   to `<outcome>`". For the full stack + extras, `GET related.error`.
2. **Grep for the consequence to find the throw.** When `subject`/`outcome`
   are set, search the codebase for the existing
   `see(e).causes_the("<subject>").to("<outcome>")` call — that's the throw
   site. If there's **no** such call, the throw is uninstrumented: locate it
   from `errorType`/`message`/`seenUrls`, fix the root cause, and **when the
   fix adds a catch block, instrument it** with `see(e).causes_the(…).to(…)`
   from `@shipeasy/sdk` (the `shipeasy-see` skill carries the rules) — a
   swallowed error that recurs silently is worse than the original.
3. **Note the fingerprint in your summary.** The underlying tracked error
   auto-resolves with the ticket and **reopens automatically if it recurs** —
   so flipping the ticket pre-deploy is safe; a real regression re-files
   itself rather than being lost.
