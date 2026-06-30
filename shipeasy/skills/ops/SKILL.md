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

> **Filing and listing are plain tool/CLI calls, not slash commands** — use the
> `shipeasy` MCP tools (`ops_create`, `ops_list`, `ops_get`, `ops_update`) when the
> server is registered, or the `shipeasy ops` CLI (`shipeasy ops create` / `list`
> / `get` / `update`) as the fallback. Multi-step workflows are exposed as
> slash commands in Claude Code — install via `shipeasy install ops`; in Claude
> Code also: `/shipeasy:ops:install` (enable + verify + wire), `/shipeasy:ops:work`
> (burn down the queue), and `/shipeasy:ops:create_trigger` (schedule the loop).

## First fix: update before you debug

Most failures here — `unknown command` / `unknown option`, a missing
subcommand, an unexpected `400`/`404`, or something that worked before — are
**version drift**: the CLI or MCP server is older than the feature being
invoked. Before deeper debugging, update to latest and retry once:

- **CLI:** `npm i -g @shipeasy/cli@latest` (or one-off: `npx @shipeasy/cli@latest <cmd>`).
- **MCP server:** pinned to `@shipeasy/mcp@latest` — it auto-pulls the latest
  release on restart, so restart the session/server to pick up new tools.
- **In Claude Code (plugin skills + slash commands):** `/plugin marketplace
  update shipeasy` then `/plugin install shipeasy@shipeasy`, or open `/plugin`
  and enable auto-update on the `shipeasy` marketplace.

Only treat it as a real bug if it still fails on the latest CLI and MCP server.

## Enabling on a project

```bash
shipeasy install ops            # enables `feedback` + `events`, verifies the queue
```

This enables the feedback module (plus `events` for error collection) and
verifies the queue + errors admin paths are reachable. In Claude Code you can
instead run `/shipeasy:ops:install`, which wraps the same command and also wires
the devtools overlay + `see()` reporting.

The toggle is per-project: same `.shipeasy` binding the rest of the CLI
uses. Devtools picks it up on the next load — no rebuild required.

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
`see()` call site, **pull the `see()` error-reporting form for this project's
language from the `docs` MCP.** Detect the language from `.shipeasy` or the
subproject's manifest (`package.json`, `pyproject.toml`, `Gemfile`, `go.mod`,
`pom.xml`, `build.gradle*`, `composer.json`, `Package.swift`), then fetch the
snippet with the `docs_get` MCP tool:
`docs_get { sdk: <lang>, path: "<group/resource>" }` (run
`docs_list { sdk: <lang> }` to find the errors/feedback page path; CLI
`shipeasy docs get --sdk <lang> <group/resource>`). See the `see` skill for the
grammar.

## When to use this skill

- User says "the customer reported a bug" / "log a feature request" /
  "show me open feedback".
- A devtools-captured report needs triaging from a script or CI job.
- Onboarding asks how to expose the in-page report button — the answer is
  `shipeasy install ops` (in Claude Code: `/shipeasy:ops:install`).

## Errors → action

| Error                     | Action                                                  |
| ------------------------- | ------------------------------------------------------- |
| `403 module not enabled`  | Run `shipeasy install ops` and retry.                   |
| `401`                     | Re-run `shipeasy login`.                                |
| `404 not found` on update | Check the handle with `shipeasy ops list --type bug`.   |
