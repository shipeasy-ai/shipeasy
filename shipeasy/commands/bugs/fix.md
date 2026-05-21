---
description: Loop over every open Shipeasy bug for the bound project, pull details + screenshots/recordings into context, investigate, and resolve them one-by-one.
argument-hint: "[--status <open|triaged|in_progress>] [--limit <N>]"
---

Resolve every actionable bug in the bound project. Follow the `bugs`
skill for triage semantics. **Loop, do not batch.** Each bug is its own
mini-investigation; finishing one before starting the next keeps the
diff reviewable and avoids cross-bug contamination.

Prereqs:

- `.shipeasy` bound. Run `/shipeasy:setup` first if missing.
- `feedback` module enabled. Run `/shipeasy:bugs:install` if `shipeasy feedback bugs list` returns `403`.
- CLI ≥ the version that ships `shipeasy feedback bugs attachments` (added with this plugin).

## 0. Build the work queue

```bash
STATUS=${STATUS_FROM_ARGS:-open}        # default: open (parse --status from $ARGUMENTS)
LIMIT=${LIMIT_FROM_ARGS:-20}             # default: 20 (parse --limit from $ARGUMENTS)
shipeasy feedback bugs list --status "$STATUS" --json | jq -r '.[].id' | head -n "$LIMIT" > /tmp/se-bugs-queue.txt
wc -l /tmp/se-bugs-queue.txt
```

If the queue is empty: print "No bugs matching status=<STATUS>. Done."
and stop.

If `jq` is missing, parse the JSON inline in the Bash tool with Node:
`node -e 'JSON.parse(require("fs").readFileSync(0,"utf8")).forEach(b=>console.log(b.id))'`.

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

Edit the offending file(s). Keep the diff scoped to this bug. Don't
fold unrelated cleanups in — each resolved bug should produce a
reviewable, atomic diff.

Run the relevant verification gate:

- Unit/integration tests touching the changed file.
- `pnpm type-check` if TS changed.
- For UI fixes, re-load the page in the running dev server.

If you can't reproduce and can't confidently fix: comment the
investigation onto the bug (post a hand-off note — see 1.8) and **do
not** mark it resolved. Move on.

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
