---
name: ops-create_trigger
description: "Provision a recurring, unattended feedback trigger that, on a schedule, runs /shipeasy:ops:work --pr against the bound project — burning down the bug + feature-request + error/alert queue and opening one PR per item. Provider-pluggable via --provider <platform>: claude (default; Claude Code scheduled routine in Anthropic's cloud, also registered as a Shipeasy connector), cursor, copilot, windsurf, codex, cline, openclaw, opencode, continue, gemini. Each provider schedules the SAME work — only the scheduler + headless launch + auth differ (native cloud scheduler, native local daemon, or headless run + external cron/Actions). Full per-platform walkthrough lives in TRIGGER-INSTALL.md. The claude flow does NOT use GitHub Actions; Tier-C providers (opencode/continue/gemini/codex) legitimately can."
argument-hint: "[--provider claude|cursor|copilot|windsurf|codex|cline|openclaw|opencode|continue|gemini] [--frequency 4h|6h|daily|weekdays|weekly] [--dry-run]"
user-invocable: true
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
| `claude` *(default)* | A — native cloud | `RemoteTrigger` routine (`/v1/code/triggers`, Anthropic cloud) | `shipeasy trigger create` emits the body → agent creates it via RemoteTrigger; runs `ops:work --pr`; **registers a Shipeasy connector** |
| `cursor` | A — native cloud | Cursor Automation / `POST /v1/agents` | `autoCreatePR`; auth `CURSOR_API_KEY` |
| `copilot` | A — native cloud | Copilot automations, or scheduled Actions + cloud agent | `gh agent-task` / CLI; needs PAT w/ Copilot Requests |
| `windsurf` | A — native cloud | Devin Scheduled Sessions (cron, cloud VM) | auth `WINDSURF_API_KEY`/`DEVIN_API_KEY` |
| `cline` | B — local daemon | `cline schedule create --cron` (`cline hub`) | `cline --auto-approve true` |
| `openclaw` | B — local daemon | `openclaw cron create` (gateway) | delegates to a coding-agent skill; **static API key only** |
| `codex` | C (confirmed) | GitHub Actions `schedule:` cron whose job runs **`codex cloud exec --env <ENV_ID>`** → **Codex Cloud** task (machine off); fallbacks: Codex Automations (local cron, machine-on) · in-runner `codex exec` | install via `codex plugin marketplace add shipeasy-ai/shipeasy` + `codex plugin add shipeasy@shipeasy`. **Do the work upfront:** write the workflow file, open the Codex Cloud environment page (chatgpt.com/codex/cloud/settings/environments) in the browser, PAUSE for the user to set network + `SHIPEASY_CLI_TOKEN`/`SHIPEASY_PROJECT_ID` there, then commit. Repo secrets: `CODEX_API_KEY` + `CODEX_ENV_ID`. Instant trigger / verify = `codex cloud exec --env <ENV_ID> "<prompt>"` |
| `opencode` | C — headless + cron | system cron / Actions `schedule:` | `opencode run` (`permission: "allow"`) |
| `continue` | C — headless + cron | system cron / Actions `schedule:` | `cn -p --auto` |
| `gemini` | C — headless + cron | Actions `schedule:` (run-gemini-cli) | `gemini -p --approval-mode=yolo` |

**Dispatch:**

- **`--provider claude`** → follow the rest of this document (the hybrid-split
  steps). It is the deepest, most automated flow and the only one that registers
  a Shipeasy connector.
- **Any other provider** → do **not** improvise. Do the shared prep, then follow
  that provider's section in `TRIGGER-INSTALL.md`:
  1. **Schedule** — ask the user the cadence (step 1 below) → cron.
  2. **Mint the restricted `ops` key + read the project id** — provider-
     independent (`shipeasy i18n keys create --type ops --json` + the `.shipeasy`
     project id); the key is what the run authenticates with. (For `claude`,
     `shipeasy trigger create` mints it for you — step 2 below.)
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


## The `claude` provider — hybrid split

The routine that runs the schedule lives in **Anthropic's cloud** and is created
over the **`/v1/code/triggers`** API. That API is reachable only by the agent's
**in-process `RemoteTrigger` tool** (OAuth added automatically, never exposed) —
**not** by a standalone CLI and **not** by `curl`. So this is a **hybrid split**:

- **`shipeasy trigger create`** (Bash tool) does the Shipeasy side a binary can
  own — mints the restricted `ops` key, resolves repo + cron, builds the routine
  prompt, and **emits the exact `RemoteTrigger` create body** to a `0600` file.
- **You (the agent)** read that body, pick an `environment_id` from your
  `RemoteTrigger` env list, and call **`RemoteTrigger {action:"create"}`**, then
  **`{action:"run"}`** to verify.
- **`shipeasy trigger link --routine-id <id>`** registers the routine as a
  Shipeasy connector.

There is **no `/schedule` slash command, no GitHub Actions, no `.github/` file**
in this flow.

## Hard rules

- **Use the Bash tool for every `shipeasy` command** — don't ask the user to run
  them.
- **Restricted key, never your login token.** `shipeasy trigger create` mints a
  dedicated `ops` key (queue reads + status flips + `feedback/:id/link-pr` +
  create-only dev ops; no edits/deletes; auto-extends its 7-day expiry on use).
  Say this to the user.
- **Never echo the ops key into chat.** The CLI writes the create body (which
  embeds the key in the routine prompt — the only hands-off channel, since
  routine env vars are UI-only) to a `0600` temp file and prints only a masked
  summary. Pass the body to `RemoteTrigger` by reading that file; do not paste
  the key into the conversation.
- **Don't fire a paid run without telling the user.** The verify run
  (`RemoteTrigger {action:"run"}`) spends tokens and may open a real PR. Confirm
  first.

## Prerequisites (verify in order; stop at the first failure)

```bash
test -f .shipeasy && echo ".shipeasy OK"          # base onboarding + bound project
shipeasy login                                      # idempotent — no-op if already logged in
shipeasy whoami | grep -q "feedback" || echo "RUN /shipeasy:ops:install"   # feedback module on
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git remote -v | grep -q github.com \
  && echo "GitHub repo OK"
```

- No `.shipeasy` → run `/shipeasy:setup`; stop.
- `feedback` module absent → run `/shipeasy:ops:install`; stop.
- No `github.com` remote → the routine opens real PRs and has nowhere to push;
  stop and have the user point the project at a GitHub repo.
- **Do NOT probe `$ANTHROPIC_API_KEY`** — it's a secret and the Bash env doesn't
  reflect the session's auth anyway. `RemoteTrigger` handles auth in-process.

## 0. Connect GitHub for cloud sessions (one-time)

The routine clones, pushes a `claude/…` branch, and opens its PR under the
user's connected GitHub identity. Connect it (idempotent — don't ask whether
it's already connected):

- **`/web-setup`** when `gh` is installed + authed (syncs the local `gh` token to
  the Claude account), or
- **Authorize the Claude GitHub App** (browser OAuth: `github.com/apps/claude`)
  when `gh` isn't available.

If the user can't complete the consent, stop — a routine that can't open a PR
just burns tokens.

## 1. Ask the cadence

Call **AskUserQuestion** for the schedule (skip if `--frequency` was passed). Map
to the `--frequency` value: `4h` (default), `6h`, `daily`, `weekdays`, `weekly`,
or a raw 5-field cron. (The routines API enforces a **1-hour minimum interval**.)

## 2. Run the Shipeasy-side prep

```bash
shipeasy trigger create --frequency <FREQ>        # add --repo <url> if origin isn't the target
```

(`--dry-run` prints the plan and mints nothing.) On success it mints the `ops`
key and prints a **body file path** plus a redacted summary. It does NOT create
the routine — you do, next. Relay the summary (not the key) to the user.

## 3. Pick the cloud environment

The create body has `"environment_id": "<FILL…>"`. List your environments
(they're shown when `/schedule`'s skill loads, or infer from a prior
`RemoteTrigger` context) and pick one whose **network access allows
`shipeasy.ai` + `api.shipeasy.ai`** (plus the package-manager defaults — the run
`npm install`s the CLI). New environments default to **Trusted** (registries +
GitHub only), which would fail every `shipeasy` call.

- A suitable env exists (e.g. one named `shipeasy`) → use its `env_…` id.
- None exists → walk the user through creating one at
  `https://claude.ai/code/routines` → environment → **Custom** network +
  allowed domains `shipeasy.ai`, `api.shipeasy.ai`, "include common package
  managers". Reusable for every future trigger. (Network config is UI-only.)

## 4. Create the routine via RemoteTrigger

Read the body file, replace `environment_id` with the chosen `env_…`, then:

```
RemoteTrigger { action: "create", body: <the edited body> }
```

Capture the returned **`trig_…`** id. (This is the create the old `/schedule`
flow did — now one tool call, no UI.)

## 5. Register the Shipeasy connector

```bash
shipeasy trigger link --routine-id trig_<id>
```

Idempotent by routine id; registers a **tokenless** connector (shows in
Feedback → Connectors as registered but not yet "Fire now"-able). It's the
baseline — the fire token (step 7) is the optional upgrade.

## 6. Verify with one manual run (confirm first — spends tokens)

```
RemoteTrigger { action: "run", trigger_id: "trig_<id>" }
```

Confirm a PR appears (or a clean empty-queue exit). If it fails on Shipeasy auth
inside the run, the `ops` key lapsed (trigger paused > 7 days) — re-run step 2
and re-create. If it fails reaching `api.shipeasy.ai`, the environment's network
is still Trusted — fix step 3.

## 7. (Optional) Add the fire token

The fire token (for "Fire now" + event auto-fire) is **web-UI-only** — there is
no API to mint or read it. To enable it: open
`https://claude.ai/code/routines` → this routine → add an **API** trigger →
**Generate token**, copy it, then:

```bash
shipeasy trigger link --routine-id trig_<id> --token "<token>" \
  --events bug.created,feature_request.created   # optional auto-fire
```

(Re-runs the idempotent link, upgrading the same connector in place.) Deferrable
— the schedule already fires without it.

## 8. Hand-off

```
✅ Shipeasy feedback Claude trigger provisioned
Schedule:  <CRON>  (UTC; 1h minimum interval)
Routine:   trig_<id>  (Anthropic cloud — manage at claude.ai/code/routines)
Creds:     restricted `ops` key embedded in the routine prompt (queue reads +
           status flips + link-pr + create-only dev ops; auto-extends 7-day
           expiry on use).
Connector: Shipeasy → Feedback → Connectors ("Claude trigger").
Does:      updates plugin + CLI → runs ops:work --pr → one PR PER fixed item
           (Closes #issue for connected items) → ready_for_qa. Nothing merges.
Manage:    edit/pause the routine at claude.ai/code/routines (RemoteTrigger
           update/run; delete is UI-only). Re-run /shipeasy:ops:create_trigger
           to mint a fresh ops key if the trigger was paused > 7 days.
```
