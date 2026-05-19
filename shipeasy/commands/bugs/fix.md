---
description: Pull all open Shipeasy bugs for the bound project and fix them one-by-one. Each successful fix flips the bug status to `ready_for_qa`.
argument-hint: "[--priority high|critical] [--limit N] [--dry-run]"
---

You are running an automated bug-fix loop against the Shipeasy `feedback`
module. Pull every **open** bug for the bound project, fix them
sequentially, and mark each one `ready_for_qa` after the fix lands.

## Prereq

- `.shipeasy` present at the repo root (run `/shipeasy:install` if not).
- `feedback` module enabled (`/shipeasy:bugs:install`).
- Working tree clean OR user explicitly asked to fix on top of WIP. Stop
  and ask if `git status` is dirty and the user hasn't confirmed.

## 1. Pull the queue

```bash
shipeasy feedback bugs list --status open --json
```

Optional filters from `$ARGUMENTS`:

- `--priority high|critical` → append `--priority <value>`.
- `--limit N` → slice the JSON array to first N after sort.

Sort the JSON by `priority` (`critical` > `high` > `medium` > `low` > null),
then `createdAt` ascending. This is the work queue. Print a one-line
summary per bug before starting:

```
Queue (3):
  #abc12  critical  "Checkout 500 on iOS"   2026-05-17
  #def34  high      "Sidebar overflow"      2026-05-17
  #ghi56  medium    "Typo on /pricing"      2026-05-16
```

If `--dry-run` was passed, stop here and exit 0.

## 2. Loop — one bug at a time

For each bug in queue order:

1. **Fetch full detail** (steps to repro, expected/actual, page URL,
   priority, context blob):

   ```bash
   shipeasy feedback bugs get <id> --json
   ```

2. **Move to in_progress** so the dashboard reflects active work:

   ```bash
   shipeasy feedback bugs update <id> --status in_progress
   ```

3. **Diagnose + fix.** Treat the bug body as the spec. Use the
   `superpowers:systematic-debugging` skill if the root cause is not
   obvious. Hard rules:
   - No drive-by refactors. Touch only what the bug requires.
   - No silencing — fix the root cause, don't catch+swallow.
   - If the bug needs information you don't have (repro on a real
     device, a customer-only env), **skip it**: leave status
     `in_progress`, add a CLI comment explaining what's missing, move on.

4. **Verify** the fix the way the bug describes the symptom — failing
   test that now passes, the page that now renders, the request that
   now returns 200. Run `pnpm --filter <pkg> test` (or the
   project-appropriate suite) before flipping status.

5. **Flip to ready_for_qa**:

   ```bash
   shipeasy feedback bugs update <id> --status ready_for_qa
   ```

   This is the new status added for this command — it tells QA / triage
   "developer says fixed, please verify in the dashboard."

6. **Stage but do not commit.** Run `git add -p` interactively in your
   head — stage only the files actually related to this bug. Commit
   one bug per commit so review and revert stay clean:

   ```bash
   git commit -m "fix(<scope>): <bug title> (shipeasy #<id-prefix>)"
   ```

   Use the bug's title for the message body. Reference the bug id
   (first 8 chars is fine) so triage can audit.

## 3. After the loop

Report a punch-list to the user:

```
Done. <N> bugs fixed, <M> skipped.
Fixed:
  #abc12  ready_for_qa   commit a3f2b91
  #def34  ready_for_qa   commit 88c014e
Skipped:
  #ghi56  in_progress    needs iOS device to reproduce
```

**Do not push.** The user pushes after reviewing commits.

## Hard rules

- Never set a bug to `resolved` — that is a QA-only transition. The
  fix command stops at `ready_for_qa`.
- Never delete a bug. Triage happens in the dashboard.
- Never batch multiple bugs into one commit.
- Never use `--no-verify` on the commit. If a pre-commit hook fails,
  fix the underlying issue or revert and skip the bug.
- Never edit `BUG_STATUSES` in [packages/core/src/db/schema.ts](packages/core/src/db/schema.ts) — `ready_for_qa` is already there.
