---
name: bugs
description: File, fix, and manage in-app bug reports and feature requests captured by Shipeasy devtools. Trigger on "bug report", "feature request", "feedback", "user-reported issue", "report a bug", "fix open bugs", "burn down the bug queue".
user-invocable: true
---

# Shipeasy bugs & feature requests

The `feedback` module captures user-submitted bug reports and feature
requests through the in-browser devtools overlay (`?se=1` /
`?se_devtools=1` on any page that loads `getBootstrapHtml()`). The CLI
mirrors the same admin API so reports can also be filed and triaged from
a terminal or a CI script.

## Enabling on a project

```bash
shipeasy modules enable feedback
shipeasy modules list           # confirm `feedback` shows ✓
```

Or run `/shipeasy:bugs:install` to enable + verify + drop the project
pointer skill in one shot.

The toggle is per-project: same `.shipeasy` binding the rest of the CLI
uses. Devtools picks it up on the next load — no rebuild required.

## Filing from the CLI

```bash
shipeasy feedback bugs create "Checkout button is unresponsive on mobile" \
  --description "Tapping 'Pay' on iOS Safari does nothing on slow 3G." \
  --page-url "https://acme.com/checkout"

shipeasy feedback features create "Bulk-archive in dashboard" \
  --description "Lets ops clear stale gates without opening each row."
```

Slash equivalent: `/shipeasy:bugs:report <bug|feature> "<title>"`.

## Listing & triage

```bash
shipeasy feedback bugs list
shipeasy feedback bugs list --status open --json    # work queue
shipeasy feedback bugs update <id> --status in_progress
shipeasy feedback bugs delete <id-or-prefix>

shipeasy feedback features list
shipeasy feedback features delete <id-or-prefix>
```

`list` returns the most-recent rows; pipe through `--json` for scripts.

### Status lifecycle

`open` → `triaged` → `in_progress` → `ready_for_qa` → `resolved` (or
`wont_fix` as a terminal state from any earlier stage). `ready_for_qa`
is set by the developer after a fix lands; QA flips it to `resolved`
after verification in the dashboard. Do **not** skip straight to
`resolved` from code — that's a QA-only transition.

## Auto-fixing the queue

```
/shipeasy:bugs:fix [--priority high|critical] [--limit N] [--dry-run]
```

Pulls every open bug for the bound project, walks them in
priority/age order, fixes each one with a focused commit, and flips
its status to `ready_for_qa`. One bug per commit. Never pushes.

Skip rule: if a bug needs information the agent can't obtain (real
device, customer env), leave it `in_progress` with a CLI comment and
move on.

### Running it on a schedule (unattended)

```
/shipeasy:ops:create_claude_trigger
```

Provisions a **Claude Code scheduled routine** (via `/schedule`) that runs
the same pull → fix → `ready_for_qa` loop over **both** open bugs and
feature requests on a cadence you choose, then registers it as a Shipeasy
connector so it appears in the Feedback tab and can be fired on demand. The
routine runs in Anthropic's cloud — no GitHub Actions, runs even when your
machine is off. The command walks you through Claude auth, the `/schedule`
routine, and Shipeasy credentials; nothing auto-merges.

## Reading from the SDK

There is no public SDK surface for bugs/features yet — the devtools
overlay is the only customer-facing producer, and the CLI/admin API are
the consumer surface. Skip ahead to the `experiments` or `flags` skill
if you need a programmatic read path.

## When to use this skill

- User says "the customer reported a bug" / "log a feature request" /
  "show me open feedback".
- A devtools-captured report needs triaging from a script or CI job.
- Onboarding asks how to expose the in-page report button — the answer is
  `/shipeasy:bugs:install` (or `shipeasy modules enable feedback`).

## Errors → action

| Error                     | Action                                            |
| ------------------------- | ------------------------------------------------- |
| `403 module not enabled`  | Run `shipeasy modules enable feedback` and retry. |
| `401`                     | Re-run `shipeasy login`.                          |
| `404 not found` on delete | Check the ID with `shipeasy feedback bugs list`.  |
