---
name: shipeasy-ops-work
description: Load this skill FIRST — before calling any ops MCP tool — whenever the task is to actively RESOLVE the operational queue (the unified feedback table of bugs, feature requests, and auto-filed error/alert tickets) one item at a time, each as its own atomic diff — it carries the required list-then-get-then-work loop. Use this ONLY when the ask is to WORK items down / fix / resolve / pick up an item and act on what it needs, never merely to view a summary or file. Trigger on "burn down the queue", "work the (ops) queue", "start working/fixing the open bugs", "pick up/work the top/next/highest-priority item", "clear the backlog one item at a time", "work items down", "--pr per item". NOT for "what's open" or "file/log a bug" — merely listing or filing one item is shipeasy-ops. With --pr, commits each item on its own branch and opens one pull request PER item, each closing its GitHub issue and flipping the item to ready_for_qa.
argument-hint: "[--type bug|feature|error|alert|measure_plan|all] [--status <s>] [--priority high|critical] [--limit <N>] [--pr] [--dry-run]"
user-invocable: true
---

The single end-to-end "work the inbox" loop. **The queue is ONE table** — the
project's unified `feedback` queue — holding five item types:

| type              | filed by                                                | what it is                                            | runbook                          |
| ----------------- | ------------------------------------------------------- | ----------------------------------------------------- | -------------------------------- |
| `bug`             | humans (devtools nub, public widget, CLI, dashboard)     | a bug report                                           | <references/bugs.md>             |
| `feature_request` | humans                                                   | a feature request                                      | <references/features.md>         |
| `error`           | **the platform** (auto-filed)                            | a tracked production error crossed the occurrence threshold | <references/errors.md>      |
| `alert`           | **the platform** (auto-filed)                            | an alert transitioned to active (metric rule, SRM/peek, guardrail) | <references/alerts.md> |
| `measure_plan`    | **the website assistant** (auto-filed)                   | a measurement plan: instant resources already created; the event instrumentation it depends on is code you implement | <references/measure-plans.md> |

`ops get` returns a hydrated item: bug/feature carry `context.browser` +
`attachments[]` (each with a `fetchUrl`), error tickets carry a full
`context.error` (consequence `subject`/`outcome`, `count`, `seenUrls`, …),
alert tickets a full `context.alert` (the tripped `rule` + the `metric` and
its backing `events[]`), and every item a `related{}` block of deep links.
The per-type runbook says which fields to read and how to pivot from them into
the code.

**Loop, do not batch.** Each item is its own mini-investigation + fix;
finishing one before starting the next keeps every diff reviewable and avoids
cross-item contamination. Follow the `shipeasy-ops` skill for triage semantics.

This flow needs a `.shipeasy` binding, auth (interactive and unattended), and
the feedback module enabled (`shipeasy install ops`) — those prerequisites are
not restated here.

The commands named below (`ops list/get/update/link-pr/notify`, MCP twins
`ops_list`/`ops_get`/`ops_update`/`ops_link-pr`/`ops_notify`) are
**references, not exact syntax**. The tool docs carry the full argument
documentation and examples — confirm with `shipeasy ops <cmd> --help` or the
MCP tool schema before the first call of each; this skill only carries the
loop semantics the tool docs don't.

## 0. Build the work queue

Parse `$ARGUMENTS` up-front:

- `--type bug|feature|error|alert|measure_plan|all` — default `all` (`feature`
  maps to `feature_request`).
- `--status <s>` — default `open`. Pass `all` for every workable status.
- `--priority high|critical` — filter after pull (any type; priorities are
  shared).
- `--limit <N>` — default `20`. Slice after pull.
- `--pr` — packaging for unattended / scheduled runs: one branch, one focused
  commit, one **pull request per item** ([§2](#2-pr-mode---pr)). Without it
  (the default) the loop leaves the work uncommitted for you to review and
  commit yourself.
- `--dry-run` — print the queue and exit 0. No status flips, no edits, no
  attachment downloads, no commits.

Check the working tree: it must be clean (`git status --porcelain`) **or** the
user explicitly asked to work on top of WIP — otherwise stop and ask; mixing
per-item diffs with pre-existing WIP makes the commits unreviewable.

Pull the queue in one `ops list` call over the unified table, filtered per the
parsed arguments (pull up to 200; slice locally). The response is already in
work order — **work it top-down**. **Never call the admin HTTP API with
`curl`** — every step in this loop has a `shipeasy` command / MCP tool; use it.

Print the queue, grouped by type, before starting:

```
Queue:
  bugs (2):
    #12  critical  "Checkout 500 on iOS"               2026-06-01
    #15  high      "Sidebar overflow"                  2026-06-02
  features (1):
    #13  medium    "CSV export for metrics"            2026-06-01
  errors (1):
    #16  critical  "TypeError: undefined map …"        auto-filed, ×412
  alerts (1):
    #17  critical  "error_rate > 5% (24h)"             auto-filed
```

If everything is empty: print "Nothing to work — queue is clear." and stop.
If `--dry-run`: stop here. The queue print is the deliverable.

Track the queue as a checklist (a todo list, if your agent has one) so
progress survives a mid-loop interruption.

## 1. Per-item strict loop

Do the steps below for **one** item, then restart with the next. Do not
interleave. Do not parallelise. Different items almost always touch different
files; serial keeps blame clean and lets the user halt mid-loop.

Every item — **any type** — takes the same status write:
`shipeasy ops update <handle> --status <status>` (the `<handle>` is the
per-item `#number` or the full id; the API resolves either).
Flip to `in_progress` when you start an item.

### 1a. Work the item per its type runbook

Each type has its own runbook — the `runbook` column in the queue table
above. **Read the runbook before working the first item of that type**
(bugs → `references/bugs.md`, features → `references/features.md`,
errors → `references/errors.md`, alerts → `references/alerts.md`,
measure plans → `references/measure-plans.md`). Each runbook carries **only
the type-specific flow** — how to read, investigate, and shape the fix for
that item type. The mechanics below are shared by **every type** and are NOT
repeated in the runbooks:

- **One atomic diff.** Every item ships as a single, root-cause fix scoped to
  this item — no drive-by refactors, no swallowing, no deleting the failing
  assertion, no half-finished work. If it genuinely can't land in one pass,
  note the gap, **[escalate](#escalate-raise-a-bell-notification-when-the-fix-isnt-in-code)**,
  and skip; don't land a partial.
- **Run the gate.** Unit tests touching the file, `pnpm type-check` if TS
  changed, reload the page for UI fixes, an e2e spec for new UI workflows —
  follow the repo's own contributor/test conventions.
- **Status lifecycle (every type).** `in_progress` when you start (§1);
  `resolved` only if confidently fixed + verified, else **`ready_for_qa` when
  implemented** and a human must verify (in `--pr` mode always `ready_for_qa`,
  never auto-`resolved` — [§2](#2-pr-mode---pr).5). Can't fix? Leave it
  `in_progress` with a one-paragraph hand-off note **and
  [escalate](#escalate-raise-a-bell-notification-when-the-fix-isnt-in-code)**
  — then move on.

### 1b. Report and continue

One short paragraph per item, then the next:

```
✔ #<number> [<type>] "<title>" → <resolved|ready_for_qa|fixed-in-code|acknowledged>
  Cause:  <one line>
  Fix:    <files changed, one line each | "no code change — ops ack">
  Verify: <test cmd | dev-server URL | "manual" | "watch fingerprint drop off">
  Notify: <"raised: <title>" when you escalated via ops notify | "—">
  PR:     <url | "—">
```

## Dev operations the ops key CAN do

While working an item you sometimes need a platform resource around the fix.
The restricted `ops` key is allow-listed for **create-only** dev operations
and i18n publishing — always reach them through the CLI / the matching skill,
never a raw HTTP call:

- **Create** gates, dynamic configs, experiments, kill switches, events,
  metrics, and alert rules — the `*_create` MCP tools / `shipeasy … create`
  commands (the `experiments`/`metrics` skills carry the design flows).
  Typical uses: wrap a risky fix in a fresh gate, add the event + metric a
  fix needs for verification, add an alert rule that would have caught the
  regression.
- **Push + publish i18n keys** — `shipeasy i18n push` (insert-only) +
  `shipeasy i18n publish` (or the `shipeasy-i18n` skill) — so a fix that adds
  user-visible copy can ship its keys.

It **cannot** update, archive, or delete any existing resource (every
PATCH/PUT/DELETE on gates/configs/experiments/… is denied), mint keys, or
touch projects/members/billing. If an item genuinely requires mutating an
existing resource, note it in the hand-off instead of fighting the 403.

## Escalate: raise a bell notification when the fix isn't in code

A hand-off note in your run report is ephemeral — nobody reads it unless they
read the transcript, and unattended trigger runs have no reader at all.
**Whenever an item can't be fixed in code, raise a notification** so the human
sees it on the dashboard bell. This is the durable escalation channel.

Fire it when — and only when — the work genuinely isn't yours to land in code:

- a missing credential / device / prod-only env you can't reproduce against;
- a **product decision** (anything you'd otherwise `wont_fix`) or a
  prioritisation call;
- an env var, network/allowlist, billing, or **alert-rule definition** knob
  that only a human (not the ops key) can change;
- a bug whose only repro is a **recording you can't watch**;
- an existing resource that must be mutated (the ops key is create-only).

Escalate with `ops notify`. Its tool docs carry the full example and field
docs — markdown rendering, the 3–6 self-contained steps, the entity tokens
(`#42`, `@gate:<name>`, `@metric:<name>`, …) that render as live hover chips.
Loop specifics on top of them: write steps for a human who reads **only this
card**, not your transcript, and end them with "re-run the shipeasy-ops-work
skill"; pass `--dedupe-key "feedback:<number>"` and `--href` to the item's
dashboard page, so re-running the loop over the same still-blocked item
updates the one card instead of stacking duplicates.

**Escalating does not replace the status write.** Still leave the item
`in_progress` with its hand-off note (bugs/features) — or `resolved` with a
one-line note when it's a genuine ops acknowledgement (an alert with no code
change). The notification is the *visibility*; the status is the *record*. An
escalation produces no branch, commit, or PR.

## 2. PR mode (`--pr`)

Only when `--pr` is passed. This is what turns the interactive loop into
self-contained, reviewable units of work — and it's the mode the scheduled
trigger (set up via `shipeasy setup triggers`) runs unattended. Deltas to the loop
above:

1. **One branch + one PR per item.** Right after an item is fixed **and
   verified**:

   ```
   git checkout <default-branch> && git checkout -b ops/<number>-<slug>
   git commit -m "<type>(<scope>): <title> (shipeasy #<number>)"   # one focused commit, never --no-verify
   ```

   then open the pull request for **that item alone** (`gh pr create` when
   `gh` is installed, or your agent's built-in PR tooling), and return to the
   default branch before starting the next item. Branch each item off the
   default branch — never stack item branches. Some hosted runners only allow
   pushing branches under a reserved prefix — if yours does, use it
   (e.g. `<prefix>/ops-<number>-<slug>`). `<type>` follows the item:
   `fix` for bugs and error tickets, `feat` for features, `fix`/`chore` for
   alert-driven changes. An item with no code change (ops acknowledgement)
   produces no branch, no commit, and no PR.

2. **Link the PR back to the item.** Right after the PR is opened, record its
   number + url on the item with `ops link-pr` — pass the real PR number and
   url the previous step printed, so it shows as a deep-linking `PR <n>` badge
   in the dashboard feedback table. This is the ONLY feedback write beyond
   status the ops key may do — it touches `connector_data.github.pr` only.

3. **PR body = that item's story + its closing keyword.** The body carries
   the item's id/number, cause, fix, and verification notes. If the item has
   a connected GitHub issue (see 4), put the closing keyword on its own line
   so merging the PR **auto-closes that issue**:

   ```
   Closes #<issue-number>
   ```

   (`Closes` / `Fixes` / `Resolves` all work.) Never auto-merge; every PR
   lands for human review.

4. **Where the issue number comes from.** Items opened through the GitHub
   connector already carry their issue on `connectorData.github.issue`
   (`{ number, url, owner, repo }`) — the connector created it upfront at
   intake. Items with no connector issue simply have nothing to close; their
   only server-side trace is the status flip + the linked PR (step 2).
   **Do not create issues yourself.**

5. **Lifecycle → `ready_for_qa`.** In PR mode a human reviews each PR, so
   never auto-`resolved` — flip every fixed item (any type) to
   `ready_for_qa`.

6. **Empty queue → no PRs.** If nothing was worked, exit cleanly without a
   branch or PR.

## 3. Final report

```
Processed N items (bugs X, features Y, errors Z, alerts W).
  resolved / ready_for_qa:      …
  fixed-in-code:                …
  acknowledged / no-op:         …
  left unresolved (gap noted):  …
Notifications raised:           <one line per escalation: #item — what's blocked>
Pull requests opened:           <one line per PR: url — item>
Diff footprint:
$(git diff --stat)
```

Show the diff stat. **Default (no `--pr`): do not `git commit` or `git push`**
— the user reviews and commits. **With `--pr`:** the per-item branches and PRs
from [§2](#2-pr-mode---pr) are the deliverable; still never merge and never
push straight to the default branch.

## Rules

- **One item at a time.** Loop, never parallelise.
- **One PR per item in `--pr` mode.** Never bundle two items into one PR.
- **Never delete anything.** Resolving / fixing-in-code are the terminal
  states; deletion is a human call made in the UI.
- **Never flip `wont_fix` without asking** — product decision.
- **Recordings need human acknowledgement** — don't claim a bug fixed if you
  skipped its recording.
- **Stop the loop on the first auth/permission error.** A `401`/`403` means
  the binding or feedback module is wrong (`shipeasy install ops`) — don't burn
  the whole queue reproducing the same
  failure.
