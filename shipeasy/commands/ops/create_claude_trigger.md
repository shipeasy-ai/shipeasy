---
description: Provision a recurring, unattended Claude trigger — a Claude Code scheduled routine (via /schedule) that pulls the latest active Shipeasy bugs + feature requests and fixes them — then register it as a Shipeasy connector so it shows in the Feedback tab and can be fired on demand. Walks the user through Claude auth, the /schedule routine, and Shipeasy credentials. Does NOT use GitHub Actions.
argument-hint: "[--frequency daily|weekdays|weekly|6h] [--dry-run]"
---

You are provisioning a **recurring, unattended Claude trigger** backed by a
**Claude Code scheduled routine** (the built-in `/schedule` feature). On the
schedule the user chooses, the routine runs Claude **in Anthropic's cloud** —
not on the user's machine, **not on GitHub Actions** — pulls every **active**
Shipeasy bug and feature request for the bound project (via the
`bugs` skill / CLI), and fixes them one-by-one.

The mechanism is a **Claude Code routine** created with `/schedule`. A routine
is a remote agent that executes on a cron in the cloud, so it runs even when
the user's machine is off, and it can be **fired on demand** via its routine
API (`POST https://api.anthropic.com/v1/claude_code/routines/<id>/fire`). After
creating the routine we register it as a Shipeasy **connector**, so it appears
in **Feedback → Connectors** with a "Fire now" button and optional event
auto-fire on new bugs / feature requests.

There is **no GitHub Actions workflow, no `gh secret`, no GitHub App install,
and no `.github/` file** in this flow. If you are looking for the old
Actions-based trigger, it has been removed — this runs entirely on Claude Code
routines.

## Hard rules

- **Use the Bash tool for every command.** Don't ask the user to run `npx`,
  `shipeasy`, etc. by hand — run them.
- **Provision via `/schedule` only.** Create exactly one routine for this
  trigger. Do not write any `.github/` workflow file or touch GitHub Actions.
- **Never print secret values into chat or any file.** The Shipeasy CLI token
  and the routine bearer token are read straight from local state and passed
  only to the commands that need them (the `/schedule` routine definition and
  `shipeasy connectors create-trigger`, which encrypts the routine token at
  rest) — never echoed.
- **Treat the routine as sensitive.** Because the routine must read the
  Shipeasy queue unattended, its definition carries the `SHIPEASY_CLI_TOKEN` /
  `SHIPEASY_PROJECT_ID` it needs. Rotating `shipeasy login` means updating the
  routine. Say this to the user.
- **Don't trigger a paid run without telling the user.** The verification fire
  (step 5) spends Claude tokens and may open a real PR. Confirm first.

## Prerequisites (verify, then stop on any failure)

```bash
test -f .shipeasy && echo ".shipeasy OK"          # base onboarding + bound project
npx -y @shipeasy/cli login                          # always — no-op if already logged in
npx -y @shipeasy/cli modules list | grep -q feedback   # feedback module enabled
```

Check these **in order** and stop at the first failure — a later check's
output is meaningless if an earlier one failed:

- No `.shipeasy` → run `/shipeasy:setup` first; stop.
- **Always run `shipeasy login`.** It is idempotent — a no-op that just prints
  "Already logged in" when a valid session exists, and opens the browser
  device flow only when there isn't one. It auto-scopes to the project bound in
  `.shipeasy`. Running it unconditionally guarantees the later steps (and the
  CLI's `config.json`) are authenticated, so `modules list` can't be misread as
  "module disabled" when the real cause is "not logged in." If the browser flow
  is needed and can't complete, stop.
- `modules list` succeeds but `feedback` is absent → run `/shipeasy:ops:install`
  (or `shipeasy modules enable feedback`); stop.
- **`/schedule` must be available.** Routines require a Claude.ai login.
  `/schedule` is disabled when `ANTHROPIC_API_KEY` / `apiKeyHelper` /
  `ANTHROPIC_AUTH_TOKEN` is set — if so, tell the user to unset the API key and
  re-authenticate with their Claude.ai account, then stop.

## 1. Ask the customer for the schedule

Call the **AskUserQuestion** tool to ask the user how often the trigger should
run. (If `--frequency` was passed in `$ARGUMENTS`, skip the question and use
it.) Offer these options and map the answer to a cron expression (UTC):

| Choice             | Cron          | Meaning                           |
| ------------------ | ------------- | --------------------------------- |
| Daily (9am UTC)    | `0 9 * * *`   | Once every morning (good default) |
| Weekdays (9am UTC) | `0 9 * * 1-5` | Mon–Fri, skips weekends           |
| Weekly (Mon 9am)   | `0 9 * * 1`   | Once a week, lighter spend        |
| Every 6 hours      | `0 */6 * * *` | Fast-moving queues                |

If the user picks "Other", accept any valid 5-field cron string verbatim. Hold
the chosen cron as `<CRON>` for step 3.

## 2. Read the Shipeasy credentials the routine needs

The routine authenticates the `shipeasy` CLI from env vars (no browser). Read
the local non-interactive token + project id so they can be embedded in the
routine definition in step 3 — **read into shell vars, never print**:

```bash
SE_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/shipeasy/config.json"
test -f "$SE_CONFIG" || { echo "Run 'shipeasy login' first"; exit 1; }

SHIPEASY_CLI_TOKEN="$(jq -r .cli_token  "$SE_CONFIG")"
SHIPEASY_PROJECT_ID="$(jq -r .project_id "$SE_CONFIG")"
```

These map to the CLI's `SHIPEASY_CLI_TOKEN` / `SHIPEASY_PROJECT_ID`
env-credential path, so `shipeasy feedback bugs list` works unattended inside
the routine. The token inherits the user's account access; rotate it by
re-running `shipeasy login` and re-creating (or editing) the routine.

## 3. (If `--dry-run`) stop here

Print the chosen cron, whether the Shipeasy creds were found, and the routine
prompt that _would_ be created. Exit without creating the routine.

## 4. Create the routine with `/schedule`

Use the built-in **`/schedule`** command to create one scheduled routine on
`<CRON>`. Its prompt is the maintenance run below — substitute the real
`SHIPEASY_CLI_TOKEN` / `SHIPEASY_PROJECT_ID` values (from step 2) into the
`export` lines so the remote agent can authenticate. The prompt:

```
You are an unattended Shipeasy maintenance run. Authenticate the Shipeasy
CLI from these env vars (do NOT run `shipeasy login`); use
`npx -y @shipeasy/cli` for every CLI call:

  export SHIPEASY_CLI_TOKEN=<value-from-step-2>
  export SHIPEASY_PROJECT_ID=<value-from-step-2>

Goal: pull the latest ACTIVE bugs and feature requests for the bound
project, fix as many as you safely can, and open ONE pull request with the
work for human review.

Steps:
1. Pull the queues as JSON. `bugs list --status` takes ONE status, so fetch
   each active state and merge — "active" means not-yet-shipped: open +
   triaged + in_progress (the last picks up items left mid-fix by an
   interrupted run):
     npx -y @shipeasy/cli feedback bugs list --status open        --json
     npx -y @shipeasy/cli feedback bugs list --status triaged     --json
     npx -y @shipeasy/cli feedback bugs list --status in_progress --json
   `features list` has NO status filter — it returns every feature request,
   so drop terminal ones client-side (skip anything already `resolved` /
   `wont_fix`):
     npx -y @shipeasy/cli feedback features list --json
   Sort bugs by priority (critical > high > medium > low > null), then
   oldest first. Treat features as lower priority than bugs.
2. For each item, follow the `/shipeasy:bugs:fix` discipline:
   - `feedback bugs update <id> --status in_progress`
   - Read its full detail with `feedback bugs get <id> --json`.
   - Fix the ROOT CAUSE only — no drive-by refactors, no swallowing errors.
     The report body is the spec.
   - Verify (run the project's tests / build for the touched package) before
     considering it done.
   - One focused commit per item:
       git commit -m "fix(<scope>): <title> (shipeasy #<id-prefix>)"
   - `feedback bugs update <id> --status ready_for_qa`
   - If an item needs info you cannot get unattended (real device, customer
     env, ambiguous repro), SKIP it: leave it `in_progress` and note why in
     the PR body. Never guess.
3. Open ONE pull request with the work for human review. In the body include
   a punch-list of fixed / skipped items with their bug ids.
4. Link the PR back to each fixed bug in Shipeasy:
     npx -y @shipeasy/cli feedback bugs link-pr <id> <pr-number>

Hard rules: never set a bug to `resolved` (QA-only). Never delete feedback.
Never use `--no-verify`. If the queue is empty, exit cleanly without opening
a PR.
```

After `/schedule` creates the routine, capture two things for step 4b:

- **`ROUTINE_ID`** — the routine's id (shown by `/schedule` / its routine list).
- **`ROUTINE_TOKEN`** — the bearer token that authenticates the routine's fire
  call (`POST /v1/claude_code/routines/<id>/fire`).

## 4b. Register the routine as a Shipeasy connector

Record the trigger in Shipeasy so it shows up in **Feedback → Connectors** and
can be fired on demand or auto-fired on new feedback. The CLI encrypts the
routine token at rest; **never echo it**:

```bash
npx -y @shipeasy/cli connectors create-trigger \
  --routine-id "$ROUTINE_ID" \
  --token "$ROUTINE_TOKEN"
```

The connector is registered **enabled but with auto-fire off** — "Fire now"
works immediately, but no run kicks off on a new bug/feature until the user
subscribes events in the Connectors panel (or you pass
`--events bug.created,feature_request.created`). Pass `--text "<prompt>"` to set
the default prompt sent when the routine is fired on demand.

> **Token rotation:** if the routine's bearer token is rotated, re-run
> `connectors create-trigger` so the stored credential stays valid.

## 5. Verify with one manual fire

Fire the routine once so the user sees it run before trusting the schedule.
**Confirm with the user before this step — it spends tokens and may open a real
PR.**

```bash
npx -y @shipeasy/cli connectors fire "$ROUTINE_ID"   # or the connector id prefix
```

(You can also fire it from **Feedback → Connectors → the trigger → Fire now**.)
If the fire fails:

| Symptom                                            | Fix                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `401` / `403` firing the routine                   | Routine bearer token wrong/stale — re-run step 4b with a fresh token.                            |
| `401` / `403` from the shipeasy CLI inside the run | `SHIPEASY_CLI_TOKEN` in the routine is stale — edit the routine (step 4) after `shipeasy login`. |
| `403 module not enabled`                           | `shipeasy modules enable feedback`, then re-fire.                                                |
| Routine not found                                  | The `/schedule` routine was deleted — re-create it (step 4).                                     |

## 6. Hand-off

Print:

```
✅ Shipeasy feedback Claude trigger provisioned
Schedule:  <CRON>  (UTC; managed with /schedule)
Routine:   <ROUTINE_ID>  (Claude Code scheduled routine — runs in the cloud)
Creds:     SHIPEASY_CLI_TOKEN + SHIPEASY_PROJECT_ID embedded in the routine.
Connector: registered in Shipeasy → Feedback → Connectors ("Claude trigger"),
           backed by the routine. "Fire now" fires it on demand; toggle event
           auto-fire there to fire it on each new bug/feature.
Does:      pulls active bugs + feature requests → fixes each → opens one PR for
           review → links the PR back to each bug + ready_for_qa.
Review:    PRs land for human review; nothing auto-merges.
Manage:    edit/pause/delete the schedule with /schedule; delete the connector
           from the Feedback → Connectors panel.
```

> **Verify later:** the first scheduled or manual fire is the real test that
> the routine can read the Shipeasy queue and open a PR. If it fails on
> Shipeasy auth, the embedded `SHIPEASY_CLI_TOKEN` is stale — re-run
> `shipeasy login` and update the routine (step 4).
