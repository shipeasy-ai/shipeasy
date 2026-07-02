---
name: shipeasy-ops-work
description: Burn down the operational queue — the unified feedback table of bugs, feature requests, and auto-filed error/alert tickets — one item at a time, each as its own atomic diff. With --pr, commits each item on its own branch and opens one pull request PER item, each closing its connected GitHub issue and flipping the item to ready_for_qa (the mode the scheduled trigger uses).
argument-hint: "[--type bug|feature|error|alert|measure_plan|all] [--status <s>] [--priority high|critical] [--limit <N>] [--pr] [--dry-run]"
user-invocable: true
---

The single end-to-end "work the inbox" loop. **The queue is ONE table** — the
project's unified `feedback` queue — holding five item types:

| type              | filed by                                                | what it is                                            |
| ----------------- | ------------------------------------------------------- | ----------------------------------------------------- |
| `bug`             | humans (devtools nub, public widget, CLI, dashboard)     | a bug report                                           |
| `feature_request` | humans                                                   | a feature request                                      |
| `error`           | **the platform** (auto-filed)                            | a tracked production error crossed the occurrence threshold |
| `alert`           | **the platform** (auto-filed)                            | an alert transitioned to active (metric rule, SRM/peek, guardrail) |
| `measure_plan`    | **the website assistant** (auto-filed)                   | a measurement plan: instant resources already created; the event instrumentation it depends on is code you implement |

Error/alert tickets arrive with the investigation context baked into
`description` + `context` (`context.error.{id,fingerprint}` /
`context.alert.{source,dedupeKey,…}`) — the raw `errors`/`alerts` sources are
for *diagnosis* while working a ticket, not for building the queue.

`measure_plan` tickets come from the in-dashboard assistant, which can create
metrics/experiments/alert rules over the API but **can't edit the repo** — it
created what it could and filed the rest here for you. Read
`context.measurePlan`:

- `created[]` — resources already live (`{kind,id,name}`); don't recreate them.
- `pending[]` — resources it couldn't make yet (usually a metric whose backing
  event isn't emitted); create these **after** you add the instrumentation.
- `instrumentation[]` — the code work: for each, emit the `event` at the place
  `detail` describes (follow the `flags`/`experiments` skills for the SDK call).

Working one: implement the `instrumentation[]` events, create the `pending[]`
resources, verify the `created[]` metrics now bind to a real event, then ship
it like any other item.

**Loop, do not batch.** Each item is its own mini-investigation + fix;
finishing one before starting the next keeps every diff reviewable and avoids
cross-item contamination. Follow the `shipeasy-ops` skill for triage semantics.

Binding, auth (interactive and unattended), CLI updates, and module enablement
are the `shipeasy-common` skill (module install: `shipeasy-ops-install`) — not
restated here.

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

Use TodoWrite to mirror the queue so progress survives a mid-loop
interruption.

## 1. Per-item strict loop

Do the steps below for **one** item, then restart with the next. Do not
interleave. Do not parallelise. Different items almost always touch different
files; serial keeps blame clean and lets the user halt mid-loop.

Every item — **any type** — takes the same status write:
`shipeasy ops update <handle> --status <status>` (the `<handle>` is the
per-item `#number` or the full id; the API resolves either).
Flip to `in_progress` when you start an item.

### 1a. Bugs

1. `shipeasy ops get <handle>` — read `title`, `description`,
   `pageUrl`, `priority`, `context`, `attachments[]`.
2. For each entry in `attachments[]`, fetch its URL. **Read screenshots into
   context** (the image renders to you). **Recordings** (`.webm`/`.mp4`) can't
   be watched — surface the path and ask whether screenshots+text suffice;
   don't silently skip.
3. Flip to `in_progress` (skip if already):
   `shipeasy ops update <handle> --status in_progress`.
4. Investigate from `pageUrl` / stack frame / screenshot text. Reproduce
   locally if the dev server is up. Reuse `superpowers:systematic-debugging`
   when the cause isn't obvious — don't guess.
5. Fix the **root cause**. No drive-by refactors, no swallowing, no deleting
   the failing assertion. Keep the diff scoped to this bug. Run the relevant
   gate (unit tests touching the file, `pnpm type-check` if TS changed, reload
   the page for UI fixes).
6. `--status resolved` only if confidently fixed + verified; `--status
   ready_for_qa` if it needs human verification. Can't fix? Leave it
   `in_progress`, write a one-paragraph hand-off note, **and
   [escalate](#escalate-raise-a-bell-notification-when-the-fix-isnt-in-code)**
   — then move on.

### 1b. Features

1. Read `title`, `description`, `useCase`, `priority`, `pageUrl` from the
   queue JSON.
2. **Design first** with `AskUserQuestion` (interactive runs only — unattended
   runs pick the smallest shape): locate the surface area (grep keywords +
   `pageUrl`), propose 2–4 implementation shapes (file:line scope, behaviour
   delta, trade-off). Stop scope creep — propose the smallest shape that
   satisfies the use case; flag larger refactors as follow-ups.
3. Implement as **one atomic diff**. No half-finished work — if it genuinely
   can't land in one pass (missing API, schema change you can't apply), note
   the gap,
   **[escalate](#escalate-raise-a-bell-notification-when-the-fix-isnt-in-code)**
   with the blocker + next steps, and skip; don't land a partial. Reuse
   existing utilities before adding abstractions. Run the gate (incl. an e2e
   spec for new UI workflows — see CLAUDE.md).
4. Flip to `ready_for_qa` when implemented; `resolved` is the human's call
   after it ships.

### 1c. Error tickets

1. The ticket's `description` already carries the consequence, count, seen
   URLs, fingerprint, and stack head; `context.error.{id,fingerprint}` ties it
   to the underlying tracked error. Re-read the ticket any time with
   `shipeasy ops get <handle>`.
2. Locate the throw site from the stack frame / message. Reproduce if
   feasible. Fix the root cause (same hard rules as bugs). When the fix adds
   a catch block, instrument it with `see(e).causes_the(…).to(…)` from
   `@shipeasy/sdk` (see the `shipeasy-see` skill for consequence-writing rules).
3. Flip the ticket when the fix lands. The underlying tracked error
   auto-resolves with the ticket and **reopens automatically if it recurs**,
   so this is safe pre-deploy. Note the fingerprint in your summary.

### 1d. Alert tickets

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
   **escalate** with the exact new values.

### 1e. Report and continue

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
trigger (the `shipeasy-ops-trigger` skill) runs unattended. Deltas to the loop
above:

1. **One branch + one PR per item.** Right after an item is fixed **and
   verified**:

   ```
   git checkout <default-branch> && git checkout -b ops/<number>-<slug>
   git commit -m "<type>(<scope>): <title> (shipeasy #<number>)"   # one focused commit, never --no-verify
   ```

   then open the pull request for **that item alone** (Claude Code's built-in
   GitHub PR tooling, or `gh pr create` when `gh` is installed), and return to
   the default branch before starting the next item. Branch each item off the
   default branch — never stack item branches. In unattended cloud-routine
   runs name branches `claude/ops-<number>-<slug>` (routines may only push
   `claude/`-prefixed branches). `<type>` follows the item:
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
  states; deletion is a human call made in the UI (see `shipeasy-common`).
- **Never flip `wont_fix` without asking** — product decision.
- **Recordings need human acknowledgement** — don't claim a bug fixed if you
  skipped its recording.
- **Stop the loop on the first auth/permission error.** A `401`/`403` means
  the binding or feedback module is wrong (`shipeasy-common` /
  `shipeasy-ops-install`) — don't burn the whole queue reproducing the same
  failure.
