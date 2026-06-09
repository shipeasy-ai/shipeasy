---
description: Burn down the operational queue — bugs, feature requests, tracked production errors, and active alerts — one item at a time, each as its own atomic diff. With --pr, commits each item and opens one pull request that closes each connected GitHub issue and flips fixed bugs to ready_for_qa (the mode the scheduled trigger uses).
argument-hint: "[--type bug|feature|error|alert|all] [--status <s>] [--priority high|critical] [--limit <N>] [--pr] [--dry-run]"
---

The single end-to-end "work the inbox" loop. It unifies the old
`/shipeasy:bugs:fix` and `/shipeasy:feats:implement` and extends them to two
more sources the platform now produces on its own: tracked **production
errors** and active **alerts**. **Loop, do not batch.** Each item is its own
mini-investigation + fix; finishing one before starting the next keeps every
diff reviewable and avoids cross-item contamination.

Follow the `bugs` skill for triage semantics.

## Sources (`--type`, default `all`)

| `--type`  | Pulled with                       | Lifecycle action when done                          |
| --------- | --------------------------------- | --------------------------------------------------- |
| `bug`     | `shipeasy feedback bugs list`     | `bugs update <id> --status resolved\|ready_for_qa`  |
| `feature` | `shipeasy feedback features list` | manual flip → `shipped` (no CLI write; see below)   |
| `error`   | `shipeasy ops.errors list`        | `ops.errors` is read-only — fix lands in code only  |
| `alert`   | `shipeasy alerts list`            | `alerts` is read-only — fix lands in code only      |
| `all`     | all four, in the order above      | per-source as above                                 |

With `--type all` (default), process **bugs → features → errors → alerts**.
Bugs and errors are fix-first; features are design-first; alerts are
diagnose-first (an alert is a symptom — find the metric/killswitch/experiment
behind it, then decide whether code needs to change or it's an ops
acknowledgement).

Prereqs:

- `.shipeasy` bound. Run `/shipeasy:setup` first if missing. (Unattended runs
  — the scheduled trigger — instead authenticate from `SHIPEASY_CLI_TOKEN` +
  `SHIPEASY_PROJECT_ID` env vars; those substitute for the `.shipeasy` bind, so
  don't bail for a missing file when they're set.)
- `feedback` module enabled (`/shipeasy:ops:install`). `feedback bugs list`
  returning `403` means it isn't.
- CLI ≥ `1.8.0` — `shipeasy alerts` (added 1.8.0) and
  `shipeasy feedback bugs attachments` (1.4.0). Older CLIs fail on the
  alert/attachment steps; bump the CLI before retrying.
- Working tree clean **or** the user explicitly asked to work on top of WIP.
  If `git status --porcelain` is non-empty and the user hasn't confirmed,
  stop and ask — mixing per-item diffs with pre-existing WIP makes the
  commits unreviewable.

## 0. Build the work queue

Parse `$ARGUMENTS` up-front:

- `--type bug|feature|error|alert|all` — default `all`.
- `--status <s>` — per-source default (`open` for bugs/features, `active`
  for alerts, `open` for errors).
- `--priority high|critical` — bugs only (features use `--importance`).
- `--limit <N>` — default `20` (bugs/errors/alerts), `10` for features
  (features are heavier). Slice per-source after sort.
- `--pr` — packaging for unattended / scheduled runs: commit each item as its
  own focused commit, then open **one** pull request and link it back to every
  fixed bug. Applies the lifecycle deltas in [§2 PR mode](#2-pr-mode---pr).
  Without it (the default) the loop leaves the work uncommitted for you to
  review and commit yourself.
- `--dry-run` — print the combined queue and exit 0. No status flips, no
  edits, no attachment downloads, no commits.

Pull each requested source as JSON, then sort within each:

- **bug** — `priority desc` (`critical > high > medium > low > null`), then
  `createdAt asc`.
- **feature** — `importance desc` (`critical > important > nice_to_have`),
  then `createdAt asc`.
- **error** — `count desc`, then `lastSeenAt desc`.
- **alert** — `severity desc` (`danger > warn > info`), then `createdAt desc`.

Print one combined queue, grouped by source, before starting:

```
Queue:
  bugs (2):
    #abc12  critical  "Checkout 500 on iOS"      2026-06-01
    #def34  high      "Sidebar overflow"         2026-06-02
  features (1):
    #ghi56  important "CSV export for metrics"   2026-06-01
  errors (1):
    #jkl78  ×412      TypeError: undefined map   /checkout
  alerts (1):
    #mno90  danger    metric_rule: error_rate > 5%
```

If everything is empty: print "Nothing to work — queue is clear." and stop.
If `--dry-run`: stop here. The queue print is the deliverable.

Use TodoWrite to mirror the combined queue so progress survives a mid-loop
interruption.

## 1. Per-item strict loop

Do the steps below for **one** item, then restart with the next. Do not
interleave. Do not parallelise. Different items almost always touch different
files; serial keeps blame clean and lets the user halt mid-loop.

### 1a. Bugs

1. `shipeasy feedback bugs get "$ID" --json` — read `title`, `description`,
   `pageUrl`, `priority`, `context`, `attachments[]`.
2. `shipeasy feedback bugs attachments "$ID" --json` — download each. **Read
   screenshots into context** (the image renders to you). **Recordings**
   (`.webm`/`.mp4`) can't be watched — surface the `file://` path and ask
   whether screenshots+text suffice; don't silently skip.
3. `shipeasy feedback bugs update "$ID" --status in_progress` (skip if already).
4. Investigate from `pageUrl` / stack frame / screenshot text. Reproduce
   locally if the dev server is up. Reuse `superpowers:systematic-debugging`
   when the cause isn't obvious — don't guess.
5. Fix the **root cause**. No drive-by refactors, no swallowing, no deleting
   the failing assertion. Keep the diff scoped to this bug. Run the relevant
   gate (unit tests touching the file, `pnpm type-check` if TS changed, reload
   the page for UI fixes).
6. `--status resolved` only if confidently fixed + verified; `--status
   ready_for_qa` if it needs human verification. Can't fix? Leave it
   `in_progress`, write a one-paragraph hand-off note, move on. Never
   `wont_fix` without asking — that's a product call.

### 1b. Features

1. Pull the row from the already-fetched queue JSON (the CLI has no
   `features get`). Read `title`, `description`, `useCase`, `importance`,
   `pageUrl`. No attachments exist for features via CLI — surface any
   "see attached" reference as a gap.
2. **Design first** with `AskUserQuestion`: locate the surface area (grep
   keywords + `pageUrl`), propose 2–4 implementation shapes (file:line scope,
   behaviour delta, trade-off). Stop scope creep — propose the smallest shape
   that satisfies the use case; flag larger refactors as follow-ups.
3. Implement as **one atomic diff**. No half-finished work — if it genuinely
   can't land in one pass (missing API, schema change you can't apply), note
   the gap and skip; don't land a partial. Reuse existing utilities before
   adding abstractions. Run the gate (incl. an e2e spec for new UI workflows —
   see CLAUDE.md).
4. Flip to `shipped` **out-of-band** — the loop does not auto-PATCH. Prefer
   the dashboard; or note the manual `PATCH /api/admin/feature-requests/<id>`
   `{ "status": "shipped" }` for the user. Never `declined` without asking.

### 1c. Errors

1. `shipeasy ops.errors get "$ID" --json` — read `message`, `errorType`,
   `source`, `count`, `firstSeenAt`/`lastSeenAt`, and any stack/context.
2. Locate the throw site from the stack frame / message. Reproduce if
   feasible. Fix the root cause (same hard rules as bugs).
3. There's no status write — `ops.errors` is read-only. The fix lands as a
   code diff; the error stops recurring once deployed and ages out of the
   "open" view. Note the fingerprint in your summary so the user can confirm
   it drops off after deploy.

### 1d. Alerts

1. `shipeasy alerts get "$ID" --json` — read `severity`, `source`, `title`,
   `detail`, `observedValue`, `href`. `source` tells you the origin:
   - `metric_rule` — a user-defined threshold tripped. Open the metric
     (`shipeasy metrics list`), confirm the breach is real (not a bad
     threshold), and fix the underlying regression if there is one.
   - `experiment_srm` / `experiment_peek` — a sample-ratio mismatch or an
     early-peek warning on a running experiment. Usually an assignment or
     instrumentation bug — investigate, don't just acknowledge.
   - `guardrail` — a guardrail metric moved the wrong way. Treat like a bug
     in the change that moved it.
   - `killswitch_armed` — a killswitch is currently armed/tripped. This is
     often intentional (incident response) — confirm with the user before
     "fixing" anything.
2. Alerts are read-only via CLI and auto-resolve when the condition clears —
   there's no CLI write. If code needs to change, land the fix as its own
   atomic diff; if it's an ops acknowledgement, say so and move on. Rule
   *definitions* live in the dashboard Settings → Alerts UI (no CLI surface).

### 1e. Report and continue

One short paragraph per item, then the next:

```
✔ <id> [<type>] "<title>" → <resolved|ready_for_qa|shipped|fixed-in-code|acknowledged>
  Cause:  <one line>
  Fix:    <files changed, one line each | "no code change — ops ack">
  Verify: <test cmd | dev-server URL | "manual" | "watch fingerprint drop off">
```

## 2. PR mode (`--pr`)

Only when `--pr` is passed. This is what turns the interactive loop into a
self-contained, reviewable unit of work — and it's the mode the scheduled
trigger (`/shipeasy:ops:create_trigger`) runs unattended. Deltas to the loop
above:

1. **Commit per item.** Right after an item is fixed **and verified**, commit
   exactly that item's diff — one focused commit each, never batched, never
   `--no-verify`:

   ```
   git commit -m "<type>(<scope>): <title> (shipeasy #<id-prefix>)"
   ```

   `<type>` follows the item: `fix` for bugs and errors, `feat` for features,
   `fix`/`chore` for alert-driven changes. An item with no code change (ops
   acknowledgement) produces no commit.

2. **Bug lifecycle → `ready_for_qa`.** In PR mode a human reviews the PR, so
   never auto-`resolved` — set fixed bugs to `ready_for_qa`. Features stay
   manual-`shipped` (after merge); errors/alerts keep no status write.

3. **Note any connected GitHub issue — this is the only PR↔item linkage.**
   Bugs and features opened through the GitHub connector already carry their
   issue on `connectorData.github.issue` in `… get --json`
   (`{ number, url, owner, repo }`) — the connector created it upfront at intake.
   Read it while working the item and remember the issue `number` — the PR's
   `Closes #N` keyword (item 4) is what links the PR to the work and auto-closes
   the issue on merge. Items with no connector issue simply have nothing to
   close; their only server-side trace is the bug status flip (item 2). **Do not
   create issues yourself, and do not call `link-pr`** — the unattended trigger
   runs under a restricted `ops` key that can only flip bug/feature status, so a
   `link-pr` (or any other admin write) would `403` and break the run.

4. **One PR at the end.** After the loop, open exactly **one** pull request for
   the whole run — Claude Code's built-in GitHub PR tooling, or `gh pr create`
   when `gh` is installed (an unattended cloud routine has neither a local `gh`
   nor needs one; the built-in tooling opens the PR through the GitHub proxy).
   The body is the punch-list — every item with
   its id and outcome (fixed / skipped-with-reason) — and, for each item that
   had a connected issue, a closing keyword on its own line so merging the PR
   **auto-closes that issue**:

   ```
   Closes #<issue-number>
   ```

   One line per linked issue (`Closes` / `Fixes` / `Resolves` all work). Never
   auto-merge; the PR lands for human review.

5. **Empty queue → no PR.** If nothing was worked, exit cleanly without a
   branch or PR.

## 3. Final report

```
Processed N items (bugs X, features Y, errors Z, alerts W).
  resolved / ready_for_qa:     …
  implemented (await shipped):  …
  fixed-in-code (errors):       …
  acknowledged / no-op:         …
  left unresolved (gap noted):  …
Diff footprint:
$(git diff --stat)
```

Show the diff stat. **Default (no `--pr`): do not `git commit` or `git push`**
— the user reviews and commits. **With `--pr`:** the per-item commits and the
single PR from [§2](#2-pr-mode---pr) are the deliverable; still never merge and
never push straight to the default branch (open the PR, that's it).

## Rules

- **One item at a time.** Loop, never parallelise.
- **Never delete anything.** Resolving / shipping / fixing-in-code are the
  terminal states. Deletion of a feedback record is a human call made in the
  UI — see `/shipeasy:ops:list`. (This plugin no longer ships any delete
  command for any resource.)
- **Never flip `wont_fix` / `declined` without asking** — product decisions.
- **Recordings need human acknowledgement** — don't claim a bug fixed if you
  skipped its recording.
- **Killswitch-armed alerts are usually intentional** — confirm before acting.
- **Stop the loop on the first auth/permission error.** A `401`/`403` means
  the binding or feedback module is wrong — don't burn the whole queue
  reproducing the same failure.
