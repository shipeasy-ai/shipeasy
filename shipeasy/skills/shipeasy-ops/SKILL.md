---
name: shipeasy-ops
description: File, triage, and manage the Shipeasy operational inbox — bug reports, feature requests, and auto-filed production-error/alert tickets. Trigger on "bug report", "feature request", "feedback", "ops inbox", "operational queue", "fix open bugs", "burn down the queue".
user-invocable: true
---

# Shipeasy ops — the operational inbox

The `feedback` module is **one unified queue** that mixes four sources into a
single table addressed by one set of `ops_*` tools: user-submitted **bug
reports** and **feature requests** (captured only through the in-browser
devtools overlay — `?se=1` / `?se_devtools=1` on a page that loads the devtools
`<script>`), plus auto-filed **production-error** and **alert** tickets.
Auto-filed error tickets originate from `see()` instrumentation in the app
(grammar → `shipeasy-see`).

This skill is a **router**: pick the use case, run the exact command. Every row
is one MCP tool (server registered) *or* the mirrored `shipeasy` CLI — prefer
the MCP tool when available; the two are interchangeable. Params are
self-documented (`shipeasy ops <cmd> --help` / the tool schema); only the
non-obvious flags are shown.

## Queue commands — what to run

| Use case | MCP tool | CLI |
| --- | --- | --- |
| File a bug | `ops_bug` | `shipeasy ops bug "<title>" --actual-result … --steps-to-reproduce … --page-url …` |
| File a feature request | `ops_feature` | `shipeasy ops feature "<title>" --description … --use-case …` |
| List / filter the whole queue | `ops_list` | `shipeasy ops list [--type bug\|feature_request\|error\|alert\|all] [--status <status>\|all] [--limit N]` |
| Read one item | `ops_get` | `shipeasy ops get <handle>` |
| Triage — set status / priority | `ops_update` | `shipeasy ops update <handle> --status <status> --priority <p>` |
| Edit an item's content | `ops_update` | `shipeasy ops update <handle> --title … --description … --actual-result …` |
| Link the fixing PR | `ops_link_pr` | `shipeasy ops link-pr <handle> --pr-number <n>` (errors/alerts need `--pr-url`) |
| Escalate — raise a human-attention card | `ops_notify` | `shipeasy ops notify --title … --summary … --steps '[…]' --dedupe-key feedback:<n>` |

`<handle>` = the item's per-project `number` (e.g. `7`) **or** its full id — the
API resolves either.

**Before filing a bug or feature, `ops_list` first** and check the same issue
isn't already in the queue. If it is, point to (or update) the existing item
instead of filing a duplicate.

## Status — the convention the schema doesn't state

Working flow: `open → triaged → in_progress → ready_for_qa → resolved` (or
`wont_fix`). Set `ready_for_qa` once a fix lands; leave `resolved` for QA
sign-off in the dashboard and set it directly *only* when verified end-to-end.
`pending_approval` and `triage` are human-gated holding states — excluded from
`list --status all`, returned only when requested as that exact status, and
promoted to `open` by a human in the dashboard.
