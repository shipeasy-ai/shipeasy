---
description: Provision a recurring, unattended feedback trigger that pulls the latest active Shipeasy bugs + feature requests and fixes them, then register it as a Shipeasy connector so it shows in the Feedback tab and can be fired on demand. Provider-pluggable via --provider (only `claude` is supported today) — the Claude provider backs the trigger with a Claude Code scheduled routine (via /schedule, runs in Anthropic's cloud). One-time full setup: provider auth, GitHub connection for cloud sessions (OAuth GitHub App — gh-free, or /web-setup if gh is installed), the schedule, and Shipeasy credentials. Does NOT use GitHub Actions or /install-github-app.
argument-hint: "[--provider claude] [--frequency daily|weekdays|weekly|6h] [--dry-run]"
---

## Provider selection

This command is **provider-pluggable**. Read `--provider` from `$ARGUMENTS`;
if omitted, default to `claude`. More providers will be added later.

- `--provider claude` (default) → follow the rest of this document as written.
- **Any other value** → not supported yet. Tell the user only `claude` is
  available today (e.g. `--provider claude`) and stop. Do not improvise a
  trigger on another platform.

The steps below are the **`claude` provider**.

You are provisioning a **recurring, unattended Claude trigger** backed by a
**Claude Code scheduled routine** (the built-in `/schedule` feature). On the
schedule the user chooses, the routine runs Claude **in Anthropic's cloud** —
not on the user's machine, **not on GitHub Actions** — and runs
**`/shipeasy:ops:work --pr`** against the bound project: it burns down the
active bug, feature, error and alert queue one item at a time, commits each
fix, and opens one PR for review. All the work logic lives in `ops:work`; the
routine is a thin wrapper around it.

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
  only to where they're needed — the CLI token substituted into the routine
  prompt's config-file write, the routine bearer token into
  `shipeasy connectors create-trigger` (which encrypts it at rest) — never
  echoed into chat.
- **Treat the routine as sensitive.** The routine reads the Shipeasy queue
  unattended, so its prompt carries the `cli_token` / `project_id` it writes to
  the CLI config file at run start (Claude Code has no programmatic way to set a
  routine's env vars, so the prompt is the only hands-off channel). Rotating
  `shipeasy login` means updating the routine prompt. Say this to the user.
- **Don't trigger a paid run without telling the user.** The verification fire
  (step 5) spends Claude tokens and may open a real PR. Confirm first.

## Prerequisites (verify, then stop on any failure)

```bash
test -f .shipeasy && echo ".shipeasy OK"          # base onboarding + bound project
npx -y @shipeasy/cli login                          # always — no-op if already logged in
npx -y @shipeasy/cli modules list | grep -q feedback   # feedback module enabled
git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  && git remote -v | grep -q github.com             # a GitHub repo to open PRs against
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
- **A GitHub repo to open PRs against.** The routine runs
  `/shipeasy:ops:work --pr`, which opens a real pull request with `gh pr
  create`. This project must be a GitHub repo — `git remote -v` shows a
  `github.com` remote (the check above). No GitHub remote → there's nowhere to
  open PRs; stop and tell the user to point the project at a GitHub repo first.
  (The cloud GitHub connection itself is set up as part of provisioning — see
  step 0 — so don't gate on it here.)

## 0. Connect GitHub for cloud sessions (one-time, part of setup)

This command performs the **complete one-time setup**, so connect the routine's
GitHub access here rather than just checking for it. The routine clones, pushes
a branch, and opens its PR under the user's **connected GitHub identity** — a
one-time consent the user clicks through. (If `--dry-run`, skip the actual
connect — just note it would run; see step 3.)

Connect GitHub one of two ways — **the first needs no `gh` CLI**:

- **Authorize the Claude GitHub App (OAuth — gh-free, the default).** The user
  authorizes the app in the browser (claude.ai/code web onboarding, or
  `github.com/apps/claude`). It's a pure OAuth consent — no local `gh` — and
  grants cloud sessions access to every repo the account can see (clone + push +
  open PRs). Use this when `gh` isn't installed.
- **`/web-setup` (shortcut when `gh` is already installed).** Syncs the user's
  local `gh` token to their Claude.ai account. Only works if `gh` is installed
  and authed — otherwise skip it and use the OAuth authorize above.

Notes:

- **The cloud routine does not need `gh` installed to open a PR.** Claude Code's
  built-in GitHub tooling clones, pushes, and opens PRs through the GitHub proxy
  (the token never enters the container). `gh` in the cloud env is only needed
  for advanced commands like `gh release` — not for this flow.
- Installing the app on a specific repo is optional — authorization alone covers
  push/PR; a per-repo install only adds Auto-fix PR webhooks.
- `/install-github-app` is the GitHub *Actions* integration (it scaffolds a
  `.github/workflows` file and wants an `ANTHROPIC_API_KEY` secret) — not needed
  here; the OAuth authorize above is the routine-access path.
- If the user can't complete the consent (no browser, declines), stop — a
  routine that can't open a PR just burns tokens and produces nothing.
- **Branch prefix:** by default a routine may only push `claude/`-prefixed
  branches, so the run opens its PR from a `claude/…` branch (fine for review).
  A different branch name needs "allow unrestricted branch pushes" enabled in
  the routine's repo settings.

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

The routine re-creates the CLI's logged-in state by **writing its config file**
(`$XDG_CONFIG_HOME/shipeasy/config.json` — the same file `shipeasy login`
writes and every `shipeasy` call reads) at the start of each run. The prompt is
the only hands-off channel for this:

- Claude Code has **no API or CLI to set a routine's environment variables
  programmatically** — that's UI-only — so per-routine env vars would force the
  user to paste secrets into the `/schedule` UI by hand, which this flow must
  not do.
- A bare `export` in the prompt wouldn't survive either: each Bash step in the
  run gets a fresh shell, so the env wouldn't reach the `shipeasy` calls that
  `/shipeasy:ops:work` makes. The on-disk **config file persists across the
  whole run**, so it does — that's why the prompt writes the file, not an
  `export`. (The CLI checks `SHIPEASY_CLI_TOKEN`/`SHIPEASY_PROJECT_ID` env
  first, then this file — leaving the env unset means it reads the file.)

Read your existing local token + project id **into shell vars, never print**:

```bash
SE_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/shipeasy/config.json"
test -f "$SE_CONFIG" || { echo "Run 'shipeasy login' first"; exit 1; }

SHIPEASY_CLI_TOKEN="$(jq -r .cli_token  "$SE_CONFIG")"
SHIPEASY_PROJECT_ID="$(jq -r .project_id "$SE_CONFIG")"
```

These get substituted into the config-file write in the step-4 prompt. The
token inherits the user's account access; rotate it by re-running
`shipeasy login` and updating the routine prompt.

## 3. (If `--dry-run`) stop here

Print the chosen cron, whether the Shipeasy creds were found, whether GitHub is
connected for cloud sessions (step 0), and the routine prompt that _would_ be
created. Exit without creating the routine.

## 4. Create the routine with `/schedule`

Use the built-in **`/schedule`** command to create one scheduled routine on
`<CRON>`. Point it at the **GitHub repo confirmed in the prerequisites** (the
one with the `github.com` remote, connected in Claude Code) — that's the repo
the routine checks out and opens its PR against. The routine prompt is a thin
wrapper: write the CLI config file to authenticate, refresh the plugin + CLI so
each run picks up the latest commands, then
run `/shipeasy:ops:work --pr` (which owns the whole pull → fix → commit →
one-PR → link-pr → auto-close-the-issue flow). Substitute the real
`SHIPEASY_CLI_TOKEN` / `SHIPEASY_PROJECT_ID` values (from step 2) into the
config JSON. The prompt:

```
You are an unattended Shipeasy maintenance run. Re-create the Shipeasy CLI's
logged-in state by writing its config file, so every `shipeasy` call this run
authenticates without a browser (do NOT run `shipeasy login` or echo the token):

CFG="${XDG_CONFIG_HOME:-$HOME/.config}/shipeasy"
mkdir -p "$CFG"
cat > "$CFG/config.json" <<'JSON'
{"project_id":"<value-from-step-2>","cli_token":"<value-from-step-2>","api_base_url":"https://api.shipeasy.ai","app_base_url":"https://shipeasy.ai","created_at":"1970-01-01T00:00:00Z"}
JSON
chmod 600 "$CFG/config.json"

First, update to the latest plugin AND CLI so this run uses the current
commands (the plugin ships the slash commands; @shipeasy/cli is the separate
binary `/shipeasy:ops:work` calls):

claude plugin marketplace update shipeasy
claude plugin install shipeasy@shipeasy
npm install -g @shipeasy/cli@latest

Then run /shipeasy:ops:work --pr — it burns down the active bug, feature,
error and alert queue, commits each fix, opens ONE pull request for human
review, links it back to every fixed bug, and adds a "Closes #<issue>"
keyword for any item with a connected GitHub issue so merging auto-closes it.

Open the PR from a claude/-prefixed branch (the prefix routines are allowed to
push by default). If the queue is empty it exits cleanly without opening a PR.
Don't merge.
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
| `401` / `403` from the shipeasy CLI inside the run | `SHIPEASY_CLI_TOKEN` in the routine prompt is stale — re-run `shipeasy login`, then update the routine prompt (step 4). |
| `403 module not enabled`                           | `shipeasy modules enable feedback`, then re-fire.                                                |
| Routine not found                                  | The `/schedule` routine was deleted — re-create it (step 4).                                     |

## 6. Hand-off

Print:

```
✅ Shipeasy feedback Claude trigger provisioned
Schedule:  <CRON>  (UTC; managed with /schedule)
Routine:   <ROUTINE_ID>  (Claude Code scheduled routine — runs in the cloud)
Creds:     CLI config file written at run start from the routine prompt
           (cli_token + project_id; the CLI reads it like a `shipeasy login`).
Connector: registered in Shipeasy → Feedback → Connectors ("Claude trigger"),
           backed by the routine. "Fire now" fires it on demand; toggle event
           auto-fire there to fire it on each new bug/feature.
Does:      updates the plugin + CLI → runs /shipeasy:ops:work --pr → fixes each
           item → opens one PR (Closes #issue) → links it back + ready_for_qa.
Review:    PRs land for human review; nothing auto-merges.
Manage:    edit/pause/delete the schedule with /schedule; delete the connector
           from the Feedback → Connectors panel.
```

> **Verify later:** the first scheduled or manual fire is the real test that
> the routine can read the Shipeasy queue and open a PR. If it fails on
> Shipeasy auth, the embedded `SHIPEASY_CLI_TOKEN` is stale — re-run
> `shipeasy login` and update the routine prompt (step 4).
