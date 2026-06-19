---
description: Provision a recurring, unattended feedback trigger that, on a schedule, runs /shipeasy:ops:work --pr against the bound project — burning down the bug + feature-request + error/alert queue and opening one PR per item. Provider-pluggable via --provider <platform>: claude (default; Claude Code scheduled routine in Anthropic's cloud, also registered as a Shipeasy connector), cursor, copilot, windsurf, codex, cline, openclaw, opencode, continue, gemini. Each provider schedules the SAME work — only the scheduler + headless launch + auth differ (native cloud scheduler, native local daemon, or headless run + external cron/Actions). Full per-platform walkthrough lives in TRIGGER-INSTALL.md. The claude flow does NOT use GitHub Actions; Tier-C providers (opencode/continue/gemini/codex) legitimately can.
argument-hint: "[--provider claude|cursor|copilot|windsurf|codex|cline|openclaw|opencode|continue|gemini] [--frequency daily|weekdays|weekly|6h] [--dry-run]"
---

## Provider selection

This command is **provider-pluggable**. Read `--provider` from `$ARGUMENTS`; if
omitted, default to `claude`. Every provider schedules the **same work** (the
ops:work `--pr` loop) — they differ only in **what schedules it**, **how the run
is launched**, and **how it authenticates**. Full copy-paste detail per platform
is in **[`TRIGGER-INSTALL.md`](../../../TRIGGER-INSTALL.md)** — read the matching
section there before provisioning a non-`claude` provider.

| `--provider` | Tier | Scheduler | Launch / headless |
| --- | --- | --- | --- |
| `claude` *(default)* | A — native cloud | `/schedule` routine (Anthropic cloud) | runs `/shipeasy:ops:work --pr`; **registers a Shipeasy connector** |
| `cursor` | A — native cloud | Cursor Automation / `POST /v1/agents` | `autoCreatePR`; auth `CURSOR_API_KEY` |
| `copilot` | A — native cloud | Copilot automations, or scheduled Actions + cloud agent | `gh agent-task` / CLI; needs PAT w/ Copilot Requests |
| `windsurf` | A — native cloud | Devin Scheduled Sessions (cron, cloud VM) | auth `WINDSURF_API_KEY`/`DEVIN_API_KEY` |
| `cline` | B — local daemon | `cline schedule create --cron` (`cline hub`) | `cline --auto-approve true` |
| `openclaw` | B — local daemon | `openclaw cron create` (gateway) | delegates to a coding-agent skill; **static API key only** |
| `codex` | C (confirmed) | GitHub Actions `schedule:` cron → **Codex Cloud** task (machine can be off); fallbacks: Codex Automations (local cron, machine-on) · `codex exec` external cron | install via `codex plugin marketplace add shipeasy-ai/shipeasy` + `codex plugin add shipeasy@shipeasy`; configure the Codex Cloud environment at chatgpt.com/codex/cloud/settings/environments |
| `opencode` | C — headless + cron | system cron / Actions `schedule:` | `opencode run` (`permission: "allow"`) |
| `continue` | C — headless + cron | system cron / Actions `schedule:` | `cn -p --auto` |
| `gemini` | C — headless + cron | Actions `schedule:` (run-gemini-cli) | `gemini -p --approval-mode=yolo` |

**Dispatch:**

- **`--provider claude`** → follow the rest of this document (steps 0–6) as
  written. It is the deepest, most automated flow and the only one that
  registers a Shipeasy connector.
- **Any other provider** → do **not** improvise. Do the shared prep, then follow
  that provider's section in `TRIGGER-INSTALL.md`:
  1. **Schedule** — ask the user the cadence (step 1 below) → cron.
  2. **Mint the restricted `ops` key + read the project id** (step 2 below) —
     this is provider-independent; the key is what the run authenticates with.
  3. **Build the trigger prompt** — the shared body in `TRIGGER-INSTALL.md`
     ("The work is identical everywhere"), substituting the `ops` key,
     project id, and the host's install line from `INSTALL.md`.
  4. **Provision the schedule on that platform** per its `TRIGGER-INSTALL.md`
     section — create the native automation (Tier A/B) or write the system-cron
     / GitHub Actions `schedule:` job (Tier C). Use the **Bash tool** to run any
     CLI/API steps; for UI-only steps (e.g. Cursor's PR toggle, a routine token)
     walk the user through them.
  5. **Verify** with one manual fire and confirm a PR (or empty-queue exit), and
     hand off where to pause/inspect it (the platform's own scheduler UI —
     connector registration in Shipeasy is `claude`-only today).
  Respect `--dry-run` (print the plan + prompt, mint nothing) and the Hard rules
  below (restricted `ops` key, never print secrets, confirm before a paid fire).

The steps below are the **`claude` provider** (and steps 1–2 are the shared prep
every provider reuses).

You are provisioning a **recurring, unattended Claude trigger** backed by a
**Claude Code scheduled routine** (the built-in `/schedule` feature). On the
schedule the user chooses, the routine runs Claude **in Anthropic's cloud** —
not on the user's machine, **not on GitHub Actions** — and runs
**`/shipeasy:ops:work --pr`** against the bound project: it burns down the
unified feedback queue (bugs, feature requests, auto-filed error/alert
tickets) one item at a time, commits each fix on its own branch, and opens
**one PR per fixed item** for review. When an item **can't** be fixed in code
(missing credential, a product call, an env/alert-rule knob only you can
change), the run **raises a "needs your attention" bell notification** with a
step-by-step guide instead of silently leaving it — so an unattended run still
surfaces what it needs. All the work logic lives in `ops:work`; the routine is
a thin wrapper around it.

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
- **(`claude` provider) Provision via `/schedule` only.** Create exactly one
  routine for this trigger. Do not write any `.github/` workflow file or touch
  GitHub Actions — the Claude provider has a native cloud scheduler and does not
  need them. (This rule is specific to `claude`; Tier-C providers —
  `opencode`/`continue`/`gemini`/`codex` — legitimately use system cron or a
  GitHub Actions `schedule:` job, per `TRIGGER-INSTALL.md`.)
- **Never print secret values into chat or any file.** The Shipeasy CLI token
  and the routine bearer token are read straight from local state and passed
  only to where they're needed — the CLI token substituted into the routine
  prompt's export lines, the routine bearer token into
  `shipeasy connectors create-trigger` (which encrypts it at rest) — never
  echoed into chat.
- **Treat the routine as sensitive — but mint it a restricted key.** The routine
  reads the Shipeasy queue unattended, so its prompt carries a Shipeasy key +
  `project_id` the run exports as env vars (Claude Code has no programmatic way
  to set a routine's env vars, so the prompt is the only hands-off channel).
  **Embed a freshly-minted `ops` key, never your own admin
  login token** (step 2): the `ops` key can only read the queue, flip item
  status, link the PR it opened back to an item (`feedback/:id/link-pr` — a
  single-purpose write), and create new resources (gates/configs/experiments/
  metrics/… + i18n key push/publish) — it cannot update, archive or delete
  anything that exists, mint keys, or edit item content — so a leaked routine
  prompt can't compromise the project. The `ops` key rolls its own expiry
  forward on each run, so it needs no manual rotation while the schedule fires.
  Say this to the user.
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
- **`/schedule` must be available — but do NOT probe for it.** Never run shell
  checks on `$ANTHROPIC_API_KEY` or any auth env var: it's a secret, and the
  Bash tool's environment doesn't reflect how the Claude Code session is
  authenticated anyway, so the probe produces false alarms. Just proceed and
  use `/schedule` at step 4. Only if it turns out to be unavailable there:
  the usual cause is API-key auth taking precedence over the claude.ai login
  routines require (`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` in the shell,
  or `apiKeyHelper` in settings.json) — tell the user to remove that credential
  and re-authenticate with their Claude.ai account, then stop.
- **A GitHub repo to open PRs against.** The routine runs
  `/shipeasy:ops:work --pr`, which opens real pull requests (one per fixed
  item) with `gh pr create`. This project must be a GitHub repo — `git remote -v` shows a
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

**Do NOT ask the user whether GitHub is already connected.** There is no status
command to check it, and the setup commands are idempotent — asking is pure
friction. Just run the connect, picked by what's on the machine:

- **`/web-setup` (when `gh` is installed + authed — run it, don't ask).** The
  built-in slash command syncs the user's local `gh` token to their Claude
  account. **Idempotent** — re-running when already connected just re-syncs, so
  there is nothing to pre-check.
- **Authorize the Claude GitHub App (when `gh` isn't available).** A pure
  browser OAuth consent (claude.ai/code web onboarding, or
  `github.com/apps/claude`; `/install-github-app` also walks the App install) —
  no local `gh` — and grants cloud sessions access to every repo the account
  can see (clone + push + open PRs).

Either method is sufficient. `/schedule` validates GitHub access itself when
the routine is created (step 4) and prompts if it's missing — so a connect that
can't complete here surfaces there; only stop early if the user declines the
consent outright.

Notes:

- **The cloud routine does not need `gh` installed to open a PR.** Claude Code's
  built-in GitHub tooling clones, pushes, and opens PRs through the GitHub proxy
  (the token never enters the container). `gh` in the cloud env is only needed
  for advanced commands like `gh release` — not for this flow.
- Installing the app on a specific repo is optional — authorization alone covers
  push/PR; a per-repo install only adds Auto-fix PR webhooks.
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

## 2. Mint the restricted Shipeasy key the routine needs

The routine authenticates via the CLI's env-var path: every `shipeasy` call
checks `SHIPEASY_CLI_TOKEN` + `SHIPEASY_PROJECT_ID` **before** its config file,
so the prompt simply carries the two values and tells the run to export them —
no config-file write needed. The prompt is the only hands-off channel for this:
Claude Code has no API or CLI to set a routine's env vars programmatically
(that's UI-only), and making the user paste secrets into the `/schedule` UI by
hand is exactly what this flow avoids. One caveat the prompt must spell out:
each Bash step in a run gets a **fresh shell**, so the exports go at the top of
every shell invocation that calls `shipeasy` — a single export at run start
would not reach later commands.

**Mint a dedicated, restricted `ops` key for the routine — do NOT embed your
own login token.** Your `shipeasy login` token is a full-admin key (it can
create/delete gates, configs, experiments, mint keys, change billing). The
routine only needs to read the queue, flip status, link the PRs it opens, and
create resources, so mint an `ops` key instead: it is default-denied against
every admin route except the `ops:work` queue + status writes + the
single-purpose `feedback/:id/link-pr` + create-only dev ops, **never edits or
deletes existing resources**, and **auto-extends its 7-day expiry on each run**
(it self-revokes ~a week after the trigger stops firing). Read the values
**into shell vars, never print**:

```bash
SE_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/shipeasy/config.json"
test -f "$SE_CONFIG" || { echo "Run 'shipeasy login' first"; exit 1; }

# Mint the restricted ops key with your logged-in admin session. The raw key is
# shown ONCE — capture it here; it never needs to be retrieved again.
# (@latest is required: --type ops needs CLI >= 1.10.0 and a bare `npx
# @shipeasy/cli` happily reuses an older cached binary.)
SHIPEASY_CLI_TOKEN="$(npx -y @shipeasy/cli@latest keys create --type ops --json | jq -r .key)"
SHIPEASY_PROJECT_ID="$(jq -r .project_id "$SE_CONFIG")"
test -n "$SHIPEASY_CLI_TOKEN" && test "$SHIPEASY_CLI_TOKEN" != "null" \
  || { echo "Failed to mint ops key — is 'shipeasy login' valid?"; exit 1; }
```

> **`--dry-run`:** do **not** mint — minting an `ops` key is a real side effect.
> Just note that an `ops` key *would* be minted and embedded, then continue to
> step 3.

`SHIPEASY_CLI_TOKEN` now holds the restricted `ops` key. It gets substituted
into the export lines of the step-4 prompt.
Because it rolls its own expiry forward on use, **no manual rotation is needed**
while the schedule fires more often than every 7 days. If the trigger is paused
longer than that the key lapses — re-run this command (or
`shipeasy keys create --type ops`) to mint a fresh one and update the routine
prompt.

## 3. (If `--dry-run`) stop here

Print the chosen cron, whether the Shipeasy creds were found, whether GitHub is
connected for cloud sessions (step 0), and the routine prompt that _would_ be
created. Exit without creating the routine.

## 4. Create the routine with `/schedule`

Use the built-in **`/schedule`** command to create one scheduled routine on
`<CRON>`. Point it at the **GitHub repo confirmed in the prerequisites** (the
one with the `github.com` remote, connected in Claude Code) — that's the repo
the routine checks out and opens its PR against. The routine prompt is a thin
wrapper: export the Shipeasy env vars to authenticate, refresh the plugin + CLI
so each run picks up the latest commands, then
run the ops:work workflow in `--pr` mode (which owns the whole pull → fix →
commit → PR-per-item → status flip → auto-close-the-issue flow). **If a `shipeasy` cloud
environment already exists (step 4a), select it for the routine at creation** —
that skips the network walkthrough entirely. Substitute the **two real
values from step 2** wherever the placeholders appear — `<OPS_KEY>` is the
minted `ops` key (`$SHIPEASY_CLI_TOKEN`) and `<PROJECT_ID>` is
`$SHIPEASY_PROJECT_ID`. The prompt:

```
You are an unattended Shipeasy maintenance run. Authenticate every `shipeasy`
call with these env vars — the CLI reads them directly; do NOT run
`shipeasy login` and never echo the token:

export SHIPEASY_CLI_TOKEN="<OPS_KEY>"
export SHIPEASY_PROJECT_ID="<PROJECT_ID>"

Each shell command runs in a fresh environment, so put these two exports at
the top of EVERY shell invocation that runs `shipeasy` — they do not persist
from an earlier command.

The CLI's mutating commands additionally require the repo to be bound to the
project via a `.shipeasy` file (searched up from cwd). If this checkout doesn't
have one (some repos gitignore it), create it in the repo root — it only holds
the project id, no secret:

test -f .shipeasy || printf '{"project_id":"<PROJECT_ID>"}\n' > .shipeasy

If you created `.shipeasy` just now, never commit it — stage exact paths per
fix; the file must not appear in the PR diff.

First, refresh to the LATEST plugin AND CLI — the workflow definition changes
between releases and every run must use the current one (the plugin ships the
slash commands; @shipeasy/cli is the separate binary the workflow calls). This
is a fresh container, so the shipeasy marketplace is NOT registered yet — add
it before installing, falling back to update if it already exists:

claude plugin marketplace add shipeasy-ai/shipeasy || claude plugin marketplace update shipeasy
claude plugin install shipeasy@shipeasy
npm install -g @shipeasy/cli@latest

Then execute the ops:work workflow in --pr mode. IMPORTANT: a plugin installed
mid-session does not register its slash commands with the already-running
session, so invoking /shipeasy:ops:work will report "Unknown skill" — that is
expected. Do NOT improvise the workflow from memory: it changes between
releases and only the file you just installed is current. Resolve the latest
copy deterministically — prefer the marketplace clone the commands above just
refreshed, falling back to the highest version in the plugin cache:

WORK_MD=$(find ~/.claude/plugins/marketplaces -path '*shipeasy*' -name work.md 2>/dev/null | head -1)
test -n "$WORK_MD" || WORK_MD=$(find ~/.claude/plugins/cache -path '*shipeasy*' -name work.md 2>/dev/null | sort -V | tail -1)

Read that file and follow its instructions verbatim, exactly as if
/shipeasy:ops:work had been invoked with the --pr flag — the file's
instructions take precedence over this prompt's summary if they differ. It
burns down the unified feedback queue (bugs, feature requests, and the
auto-filed error/alert tickets), commits each fixed item on its own branch,
opens ONE pull request PER item for human review, flips each fixed item to
ready_for_qa, and adds a "Closes #<issue>" keyword for any item with a
connected GitHub issue so merging auto-closes it.

Open every PR from a claude/-prefixed branch (the prefix routines are allowed
to push by default), e.g. claude/ops-<number>-<slug>. If the queue is empty
it exits cleanly without opening any PR. Don't merge.
```

After `/schedule` creates the routine, capture **`ROUTINE_ID`** — the routine's
id (shown by `/schedule` / its routine list). Then do 4a (required) and 4b.

## 4a. The `shipeasy` cloud environment — network allowlist (required)

**Without this, the first run fails on every `shipeasy` call.** New cloud
environments default to **Trusted** network access — package registries +
GitHub only — so the run can `npm install` and push branches, but
`shipeasy.ai` / `api.shipeasy.ai` are unreachable. There is no `/schedule`
flag for any of this; environments are **UI-only**.

**Preferred: a dedicated, reusable `shipeasy` environment (one-time).** If one
already exists on the account, just make sure this routine uses it (selected at
creation in step 4, or switch via routine → edit → cloud icon) and move on to
4b — nothing to configure. Otherwise create it now so this and every future
trigger picks it from a list instead of repeating the walkthrough:

1. Open https://claude.ai/code/routines → this routine → edit → click the
   cloud icon → create a new environment named **`shipeasy`** (or open
   settings → **Update cloud environment** to fix up the existing one).
2. Set **Network access** to **Custom** and add to **Allowed domains** (one
   per line; `*.` wildcards are supported):

   ```
   shipeasy.ai
   api.shipeasy.ai
   ```

3. Check **"Also include default list of common package managers"** — the run
   still needs npm to install the CLI. (GitHub clone/push/PR rides a separate
   GitHub proxy and is unaffected by this setting.)
4. Save, and make sure the routine is set to this environment. The policy
   applies from the next run.

> **Optional, single-project accounts:** the same environment can also carry
> `SHIPEASY_CLI_TOKEN` + `SHIPEASY_PROJECT_ID` as environment variables, which
> lets you drop the two export lines from the routine prompt entirely. Skip
> this when triggers for multiple Shipeasy projects share the environment —
> the env pins one project; per-routine prompt exports don't.

## 4b. Register the routine as a Shipeasy connector

Record the trigger in Shipeasy so it shows up in **Feedback → Connectors** and
can be fired on demand or auto-fired on new feedback.

**The routine's fire token (`ROUTINE_TOKEN`) is web-UI-only — don't hunt for a
programmatic path.** The bearer for
`POST /v1/claude_code/routines/<id>/fire` is generated per routine in the
routines UI, shown **once**, and there is no API or CLI to mint or read it
(`api_token_hint` stays empty until one exists). Walk the user through it:

1. Open https://claude.ai/code/routines → this routine → **Select a trigger** →
   add an **API** trigger → **Generate token**, and copy it.
2. Hand it over without pasting into chat — copy to clipboard, then run:

   ```bash
   sh -c 'umask 077; pbpaste > /tmp/.se_routine_token; echo saved'   # macOS
   # Linux: xclip -o (or wl-paste) > /tmp/.se_routine_token
   ```

3. Register, reading the token from the file (the CLI encrypts it at rest;
   **never echo it**), then shred the temp file:

   ```bash
   npx -y @shipeasy/cli connectors create-trigger \
     --routine-id "$ROUTINE_ID" \
     --token "$(cat /tmp/.se_routine_token)"
   rm -f /tmp/.se_routine_token
   ```

This step is **deferrable**: the schedule is already live without it — the
connector only adds "Fire now" + event auto-fire in the Feedback tab. If the
user doesn't want to fetch the token now, skip to step 6 and note in the
hand-off how to register later (steps 1–3 above).

The connector is registered **enabled but with auto-fire off** — "Fire now"
works immediately, but no run kicks off on a new bug/feature until the user
subscribes events in the Connectors panel (or you pass
`--events bug.created,feature_request.created`). Pass `--text "<prompt>"` to set
the default prompt sent when the routine is fired on demand.

> **Token rotation:** the token is rotated from the same API-trigger modal
> (**Regenerate** / **Revoke**). After a rotation, re-run
> `connectors create-trigger` (steps 1–3 above) so the stored credential stays
> valid.

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
| `401` / `403` firing the routine                   | Routine fire token wrong/stale — **Regenerate** it in the routine's API-trigger modal and re-run step 4b. |
| Network errors / timeouts reaching `api.shipeasy.ai` inside the run | The environment's network access is still the Trusted default — allowlist the Shipeasy domains (step 4a). |
| `401` / `403` from the shipeasy CLI inside the run | The embedded `ops` key lapsed (trigger paused > 7 days) — mint a fresh one (`shipeasy keys create --type ops`) and update the routine prompt (step 4). |
| `403 ops key not permitted for this operation`     | `ops:work` hit an admin route outside the ops allow-list (it shouldn't) — update the plugin/CLI to the latest; if it persists, file it.            |
| `403 module not enabled`                           | `shipeasy modules enable feedback`, then re-fire.                                                |
| Routine not found                                  | The `/schedule` routine was deleted — re-create it (step 4).                                     |

## 6. Hand-off

Print:

```
✅ Shipeasy feedback Claude trigger provisioned
Schedule:  <CRON>  (UTC; managed with /schedule)
Routine:   <ROUTINE_ID>  (Claude Code scheduled routine — runs in the cloud)
Creds:     restricted `ops` key carried in the routine prompt and exported as
           env vars per shell (queue reads + item status flips + PR back-link
           [feedback/:id/link-pr] + create-only dev ops [gates/configs/
           experiments/metrics/… + i18n push/publish] — no update/archive/
           delete of existing resources; auto-extends its 7-day expiry on use).
Connector: registered in Shipeasy → Feedback → Connectors ("Claude trigger"),
           backed by the routine. "Fire now" fires it on demand; toggle event
           auto-fire there to fire it on each new bug/feature.
Does:      updates the plugin + CLI → runs the ops:work workflow in --pr mode →
           fixes each queue item (bugs, features, error/alert tickets) → opens
           one PR PER item (Closes #issue for connected items) → ready_for_qa.
Review:    PRs land for human review; nothing auto-merges.
Portal:    https://claude.ai/code/routines  — open the routine in the browser:
           view runs, edit the prompt/schedule, pause or delete it.
Env vars:  changeable from that UI — edit the routine → click the cloud icon
           (the environment, e.g. "Default") → settings → "Update cloud
           environment" → Environment variables (.env format, one KEY=value
           per line; no quotes). To move the creds out of the prompt entirely,
           set SHIPEASY_CLI_TOKEN + SHIPEASY_PROJECT_ID there and delete the
           two export lines from the routine prompt — the CLI reads the
           environment's vars directly.
Network:   routine runs in the `shipeasy` cloud environment — Custom network
           with shipeasy.ai + api.shipeasy.ai allowed plus the package-manager
           defaults (step 4a). Reusable: future triggers just select it.
Manage:    edit/pause/delete the schedule with /schedule; delete the connector
           from the Feedback → Connectors panel.
```

> **Verify later:** the first scheduled or manual fire is the real test that
> the routine can read the Shipeasy queue and open a PR. If it fails on
> Shipeasy auth, the embedded `ops` key has lapsed (the trigger was paused
> longer than its 7-day sliding window) — mint a fresh one with
> `shipeasy keys create --type ops` and update the routine prompt (step 4), or
> set it once in the routine's cloud-environment variables (see "Env vars" in
> the hand-off) so future rotations are a UI-only edit.
