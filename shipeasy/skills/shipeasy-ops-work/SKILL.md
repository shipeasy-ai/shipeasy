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

Error/alert tickets are created automatically with the investigation context
baked into `description` + `context` (`context.error.{id,fingerprint}` /
`context.alert.{source,dedupeKey,…}`) — you no longer pull the raw
`errors`/`alerts` sources to build the queue; those stay available for
*diagnosis* while working a ticket.

`measure_plan` tickets come from the in-dashboard assistant, which can create
metrics/experiments/alert rules over the API but **can't edit the repo** — so
it created what it could on the spot and filed the rest here for you. Read
`context.measurePlan`:

- `created[]` — resources already live (`{kind,id,name}`); don't recreate them.
- `pending[]` — resources it couldn't make yet (usually a metric whose backing
  event isn't emitted); create these **after** you add the instrumentation.
- `instrumentation[]` — the code work: for each, emit the `event` at the place
  `detail` describes (follow the `flags`/`experiments` skills for the SDK call).

Working a `measure_plan`: implement the `instrumentation[]` events in code,
register/create any `pending[]` resources, verify the `created[]` metrics now
bind to a real event, then ship it like any other item (in `--pr` mode: one
branch + PR, flip to `ready_for_qa`). This is the Claude-Code half of the split
— the assistant filed the ticket precisely because it could not do this part.

**Loop, do not batch.** Each item is its own mini-investigation + fix;
finishing one before starting the next keeps every diff reviewable and avoids
cross-item contamination. Follow the `shipeasy-ops` skill for triage semantics.

Prereqs:

- `.shipeasy` bound. Run the `shipeasy-setup` skill first if missing. (Unattended runs
  — the scheduled trigger — authenticate from the `SHIPEASY_CLI_TOKEN` +
  `SHIPEASY_PROJECT_ID` env vars the routine prompt exports per shell (a
  restricted `ops` key + project id; the CLI config file works too). That
  substitutes for `shipeasy login`, **not** for the `.shipeasy` bind — status
  writes still require `.shipeasy` in the checkout, so the trigger prompt
  creates it when the repo doesn't ship one. Don't bail for a missing
  `.shipeasy` before checking whether creds are already present.)
- `feedback` module enabled (the `shipeasy-ops-install` skill). `shipeasy ops
  list --type bug` returning `403` means it isn't.
- CLI ≥ `1.12.0` — the unified `shipeasy ops list` / `ops get` / `ops update` /
  `ops link-pr` and `ops notify` (the escalation bell) commands this loop
  drives. The scheduled trigger runs `npx @shipeasy/cli@latest`, so it always
  has them; for a local run, `shipeasy ops notify --help` failing means the CLI
  is too old (`npm i -g @shipeasy/cli@latest`).
- Working tree clean **or** the user explicitly asked to work on top of WIP.
  If `git status --porcelain` is non-empty and the user hasn't confirmed,
  stop and ask — mixing per-item diffs with pre-existing WIP makes the
  commits unreviewable.

## 0. Build the work queue

Parse `$ARGUMENTS` up-front:

- `--type bug|feature|error|alert|measure_plan|all` — default `all` (`feature`
  maps to `feature_request`).
- `--status <s>` — default `open`. Pass `all` to include everything **except
  `pending_approval`** (see the approval gate below).
- `--priority high|critical` — filter after pull (any type; priorities are
  shared).
- `--limit <N>` — default `20`. Slice after sort.
- `--pr` — packaging for unattended / scheduled runs: each fixed item gets its
  own branch, its own focused commit, and its **own pull request**. Applies
  the lifecycle deltas in [§2 PR mode](#2-pr-mode---pr). Without it (the
  default) the loop leaves the work uncommitted for you to review and commit
  yourself.
- `--dry-run` — print the queue and exit 0. No status flips, no edits, no
  attachment downloads, no commits.

Pull the queue with the CLI — one command over the unified table, covering all
four types (`error`/`alert` tickets included):

```
shipeasy ops list --type <bug|feature_request|error|alert|all> --status <status|all> --limit 200
```

`ops list` already sorts by `priority desc` (`critical > high > medium >
nice_to_have > null`) then `createdAt asc` — the queue order. (Output is
JSON; `shipeasy ops list --help` for the filters. Filter the two
human-filed types with `--type bug` / `--type feature_request`.)
**Never call the admin HTTP API with `curl`** — every step in this loop has a
`shipeasy` command; use it (the CLI handles auth + the `.shipeasy` binding).

**The `pending_approval` gate — never work these.** Some items land in a
`pending_approval` status: a pre-open holding state for inbound that a human must
sign off before any code is written (e.g. connector requests filed from a
customer's connectors panel land here in Shipeasy's own project). **Drop every
`pending_approval` row from the queue** — do not investigate, fix, status-flip,
or PR them, *even when `--status all` was passed*. They are approved by a human
in the dashboard moving them to `open` (the orange "Pending approval" badge +
hovercard mark them); once `open`, they flow through this loop like any other
item. If a `--status pending_approval` run is requested explicitly, print the
list and stop — surfacing them for review is fine; working them is not.

**The `triage` gate — never work these either.** Questions and error messages
users submit to the "Stuck in onboarding?" assistant land as `triage` rows in
Shipeasy's own project (rose "Triage" badge). They are onboarding-friction
signal for a human to read and turn into docs/product fixes, not actionable
tickets. **Drop every `triage` row from the queue** — same rule as
`pending_approval`: do not investigate, fix, status-flip, or PR them, *even when
`--status all` was passed*. A human triages them in the dashboard (moving the
real ones to `open` with a proper title); only then do they flow through this loop.

Print the combined queue, grouped by type, before starting:

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
   `in_progress`, write a one-paragraph hand-off note, **and raise a
   notification** (see [Escalate](#escalate-raise-a-bell-notification-when-the-fix-isnt-in-code))
   so the human sees what you need — then move on. Never `wont_fix` without
   asking — that's a product call (and itself a reason to escalate).

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
   the gap, **raise a notification** with the blocker + next steps (see
   [Escalate](#escalate-raise-a-bell-notification-when-the-fix-isnt-in-code)),
   and skip; don't land a partial. Reuse existing utilities before adding
   abstractions. Run the gate (incl. an e2e spec for new UI workflows — see
   CLAUDE.md).
4. Flip to `ready_for_qa` when implemented; `resolved` is the human's call
   after it ships. Never `wont_fix` without asking.

### 1c. Error tickets

1. The ticket's `description` already carries the consequence, count, seen
   URLs, fingerprint, and stack head; `context.error.{id,fingerprint}` ties it
   to the underlying tracked error. Re-read the ticket any time with
   `shipeasy ops get <handle>` (`context.error` holds the stack head +
   fingerprint).
2. Locate the throw site from the stack frame / message. Reproduce if
   feasible. Fix the root cause (same hard rules as bugs). When the fix adds
   a catch block, instrument it with `see(e).causes_the(…).to(…)` from
   `@shipeasy/sdk` (see the `shipeasy-see` skill for consequence-writing rules).
3. Flip the ticket when the fix lands:
   `shipeasy ops update <handle> --status resolved` (or `ready_for_qa` in PR
   mode). The underlying tracked error auto-resolves with the ticket and
   **reopens automatically if it recurs** (re-filing a ticket if it climbs
   back over the threshold), so this is safe pre-deploy. Note the fingerprint
   in your summary.

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
   and flip the ticket (`shipeasy ops update <handle> --status resolved`,
   or `ready_for_qa` in PR mode). If it's an ops acknowledgement (bad
   threshold, expected spike), say so and flip the ticket to `resolved` with a
   one-line note in your summary. Rule *definitions* can be tuned via the
   `ops_alerts_update` MCP tool / `shipeasy ops alerts update` by a human — the
   ops key cannot edit them, so when
   the right fix IS a rule change, **raise a notification** spelling out the new
   threshold/comparator/window (see
   [Escalate](#escalate-raise-a-bell-notification-when-the-fix-isnt-in-code)).

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
  metrics, and alert rules — through the `shipeasy` MCP tools
  (`release_flags_create`, `release_configs_create`, `release_experiments_create`,
  `release_killswitch_create`, `metrics_events_create`, `metrics_create`,
  `ops_alerts_create`) or the equivalent CLI (`shipeasy release flags create`,
  `… configs create`, `… experiments create`, `… killswitch create`,
  `shipeasy metrics events create`, `shipeasy metrics create`,
  `shipeasy ops alerts create`). The `experiments` and `metrics` skills carry
  the analyze-and-instrument design flows. Typical uses: wrap a risky fix in a fresh gate,
  add the event + metric a fix needs for verification, add an alert rule that
  would have caught the regression.
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

```
shipeasy ops notify \
  --title "<one-line: what's blocked>" \
  --summary "<one sentence: why it can't be fixed in code>" \
  --steps '["<concrete action 1>", "<concrete action 2>", "<… then re-run the shipeasy-ops-work skill>"]' \
  --dedupe-key "feedback:<number>" \
  --href "/dashboard/<project>/bugs/<number>"
```

`--steps` is a JSON array of ordered strings. Make it **self-contained and
actionable** — the human reads only this card, not your transcript. 3–6 ordered
steps, each naming the exact file, command, env var, or dashboard page. The
notification stands out in the bell with a violet
"from your agent" accent and expands the full step-by-step guide on demand (a
"Details" toggle). `--summary` and each step in `--steps` render **markdown**
(lists, `code`, **bold**), so write them naturally — no need to flatten formatting.

**Reference entities inline so the card links them.** Anywhere in `--title`,
`--summary`, or a step, mention an admin entity with a reference token and
the dashboard turns it into a hover chip (entity name + live status) that
deep-links to that entity. Prefer these over bare names:

| Entity            | Token                  | Aliases     |
| ----------------- | ---------------------- | ----------- |
| feedback item     | `#42`                  | `@feedback:42` |
| feature flag/gate | `@gate:<name>`         | `@flag:`    |
| experiment        | `@experiment:<name>`   | `@exp:`     |
| dynamic config    | `@config:<name>`       |             |
| kill switch       | `@killswitch:<name>`   | `@ks:`      |
| metric            | `@metric:<name>`       |             |
| universe          | `@universe:<name>`     |             |
| alert rule        | `@alert:<name>`        |             |

`<name>` is the entity's immutable name — the same slug you pass to the MCP/CLI
(e.g. `features.checkout`); feedback uses its `#number`. Tokens degrade to plain
text wherever they aren't rendered, so they're always safe to use — e.g. a step
like `Roll back @gate:checkout-flow once #42 reproduces.`

`--dedupe-key "feedback:<n>"` sets a stable per-escalation key, so re-running
the loop over the same still-blocked item **updates the one card instead of
stacking duplicates**. Add `--href /dashboard/<project>/bugs/<n>` (or the
matching list page) to deep-link the card. `ops notify` is create-only and
ops-key-safe — it never reads, marks read, or deletes the feed.

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
   number + url on the item so it shows as a `PR <n>` badge in the dashboard
   feedback table (on `connector_data.github.pr`):

   ```
   shipeasy ops link-pr <handle> --pr-number <pr-number> --pr-url <pr-url>
   ```

   Pass the real PR number + url the previous step printed. (`--pr-url` is what
   makes the badge deep-link for error/alert tickets, which have no GitHub
   issue to derive the url from.) This is the ONLY feedback write beyond status
   the ops key may do — it touches `connector_data.github.pr` only.

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
   intake. Read it while working the item. Items with no connector issue
   simply have nothing to close; their only server-side trace is the status
   flip + the linked PR (step 2). **Do not create issues yourself.** When the
   item HAS a connector issue, the link-pr write (step 2) also wires the PR to
   that issue server-side (Closes #N / cross-ref comment) as a bonus — but the
   `Closes #N` in your PR body is what actually auto-closes it on merge.

5. **Lifecycle → `ready_for_qa`.** In PR mode a human reviews each PR, so
   never auto-`resolved` — flip every fixed item (any type) to
   `ready_for_qa`. The underlying tracked error still gets its
   `errors/<id>` → `resolved` write (it reopens on recurrence).

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
  states. Deletion of a feedback record is a human call made in the UI — list
  the queue with the `ops_list` MCP tool / `shipeasy ops` CLI. (This plugin
  ships no delete command for any resource, and the ops key cannot delete or
  archive server-side.)
- **Never flip `wont_fix` without asking** — product decision.
- **Recordings need human acknowledgement** — don't claim a bug fixed if you
  skipped its recording.
- **Stop the loop on the first auth/permission error.** A `401`/`403` means
  the binding or feedback module is wrong — don't burn the whole queue
  reproducing the same failure.
