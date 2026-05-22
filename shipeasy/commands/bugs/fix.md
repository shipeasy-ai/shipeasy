---
description: Loop over every open Shipeasy bug for the bound project, pull details + screenshots/recordings into context, investigate, and resolve them one-by-one.
argument-hint: "[--status <open|triaged|in_progress>] [--priority high|critical] [--limit <N>] [--dry-run]"
---

Resolve every actionable bug in the bound project. Follow the `bugs`
skill for triage semantics. **Loop, do not batch.** Each bug is its own
mini-investigation; finishing one before starting the next keeps the
diff reviewable and avoids cross-bug contamination.

Prereqs:

- `.shipeasy` bound. Run `/shipeasy:setup` first if missing.
- `feedback` module enabled. Run `/shipeasy:bugs:install` if `shipeasy feedback bugs list` returns `403`.
- CLI ≥ `1.4.0` (`shipeasy feedback bugs attachments` subcommand was
  added there). Older CLIs will fail step 1.2 with
  `error: unknown command 'attachments'` — bump the CLI before retrying.
- Working tree clean **or** the user explicitly asked to fix on top of
  WIP. If `git status --porcelain` is non-empty and the user hasn't
  confirmed, stop and ask. Mixing the loop's per-bug diffs with pre-existing
  WIP makes the resulting commits unreviewable.

## 0. Build the work queue

Parse `$ARGUMENTS` for the optional flags up-front:

- `--status <s>` — default `open`. Anything in `BUG_STATUSES`.
- `--priority high|critical` — filter to only those priorities.
- `--limit <N>` — default `20`. Slice after sort.
- `--dry-run` — print the queue and exit 0. No status flips, no edits.

```bash
STATUS=${STATUS_FROM_ARGS:-open}
LIMIT=${LIMIT_FROM_ARGS:-20}
PRIORITY_FILTER=${PRIORITY_FROM_ARGS:-}      # high | critical | "" (no filter)
DRY_RUN=${DRY_RUN_FROM_ARGS:-}                # "1" if --dry-run was passed

shipeasy feedback bugs list --status "$STATUS" --json > /tmp/se-bugs-raw.json
```

Sort the queue with `priority desc, createdAt asc`. Priority order:
`critical > high > medium > low > null`. Without `jq` use Node:

```bash
node - <<'JS' < /tmp/se-bugs-raw.json > /tmp/se-bugs-queue.json
const RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const limit = parseInt(process.env.LIMIT || "20", 10);
const filter = process.env.PRIORITY_FILTER || "";
const rows = JSON.parse(require("fs").readFileSync(0, "utf-8"))
  .filter(b => !filter || b.priority === filter)
  .sort((a, b) =>
    (RANK[b.priority] || 0) - (RANK[a.priority] || 0) ||
    a.createdAt.localeCompare(b.createdAt))
  .slice(0, limit);
process.stdout.write(JSON.stringify(rows, null, 2));
JS
```

Print a one-line summary per bug before starting:

```
Queue (3):
  #abc12  critical  "Checkout 500 on iOS"   2026-05-17
  #def34  high      "Sidebar overflow"      2026-05-17
  #ghi56  medium    "Typo on /pricing"      2026-05-16
```

If the queue is empty: print "No bugs matching status=<STATUS>
priority=<filter>. Done." and stop.

If `--dry-run`: stop here. Do **not** flip status, do **not** edit
files, do **not** download attachments. The queue print above is the
deliverable.

Otherwise, extract just the ids for the loop:

```bash
node -e 'JSON.parse(require("fs").readFileSync(0,"utf8")).forEach(b=>console.log(b.id))' \
  < /tmp/se-bugs-queue.json > /tmp/se-bugs-queue.txt
wc -l /tmp/se-bugs-queue.txt
```

## 1. For each bug id in /tmp/se-bugs-queue.txt — strict loop

Do the steps below for **one** id, then restart from 1.1 with the next
id. Do not interleave. Do not parallelise. Use TodoWrite to mirror the
queue so progress survives mid-loop interruption.

### 1.1 Pull the bug detail (no attachments yet)

```bash
shipeasy feedback bugs get "$ID" --json > /tmp/se-bug.json
cat /tmp/se-bug.json
```

Read the JSON. Extract:

- `title`, `description`, `pageUrl`, `priority`, `status`, `createdAt`.
- `context` (usually contains userAgent, viewport, console logs, repro
  steps captured by the devtools overlay).
- `attachments[]` (an array of `{ id, kind, filename, contentType, size }`).

### 1.2 Download every attachment to a local tmpdir

```bash
shipeasy feedback bugs attachments "$ID" --json > /tmp/se-attachments.json
cat /tmp/se-attachments.json
```

Each row is `{ id, kind, path, bytes }`. `kind` is one of
`screenshot | recording | file`.

### 1.3 Bring attachments into context

For **screenshots** (`kind == "screenshot"`, or `contentType` starts
with `image/`): use the Read tool on `path`. The image is rendered to
you visually — use it.

For **recordings** (`kind == "recording"`, usually `.webm` or `.mp4`):
you cannot watch video directly. Surface to the user as a clickable
file:// URL and ask whether you should keep going on text + screenshots
alone, or if they want to extract a frame manually (`ffmpeg -ss <t> -i
<path> -frames:v 1 /tmp/frame.png`). Do not silently skip — recordings
often carry the only repro signal.

For **other files** (`kind == "file"`): treat by content-type. JSON / txt
/ md → Read them. Binary blobs → list size and content-type, do not try
to interpret.

### 1.4 Move the bug to in_progress

```bash
shipeasy feedback bugs update "$ID" --status in_progress
```

This signals to the dashboard and to humans that someone (you) owns
this report right now. Skip if already in_progress.

### 1.5 Investigate

Use the bug's `pageUrl`, `title`, and `description` to locate the
relevant code. Typical entry points:

- `pageUrl` → grep route files (`app/**/page.tsx`, `pages/**`, `src/routes/**`).
- Stack frame in `context.error.stack` → file:line for the throw site.
- Screenshot text → grep for visible strings (often unique enough to
  pinpoint the component).

**Reproduce locally if possible.** If the dev server is already running
(`pnpm dev` etc.), open the page and confirm the bug. If not, decide
whether spinning it up is worth the cost for this specific bug.

### 1.6 Fix

Edit the offending file(s). Keep the diff scoped to this bug. Hard
rules for the per-bug edit:

- **No drive-by refactors.** Touch only what the bug requires. The
  resulting diff should be small enough to review in one sitting.
- **No silencing.** Fix the root cause — do not catch and swallow, do
  not stub a value, do not delete the failing assertion. If you find a
  test that's failing for the same reason, fix the code, not the test.
- **Reuse the `superpowers:systematic-debugging` skill** if the root
  cause is not obvious from the first read. Don't guess.

Run the relevant verification gate:

- Unit/integration tests touching the changed file.
- `pnpm type-check` if TS changed.
- For UI fixes, re-load the page in the running dev server.

If you can't reproduce and can't confidently fix: leave the bug at
`in_progress`, write a one-paragraph hand-off note explaining what's
missing (repro on a real device, customer-only env, missing logs), and
move on. **Do not flip to `resolved`** just to clear the queue.

### 1.7 Mark resolved (only if confidently fixed and verified)

```bash
shipeasy feedback bugs update "$ID" --status resolved
```

If the fix is high-risk or needs human verification, use
`--status ready_for_qa` instead.

### 1.8 Report and continue

Print a one-paragraph summary per bug:

```
✔ <id> "<title>" → resolved
  Repro:   <one line>
  Fix:     <files changed, one line each>
  Verify:  <test cmd | dev-server URL | "manual">
```

Then proceed to the next id.

## 2. Final report

After the loop:

```
Processed N bugs.
  resolved:     X
  ready_for_qa: Y
  left as in_progress (couldn't fix): Z
Diff footprint:
$(git diff --stat)
```

Show the diff stat. **Do not run `git commit` or `git push`.** The user
reviews and commits.

## Rules

- **One bug at a time.** Loop, don't parallelise. Different bugs almost
  always touch different files; resolving them sequentially keeps blame
  clean.
- **Never delete a bug.** Resolving (`--status resolved`) is the
  terminal state. Deletion is for spam, and that's a human call.
- **Never `--status wont_fix` without asking the user.** That's a
  product decision, not an engineering one.
- **Recordings need human acknowledgement.** Don't claim a bug is fixed
  if you skipped the recording — surface the file path and ask whether
  the screenshots alone are sufficient.
- **Stop the loop on first auth/permission error.** A `401` or `403`
  from the CLI means the binding/feedback module is wrong — don't burn
  through the queue producing the same failure.
