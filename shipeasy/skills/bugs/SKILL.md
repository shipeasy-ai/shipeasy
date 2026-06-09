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

## First fix: update before you debug

Most failures here — `unknown command` / `unknown option`, a missing
subcommand, an unexpected `400`/`404`, or something that worked before — are
**version drift**: the CLI or plugin is older than the feature being invoked.
Before deeper debugging, update to latest and retry once:

- **CLI:** `npm i -g @shipeasy/cli@latest` (or one-off: `npx @shipeasy/cli@latest <cmd>`).
- **Plugin (skills + slash commands):** `/plugin marketplace update shipeasy`
  then `/plugin install shipeasy@shipeasy`. There is no `claude plugin update`;
  or open `/plugin` and enable auto-update on the `shipeasy` marketplace.
- **MCP server:** pinned to `@shipeasy/mcp@latest` — restart the session to
  pick up a new release.

Only treat it as a real bug if it still fails on the latest CLI **and** plugin.

## Enabling on a project

```bash
shipeasy modules enable feedback
shipeasy modules list           # confirm `feedback` shows ✓
```

Or run `/shipeasy:ops:install` to enable + verify + drop the project
pointer skill in one shot (it also turns on production-error and alert
collection).

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

Slash equivalent: `/shipeasy:ops:report [--type bug|feature] "<title>"`.

## Listing & triage

```bash
shipeasy feedback bugs list
shipeasy feedback bugs list --status open --json    # work queue
shipeasy feedback bugs update <id> --status in_progress

shipeasy feedback features list
```

`list` returns the most-recent rows; pipe through `--json` for scripts.
Slash equivalent for listing: `/shipeasy:ops:list [--type bug|feature]`.

**Deletion is UI-only.** Spam/duplicate removal is a human call made in
the dashboard — the plugin ships no delete command, and the loops never
delete a record (terminal state is `resolved` / `shipped`).

### Status lifecycle

`open` → `triaged` → `in_progress` → `ready_for_qa` → `resolved` (or
`wont_fix` as a terminal state from any earlier stage). `ready_for_qa`
is set by the developer after a fix lands; QA flips it to `resolved`
after verification in the dashboard. Do **not** skip straight to
`resolved` from code — that's a QA-only transition.

## Auto-fixing the queue

```
/shipeasy:ops:work [--type bug|feature|error|alert|all] [--priority high|critical] [--limit N] [--dry-run]
```

The unified work loop (it replaces the old `bugs:fix` and
`feats:implement`). Pulls the operational queue for the bound project —
bugs, feature requests, tracked production errors, and active alerts —
walks them in priority/severity/age order, and resolves each one as its
own atomic diff: bugs fix-first → `ready_for_qa`/`resolved`, features
design-first → `shipped`, errors/alerts diagnose-first → fixed-in-code.
One item per diff. Never pushes.

Skip rule: if an item needs information the agent can't obtain (real
device, customer env), leave it as-is with a hand-off note and move on.

### Running it on a schedule (unattended)

```
/shipeasy:ops:create_trigger --provider claude
```

Provisions a **Claude Code scheduled routine** (via `/schedule`) that runs
`/shipeasy:ops:work --pr` on a cadence you choose — burning down the active
queue, committing each fix, opening one PR, and linking it back to every fixed
bug (with `Closes #<issue>` for any connected GitHub issue) — then registers it
as a Shipeasy connector so it appears in the Feedback tab and can be fired on
demand. The routine runs in Anthropic's cloud — no GitHub Actions, runs even
when your machine is off. The command walks you through Claude auth, the
`/schedule` routine, and Shipeasy credentials; nothing auto-merges.

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
  `/shipeasy:ops:install` (or `shipeasy modules enable feedback`).

## Errors → action

| Error                     | Action                                            |
| ------------------------- | ------------------------------------------------- |
| `403 module not enabled`  | Run `shipeasy modules enable feedback` and retry. |
| `401`                     | Re-run `shipeasy login`.                          |
| `404 not found` on update | Check the ID with `shipeasy feedback bugs list`.  |
