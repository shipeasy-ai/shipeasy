---
description: Provision a recurring, unattended Claude trigger (GitHub Actions cron) that pulls the latest active Shipeasy bugs + feature requests, fixes them, and opens a PR attributed to the Claude GitHub App — closing any connector-tracked GitHub issue. Walks the user through Claude auth, the Claude GitHub App install, and Shipeasy CI credentials.
argument-hint: "[--frequency daily|weekdays|weekly|6h] [--dry-run]"
---

You are provisioning a **clean, self-contained scheduled Claude trigger**
in the user's target git repo. On the schedule the user chooses, the
trigger runs Claude Code headlessly, pulls every **active** Shipeasy bug
and feature request for the bound project (via the `bugs`
skill / CLI), fixes them one-by-one, and opens a single pull request.

The mechanism is **GitHub Actions on a `schedule` cron** using the
official `anthropics/claude-code-action@v1`. This is the only path that
(a) runs even when the user's machine is off, (b) lives inside the target
repo, and (c) commits + opens the PR as the **Claude GitHub App**
(`claude[bot]`) — the app installed in step 2 — so the work is attributed
to the trigger, not the generic `github-actions` bot. When a bug already
has a GitHub issue opened by a Shipeasy connector, the PR references it
(`Closes #N`) so merging closes the loop end-to-end.

## Hard rules

- **Use the Bash tool for every command.** Don't ask the user to run
  `gh`, `npx`, `git`, etc. by hand — run them. **Trigger
  `/install-github-app` yourself** as part of step 2 (don't tell the user
  to type it) — the only thing the user does in a browser is click
  "Approve" on the GitHub App install and paste a Console API key.
- **Provision cleanly.** One new workflow file at
  `.github/workflows/shipeasy-feedback-autofix.yml`. Do not touch other
  workflows. If that file already exists, stop and ask before
  overwriting.
- **Never print secret values into the repo, the workflow YAML, or chat.**
  Secrets go into GitHub Actions secrets only (`gh secret set`), read
  straight from the local config — never echoed.
- **Don't trigger a paid run without telling the user.** The verification
  run (step 6) spends Claude tokens and may open a real PR. Confirm first.

## Prerequisites (verify, then stop on any failure)

```bash
git rev-parse --is-inside-work-tree            # must be a git repo
gh repo view --json nameWithOwner -q .nameWithOwner   # GitHub remote + gh authed
test -f .shipeasy && echo ".shipeasy OK"       # base onboarding done
npx -y @shipeasy/cli login                      # always — no-op if already logged in
npx -y @shipeasy/cli modules list | grep -q feedback   # feedback module enabled
```

Check these **in order** and stop at the first failure — a later check's
output is meaningless if an earlier one failed:

- No git repo / no GitHub remote → tell the user this trigger requires a
  GitHub-hosted repo; stop.
- `gh` not authenticated → `gh auth login` (browser), then continue.
- No `.shipeasy` → run `/shipeasy:setup` first; stop.
- **Always run `shipeasy login`.** It is idempotent — a no-op that just
  prints "Already logged in" when a valid session exists, and opens the
  browser device flow only when there isn't one. It also auto-scopes to
  the project bound in `.shipeasy`: the browser flow offers **only that
  project** (no picker) so you can't authorize the wrong one; with no
  `.shipeasy` it runs the normal pick-or-create flow. Running it
  unconditionally here means the later steps (and the CLI's
  `config.json`) are guaranteed to be authenticated, so `modules list`
  can't be misread as "module disabled" when the real cause is "not
  logged in." If the browser flow is needed and can't complete, stop.
- `modules list` succeeds but `feedback` is absent → run
  `/shipeasy:bugs:install` (or `shipeasy modules enable feedback`); stop.

## 1. Ask the customer for the schedule

Call the **AskUserQuestion** tool to ask the user how often the trigger
should run. (If `--frequency` was passed in `$ARGUMENTS`, skip the
question and use it.) Offer these options and map the answer to a cron
expression (UTC):

| Choice             | Cron          | Meaning                           |
| ------------------ | ------------- | --------------------------------- |
| Daily (9am UTC)    | `0 9 * * *`   | Once every morning (good default) |
| Weekdays (9am UTC) | `0 9 * * 1-5` | Mon–Fri, skips weekends           |
| Weekly (Mon 9am)   | `0 9 * * 1`   | Once a week, lighter spend        |
| Every 6 hours      | `0 */6 * * *` | Fast-moving queues                |

If the user picks "Other", accept any valid 5-field cron string verbatim.
Hold the chosen cron as `<CRON>` for step 5. Tell the user GitHub cron is
UTC and can be delayed several minutes under load.

## 2. Claude auth + GitHub App (the "Claude trigger" identity)

The action needs an Anthropic credential and the Claude GitHub App
installed on the repo. The app install is also what gives the runs their
identity: with it installed, `anthropics/claude-code-action` mints a
short-lived app token and commits + opens the PR as **`claude[bot]`**
(not `github-actions[bot]`), so the work traces back to this trigger.

1. **Trigger the Claude GitHub App installer automatically.** Invoke the
   `/install-github-app` command now — as part of this run, without
   waiting for the user to type it. It installs
   `https://github.com/apps/claude` on the repo, scaffolds a workflow, and
   prompts for the `ANTHROPIC_API_KEY` secret. The user's only job is the
   in-browser "Approve" + pasting the Console key; everything else you
   drive. Wait for it to finish before continuing. We replace its scaffold
   with our feedback-autofix workflow in step 5 — it's fine to delete the
   sample `claude.yml` it drops.

   (If `/install-github-app` is unavailable in the harness — e.g. a
   non-Claude-Code environment — fall back to the manual path below.)

2. **Manual fallback** (only if the installer can't run):
   - Install the app: open `https://github.com/apps/claude` → **Install**
     → select this repo (repo admin required).
   - Mint a Console API key at `https://console.anthropic.com/` → **API
     keys**.
   - Store it as a repo secret (paste at the prompt, never on the command
     line history):

     ```bash
     gh secret set ANTHROPIC_API_KEY    # paste the sk-... value when prompted
     ```

   Note: this workflow authenticates with `ANTHROPIC_API_KEY` (Console
   key) — the simplest path. The action also accepts a long-lived OAuth
   token via its `claude_code_oauth_token` input (mint one with
   `claude setup-token`, store as the `CLAUDE_CODE_OAUTH_TOKEN` secret) if
   the user prefers subscription/SSO auth over a Console key. To use it,
   swap `anthropic_api_key:` for `claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`
   in the workflow and set that secret instead. Pick one; don't set both.

## 3. Shipeasy CI credentials (so the run can read the queue)

The headless run authenticates the `shipeasy` CLI from env vars (no
browser). Pull the local non-interactive token + project id and push them
as repo secrets — **read, set, never print**:

```bash
SE_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/shipeasy/config.json"
test -f "$SE_CONFIG" || { echo "Run 'shipeasy login' first"; exit 1; }

gh secret set SHIPEASY_CLI_TOKEN  --body "$(jq -r .cli_token  "$SE_CONFIG")"
gh secret set SHIPEASY_PROJECT_ID --body "$(jq -r .project_id "$SE_CONFIG")"
```

These map to the CLI's `SHIPEASY_CLI_TOKEN` / `SHIPEASY_PROJECT_ID`
env-credential path, so `shipeasy feedback bugs list` works unattended.
Tell the user the token inherits their account's access; rotate it by
re-running `shipeasy login` and re-setting the secret.

Confirm all three secrets exist (names only, no values):

```bash
gh secret list | grep -E 'ANTHROPIC_API_KEY|SHIPEASY_CLI_TOKEN|SHIPEASY_PROJECT_ID'
```

## 4. (If `--dry-run`) stop here

Print the chosen cron, the secrets that are present/missing, and the
workflow path that _would_ be written. Exit without writing the file.

## 5. Write the workflow

Write this to `.github/workflows/shipeasy-feedback-autofix.yml` via the
Write tool, substituting `<CRON>` from step 1. Keep it clean — this is
the entire trigger:

```yaml
name: Shipeasy feedback auto-fix

on:
  schedule:
    - cron: "<CRON>"
  workflow_dispatch: {} # manual run button for verification

# Don't pile runs on top of each other if one is slow.
concurrency:
  group: shipeasy-feedback-autofix
  cancel-in-progress: false

permissions:
  contents: write # commit the fixes to a branch
  pull-requests: write # open the PR

jobs:
  autofix:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Run Claude over the active feedback queue
        uses: anthropics/claude-code-action@v1
        env:
          SHIPEASY_CLI_TOKEN: ${{ secrets.SHIPEASY_CLI_TOKEN }}
          SHIPEASY_PROJECT_ID: ${{ secrets.SHIPEASY_PROJECT_ID }}
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          claude_args: "--permission-mode acceptEdits --allowedTools Bash,Edit,Write,Read"
          prompt: |
            You are an unattended maintenance run for this repository.
            Authenticate to Shipeasy via the SHIPEASY_CLI_TOKEN and
            SHIPEASY_PROJECT_ID env vars (already set) — do NOT run
            `shipeasy login`. Use `npx -y @shipeasy/cli` for every CLI call.

            Goal: pull the latest ACTIVE bugs and feature requests for the
            bound project, fix as many as you safely can, and open ONE pull
            request with the work.

            Steps:
            1. Create a working branch:
                 git switch -c shipeasy/autofix-$(date +%Y%m%d-%H%M)
            2. Pull the queues as JSON. `bugs list --status` takes ONE
               status, so fetch each active state and merge — "active"
               means not-yet-shipped: open + triaged + in_progress (the
               last picks up items left mid-fix by an interrupted run):
                 npx -y @shipeasy/cli feedback bugs list --status open        --json
                 npx -y @shipeasy/cli feedback bugs list --status triaged     --json
                 npx -y @shipeasy/cli feedback bugs list --status in_progress --json
               `features list` has NO status filter — it returns every
               feature request, so drop terminal ones client-side (skip
               anything already `resolved` / `wont_fix`):
                 npx -y @shipeasy/cli feedback features list --json
               Sort bugs by priority (critical > high > medium > low > null),
               then oldest first. Treat features as lower priority than bugs.
            3. For each item, follow the `/shipeasy:bugs:fix` discipline:
               - `feedback bugs update <id> --status in_progress`
               - Read its full detail to capture any connector-tracked
                 GitHub issue — `feedback bugs get <id> --json` exposes
                 `context.github` ({ owner, repo, number }). Remember the
                 issue `number` when one exists.
               - Fix the ROOT CAUSE only — no drive-by refactors, no
                 swallowing errors. The report body is the spec.
               - Verify (run the project's tests / build for the touched
                 package) before considering it done.
               - One focused commit per item:
                   git commit -m "fix(<scope>): <title> (shipeasy #<id-prefix>)"
               - `feedback bugs update <id> --status ready_for_qa`
               - If an item needs info you cannot get in CI (real device,
                 customer env, ambiguous repro), SKIP it: leave it
                 `in_progress` and note why in the PR body. Never guess.
            4. Push the branch and open ONE PR with `gh`. Do NOT override
               git author/committer — the action runs as the installed
               Claude GitHub App, so the commits and PR are attributed to
               `claude[bot]`. In the PR body, for every fixed bug that had
               a connector-tracked issue in THIS repo (step 3), add a
               `Closes #<number>` line so merging the PR closes that issue:
                 git push -u origin HEAD
                 gh pr create --title "Shipeasy feedback auto-fix" \
                   --body "$(printf '<punch-list: fixed / skipped, with bug ids>\n\nCloses #<n>\nCloses #<m>')"
               (Only reference issues whose owner/repo match this repo; a
               connector issue in a different repo can't be closed here —
               link it textually instead.)
            5. Link the PR back to each fixed bug in Shipeasy:
                 npx -y @shipeasy/cli feedback bugs link-pr <id> <pr-number>

            Hard rules: never set a bug to `resolved` (QA-only). Never
            delete feedback. Never use `--no-verify`. If the queue is
            empty, exit cleanly without opening a PR.
```

If `/install-github-app` left a sample `claude.yml`, delete it now so the
repo has exactly one Shipeasy workflow.

## 6. Verify with one manual run

Commit the workflow first (cron only fires for workflows on the default
branch), then trigger it manually so the user sees a green run before
trusting the schedule. **Confirm with the user before this step — it
spends tokens and may open a real PR.**

```bash
git add .github/workflows/shipeasy-feedback-autofix.yml
git commit -m "ci(feedback): scheduled Claude trigger to auto-fix Shipeasy queue"
git push

gh workflow run shipeasy-feedback-autofix.yml
sleep 5 && gh run list --workflow=shipeasy-feedback-autofix.yml --limit 1
gh run watch "$(gh run list --workflow=shipeasy-feedback-autofix.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

If the run fails, the usual culprits:

| Symptom in the run log                                    | Fix                                                                                                                                                                                                      |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401` / `403` from the shipeasy CLI                       | `SHIPEASY_CLI_TOKEN` missing/stale — re-run step 3.                                                                                                                                                      |
| Anthropic auth error                                      | `ANTHROPIC_API_KEY` secret missing/invalid — step 2.                                                                                                                                                     |
| `403 module not enabled`                                  | `shipeasy modules enable feedback`, then re-run.                                                                                                                                                         |
| PR step `gh: not authenticated`                           | Ensure job `permissions` block is present (step 5).                                                                                                                                                      |
| `gh pr create` 403 / "not allowed to create pull request" | Org/repo blocks Actions from opening PRs. Enable **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests** (org setting may override the repo). |
| App can't push / open PR                                  | Claude GitHub App not installed on the repo — step 2.                                                                                                                                                    |

## 7. Hand-off

Print:

```
✅ Shipeasy feedback Claude trigger provisioned
Schedule:  <CRON>  (UTC; manual run via the Actions tab anytime)
Workflow:  .github/workflows/shipeasy-feedback-autofix.yml
Secrets:   ANTHROPIC_API_KEY, SHIPEASY_CLI_TOKEN, SHIPEASY_PROJECT_ID
Does:      pulls active bugs + feature requests → fixes each → opens one
           PR as claude[bot] → closes any connector-tracked GitHub issue
           (Closes #N) → links the PR back to each bug + ready_for_qa.
Review:    PRs land for human review; nothing auto-merges.
Disable:   delete the workflow file, or comment out the `schedule:` block.
```

> **Verify later (PR creation):** the first scheduled or manual run is the
> real test that `claude[bot]` can push a branch and open the PR with the
> issue linked. If the Claude GitHub App lacks PR permission on the repo,
> the run will fix + commit but fail at `gh pr create` — re-check the app
> install (step 2) and the org PR-creation toggle (troubleshooting table).
