---
name: ops
description: File, fix, and manage the Shipeasy operational inbox — in-app bug reports, feature requests, and auto-filed production-error/alert tickets — one unified feedback queue. Trigger on "bug report", "feature request", "feedback", "user-reported issue", "report a bug", "operational queue", "ops inbox", "production error ticket", "fix open bugs", "burn down the queue", "work the inbox", "set up a recurring fix routine/trigger".
user-invocable: true
---

# Shipeasy ops — the operational inbox

The `feedback` module is a single queue of operational work: user-submitted
**bug reports** and **feature requests** (captured through the in-browser
devtools overlay — `?se=1` / `?se_devtools=1` on any page that loads the
devtools `<script>` tag), plus auto-filed **production-error** and **alert**
tickets. The CLI mirrors the same admin API, so items can be filed, listed,
triaged, and worked from a terminal or a CI script.

**Prerequisites live in the `common` skill** — the MCP ⇄ CLI ⇄ API surfaces,
updating on version drift, and the `.shipeasy` binding. Filing / listing / triage
are plain tool calls (`ops_create`, `ops_list`, `ops_get`, `ops_update`, or the
`shipeasy ops` CLI). What's ops-specific: **multi-step workflows are exposed as
slash commands** in Claude Code — `/shipeasy:ops:install` (enable + verify +
wire), `/shipeasy:ops:work` (burn down the queue), and
`/shipeasy:ops:create_trigger` (schedule the loop).

## Enabling on a project

```bash
shipeasy install ops            # enables `feedback` + `events`, verifies the queue
```

Enables the feedback module (plus `events` for error collection) and verifies the
queue + errors admin paths. In Claude Code, `/shipeasy:ops:install` wraps the same
command and also wires the devtools overlay + `see()` reporting. Devtools picks
up the per-project toggle on the next load — no rebuild required.

## Filing — MCP tool or CLI

Prefer the `ops_create` MCP tool when the server is registered; otherwise the
`shipeasy ops` CLI:

```bash
shipeasy ops bug "Checkout button is unresponsive on mobile" \
  --body "Tapping 'Pay' on iOS Safari does nothing on slow 3G." \
  --page-url "https://acme.com/checkout"

shipeasy ops feature "Bulk-archive in dashboard" \
  --body "Lets ops clear stale gates without opening each row."
```

`shipeasy ops bug`/`shipeasy ops feature` are sugar for
`shipeasy ops create <title> --type bug|feature_request`. The equivalent MCP
tools are `ops_bug` / `ops_feature` (or `ops_create` with `type`).

## Listing & triage — MCP tool or CLI

Use the `ops_list` / `ops_get` / `ops_update` MCP tools, or the CLI. Listing is
unified across every type — filter with `--type`:

```bash
shipeasy ops list                                   # whole queue, newest first (prints JSON)
shipeasy ops list --type bug --status open           # bug work queue
shipeasy ops update <handle> --status in_progress    # handle = per-project #number or id

shipeasy ops list --type feature_request
```

`list` returns the most-recent rows; pipe through `--json` for scripts. A
queue item is addressed by its per-project `number` (e.g. `7`) or its full id.

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

In Claude Code:

```
/shipeasy:ops:work [--type bug|feature|error|alert|all] [--priority high|critical] [--limit N] [--dry-run]
```

The unified work loop. Pulls the operational queue for the bound project —
bugs, feature requests, tracked production errors, and active alerts —
walks them in priority/severity/age order, and resolves each one as its
own atomic diff: bugs fix-first → `ready_for_qa`/`resolved`, features
design-first → `shipped`, errors/alerts diagnose-first → fixed-in-code.
One item per diff. Never pushes.

Skip rule: if an item needs information the agent can't obtain (real
device, customer env), leave it as-is with a hand-off note and move on.

### Running it on a schedule (unattended)

In Claude Code:

```
/shipeasy:ops:create_trigger --provider claude
```

Provisions a **Claude Code scheduled routine** that runs
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

The one SDK call site that feeds this queue is **`see()` error reporting** —
auto-filed production-error tickets come from `see()` instrumentation in the
app. When `/shipeasy:ops:work` fixes an error item and needs to add or adjust a
`see()` call site, pull the error-reporting form for this project's language
from the `docs` surface (see `common` → "Pulling SDK call sites"), and see the
`see` skill for the grammar.

## When to use this skill

- User says "the customer reported a bug" / "log a feature request" /
  "show me open feedback".
- A devtools-captured report needs triaging from a script or CI job.
- Onboarding asks how to expose the in-page report button — the answer is
  `shipeasy install ops` (in Claude Code: `/shipeasy:ops:install`).
