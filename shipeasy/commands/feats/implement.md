---
description: Loop over every open Shipeasy feature request for the bound project, design + implement each one as an atomic diff, mark shipped.
argument-hint: "[--status <open|considering|planned>] [--importance important|critical] [--limit <N>] [--dry-run]"
---

Implement every actionable feature request in the bound project.
Follow the `bugs` skill for triage semantics (same feedback module,
different lifecycle). **Loop, do not batch.** Each feature is its own
mini-design + implementation pass; finishing one before starting the
next keeps the diff reviewable and avoids cross-feature contamination.

Feature requests are **not** bugs — they're open-ended product asks.
Expect to spend more time on design than fix-style work: locate the
right surface, propose the smallest viable shape via `AskUserQuestion`,
then implement.

Prereqs:

- `.shipeasy` bound. Run `/shipeasy:setup` first if missing.
- `feedback` module enabled. Run `/shipeasy:bugs:install` if
  `shipeasy feedback features list` returns `403`.
- Working tree clean **or** the user explicitly asked to implement on
  top of WIP. If `git status --porcelain` is non-empty and the user
  hasn't confirmed, stop and ask. Mixing the loop's per-feature diffs
  with pre-existing WIP makes the resulting commits unreviewable.

## 0. Build the work queue

Parse `$ARGUMENTS` for the optional flags up-front:

- `--status <s>` — default `open`. One of `open | considering | planned`.
  Skip `shipped` and `declined` — terminal.
- `--importance important|critical` — filter to only those tiers.
- `--limit <N>` — default `10` (features are heavier than bug fixes,
  default lower than `bugs:fix`).
- `--dry-run` — print the queue and exit 0. No status flips, no edits.

```bash
STATUS=${STATUS_FROM_ARGS:-open}
LIMIT=${LIMIT_FROM_ARGS:-10}
IMPORTANCE_FILTER=${IMPORTANCE_FROM_ARGS:-}    # important | critical | "" (no filter)
DRY_RUN=${DRY_RUN_FROM_ARGS:-}                  # "1" if --dry-run was passed

shipeasy feedback features list --json > /tmp/se-feats-raw.json
```

CLI `features list` returns every status — filter `--status` client-side.
Sort `importance desc, createdAt asc`. Importance order: `critical >
important > nice_to_have`.

```bash
node - <<'JS' < /tmp/se-feats-raw.json > /tmp/se-feats-queue.json
const RANK = { critical: 3, important: 2, nice_to_have: 1 };
const status = process.env.STATUS || "open";
const limit  = parseInt(process.env.LIMIT || "10", 10);
const imp    = process.env.IMPORTANCE_FILTER || "";
const rows = JSON.parse(require("fs").readFileSync(0, "utf-8"))
  .filter(f => f.status === status)
  .filter(f => !imp || f.importance === imp)
  .sort((a, b) =>
    (RANK[b.importance] || 0) - (RANK[a.importance] || 0) ||
    (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
  .slice(0, limit);
process.stdout.write(JSON.stringify(rows, null, 2));
JS
```

Print a one-line summary per feature before starting:

```
Queue (3):
  #abc12  critical       "Bulk-archive in dashboard"        2026-05-17
  #def34  important      "CSV export for metrics"           2026-05-16
  #ghi56  nice_to_have   "Dark-mode toggle"                 2026-05-15
```

If the queue is empty: print "No feature requests matching status=<STATUS>
importance=<filter>. Done." and stop.

If `--dry-run`: stop here. Queue print is the deliverable.

Otherwise extract ids for the loop:

```bash
node -e 'JSON.parse(require("fs").readFileSync(0,"utf8")).forEach(f=>console.log(f.id))' \
  < /tmp/se-feats-queue.json > /tmp/se-feats-queue.txt
wc -l /tmp/se-feats-queue.txt
```

## 1. For each feature id — strict loop

Do the steps below for **one** id, then restart from 1.1 with the next.
Do not interleave. Do not parallelise. Use TodoWrite to mirror the
queue so progress survives mid-loop interruption.

### 1.1 Pull the feature detail

The CLI does not expose `features get` — pull the row out of the
already-fetched queue JSON:

```bash
node -e '
  const rows = JSON.parse(require("fs").readFileSync("/tmp/se-feats-queue.json", "utf8"));
  const f = rows.find(r => r.id === process.argv[1]);
  if (!f) { console.error("not in queue"); process.exit(1); }
  console.log(JSON.stringify(f, null, 2));
' "$ID" > /tmp/se-feat.json
cat /tmp/se-feat.json
```

Read the JSON. Extract:

- `title`, `description`, `useCase`, `importance`, `pageUrl`,
  `reporterEmail`, `createdAt`.
- `context` (optional, JSON — userAgent, viewport, anything the devtools
  overlay captured).

Feature requests do **not** carry attachments via the CLI today — there
is no `features attachments` subcommand. If the user-supplied
`description`/`useCase` references screenshots ("see attached"), surface
the missing-attachment gap to the user and continue on text alone.

### 1.2 Design with `AskUserQuestion`

Features are open-ended. Don't start editing files until the shape is
agreed.

1. **Locate the surface area.** Grep for keywords from `title` +
   `description`. The reporter usually names a specific page, component,
   or domain concept — that's your starting point. `pageUrl` (when
   present) points at the exact route file.

2. **Propose 2–4 implementation shapes** via `AskUserQuestion`. Each
   option captures:
   - Where the change lives (file:line scope estimate).
   - Behaviour delta — what the user sees / can do that they couldn't
     before.
   - Trade-off — one-line note on cost, scope creep risk, or
     compatibility concern.

3. **Stop scope creep before it starts.** If the reporter's ask implies
   a refactor or a new abstraction, propose the smallest shape that
   satisfies the use case and call out the larger refactor as a
   follow-up. One feature, one diff.

### 1.3 Implement

Edit the relevant file(s). Hard rules for the per-feature edit:

- **One feature = one atomic diff.** Touch only what the feature
  requires. No drive-by refactors. No "while I'm here" cleanup.
- **No half-finished implementations.** If the feature genuinely
  can't be completed in one pass (e.g. needs a missing API, schema
  change you don't have authority to apply), stop, document the gap in
  a note for the user, and skip to the next feature — do **not** land
  a partial diff.
- **Reuse before adding.** Search for similar existing utilities
  (`packages/core/src/`, `apps/ui/src/lib/`, adjacent files) before
  introducing new abstractions.

Run the relevant verification gate after the edit:

- Unit/integration tests touching the changed file.
- `pnpm type-check` if TS changed.
- `pnpm --filter @shipeasy/ui test` for UI-touching changes (see
  CLAUDE.md — every new workflow needs an e2e spec).
- For UI features, reload the page in the running dev server and
  exercise the new behaviour against the reporter's `useCase`.

### 1.4 Mark the feature `shipped`

The CLI does not yet expose `features update`. There are two paths:

- **Preferred (when the dashboard is at hand):** flip status →
  `shipped` in the UI; the audit trail captures who shipped it.
- **CLI/script path:** use the admin API directly via the bound key.
  The route is `PATCH /api/admin/feature-requests/<id>` with body
  `{ "status": "shipped" }`. Surface this as a manual step for the
  user — the slash command does **not** auto-PATCH (loops shouldn't
  silently push admin writes outside the CLI surface).

If the implementation needs human verification before flipping to
`shipped`, leave the status as-is and tell the user in step 1.5.

### 1.5 Report and continue

Print a one-paragraph summary per feature:

```
✔ <id> "<title>"
  Importance: <importance>
  Shape:      <one-line summary of what got built>
  Files:      <changed files, one line each>
  Verify:     <test cmd | dev-server URL | "manual">
  Status:     left at <current_status>; user to flip → shipped after review
```

Then proceed to the next id.

## 2. Final report

After the loop:

```
Processed N feature requests.
  implemented & ready to ship:    X
  needs human verification:       Y
  left unimplemented (gap noted): Z
Diff footprint:
$(git diff --stat)
```

Show the diff stat. **Do not run `git commit` or `git push`.** The user
reviews and commits.

## Rules

- **One feature at a time.** Loop, don't parallelise. Different
  features almost always touch different files; serial keeps blame
  clean and lets the user halt mid-loop without orphaning a half-built
  feature.
- **Never `--status declined` without asking the user.** That's a
  product decision, not an engineering one — equivalent to `wont_fix`
  on bugs.
- **Never delete a feature request.** Even if implemented, the record
  has audit value. Flip status to `shipped` (out-of-band, see 1.4)
  instead.
- **Skip features that need a real-world signal you don't have**:
  customer-only env, paid integration, manual hardware. Note the gap
  in 1.5 and continue.
- **Stop the loop on first auth/permission error.** A `401` or `403`
  from the CLI means the binding/feedback module is wrong — don't burn
  through the queue producing the same failure.
