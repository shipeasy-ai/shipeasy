# Installing the Shipeasy feedback trigger on any platform

A **trigger** is an *unattended, scheduled* agent run: on a cron cadence it runs
**`/shipeasy:ops:work --pr`** against your project — burning down the feedback
queue (bugs, feature requests, auto-filed error/alert tickets) one item at a
time, committing each fix on its own branch, and opening **one PR per item** for
review. No human in the loop.

`/shipeasy:ops:create_trigger --provider <platform>` provisions it. The
`--provider` value is the platform that hosts the scheduled run:

```
claude · cursor · copilot · windsurf · codex · cline · openclaw · opencode · continue · gemini
```

> Also published at <https://docs.shipeasy.ai/get-started/triggers>. For
> installing the skills + MCP themselves (a prerequisite), see
> [`INSTALL.md`](./INSTALL.md).

> **One job, three scheduler shapes.** Every provider runs the *same* work — the
> only thing that differs is **what schedules it** and **how the run is launched
> + authenticated**. Platforms fall into three tiers:
>
> - **Tier A — native cloud scheduler** (`claude`, `cursor`, `copilot`,
>   `windsurf`): a managed cron runs the agent in the vendor's cloud. Machine
>   can be off. Cleanest.
> - **Tier B — native local-daemon scheduler** (`cline`, `openclaw`): a built-in
>   scheduler runs it, but on a daemon on *your* machine — the host must stay
>   awake.
> - **Tier C — headless run + external scheduler** (`opencode`, `continue`,
>   `gemini`, `codex`, and `cline` if you prefer): the CLI has a non-interactive
>   run mode but no scheduler, so a **system cron** or a **GitHub Actions
>   `schedule:` cron** drives it. For `codex` the confirmed flow is a GitHub
>   Actions `schedule:` cron driving a **Codex Cloud** task (machine can be off);
>   see its section below.

## The work is identical everywhere — only the launch differs

Whatever the provider, the scheduled run executes this **trigger prompt** (the
same one the Claude routine uses). For headless CLIs it's the prompt you pass;
for cloud agents it's the task body:

```
You are an unattended Shipeasy maintenance run. Authenticate every `shipeasy`
call with these env vars (the CLI reads them directly — do NOT run
`shipeasy login`, never echo the token). Put them at the top of EVERY shell
invocation that calls `shipeasy`; each command runs in a fresh shell:

export SHIPEASY_CLI_TOKEN="<OPS_KEY>"
export SHIPEASY_PROJECT_ID="<PROJECT_ID>"

Ensure the repo is bound: test -f .shipeasy || printf '{"project_id":"<PROJECT_ID>"}\n' > .shipeasy
(never commit .shipeasy).

Refresh to the latest plugin + CLI, then run ops:work in --pr mode:
  <PLUGIN-INSTALL-FOR-THIS-HOST>          # e.g. claude/copilot plugin install, or skills add
  npm install -g @shipeasy/cli@latest
Then follow the installed ops:work (--pr) workflow verbatim: burn down the
queue, one atomic diff per item, open ONE PR per item from a safe branch
prefix, flip each to ready_for_qa, add "Closes #<issue>" where an item has a
connected GitHub issue. If the queue is empty, exit cleanly. Never merge.
```

`<OPS_KEY>` is a restricted **`ops`** key (mint with
`npx -y @shipeasy/cli@latest keys create --type ops` — it can read the queue,
flip status, link the PR it opens, and create resources, but never edits/deletes
existing ones, and auto-extends its 7-day expiry on each run). `<PROJECT_ID>`
comes from `~/.config/shipeasy/config.json`. **Never print either value.**

`<PLUGIN-INSTALL-FOR-THIS-HOST>` is the host's install line from
[`INSTALL.md`](./INSTALL.md): the plugin install for `claude`/`copilot`, or
`npx -y skills add https://github.com/shipeasy-ai/shipeasy/tree/main/shipeasy -a <agent>`
for the rest. The run also needs `@shipeasy/mcp` reachable — most hosts already
have it from setup.

---

## Tier A — native cloud scheduler

### `claude` — Claude Code scheduled routine

The reference implementation. `/schedule` creates a routine that runs in
Anthropic's cloud on your cron, opens PRs through the GitHub proxy, and
registers as a Shipeasy **connector** (Feedback → Connectors, with "Fire now").
**Does not use GitHub Actions.** Full walkthrough:
`/shipeasy:ops:create_trigger --provider claude` (see
[`shipeasy/commands/ops/create_trigger.md`](./shipeasy/commands/ops/create_trigger.md)).
GitHub access is connected once via `/web-setup` (or the Claude GitHub App), and
the cloud environment needs `shipeasy.ai` + `api.shipeasy.ai` on its network
allowlist (Custom network).

### `cursor` — Cursor Automations / Cloud Agents API

Native cron-driven cloud agents ([cursor.com/automations](https://cursor.com/automations)).
Two ways:

- **UI:** create an Automation → cron + the trigger prompt → enable **Pull
  request creation**. Runs in an isolated cloud env, no local machine.
- **API (scriptable):**
  ```bash
  curl -s https://api.cursor.com/v1/agents \
    -H "Authorization: Bearer $CURSOR_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{ "prompt": { "text": "<TRIGGER PROMPT>" },
          "repos": [{ "url": "https://github.com/<owner>/<repo>", "startingRef": "main" }],
          "autoCreatePR": true }'
  ```
  Schedule it with the Automations cron (the API launches one run; the
  Automation is the recurring wrapper). `autoCreatePR` opens the PR via Cursor's
  GitHub App. Auth: `CURSOR_API_KEY` (user or service-account key).
- **Note:** Automations always run in Max Mode (billed on cloud-agent usage).

### `copilot` — Copilot automations / cloud agent

GitHub shipped native **Copilot automations** (June 2026): repo **Agents tab →
Automations**, **hourly/daily/weekly** (no raw cron), runs the cloud agent and
opens PRs hands-off. **Private/internal repos only** today.

For true cron / public repos, drive the cloud agent from a scheduled Actions
workflow — either `gh agent-task create "<TRIGGER PROMPT>"` (GitHub CLI ≥2.80),
or assign an issue to `copilot-swe-agent` via the GraphQL assignment API.
**Auth caveat:** the cloud-agent assignment API and the Copilot CLI both reject
the default Actions `GITHUB_TOKEN` — they need a **user PAT with the "Copilot
Requests" permission** (and a Copilot subscription).

### `windsurf` — Devin Scheduled Sessions

Windsurf 2.0 is powered by Devin (Cognition); `docs.windsurf.com` →
`docs.devin.ai`. Devin **Scheduled Sessions** take a real cron, run on Devin's
cloud VMs, and open PRs natively with the GitHub integration connected. The
legacy in-IDE Cascade agent alone is GUI-only and can't do this — the capability
is entirely the Devin layer. Auth: `WINDSURF_API_KEY` / `DEVIN_API_KEY`
(service-user token, `cog_`/`apk_`).

---

## Tier B — native local-daemon scheduler

The schedule is built in, but runs on a daemon on your machine — keep the host
awake (CI/Tier-C is the always-on alternative).

### `cline` — `cline schedule`

Cline CLI 2.0 (`npm i -g cline`) ships a first-party scheduler backed by a local
daemon (`cline hub`):

```bash
cline auth --provider anthropic --apikey "$ANTHROPIC_API_KEY"
cline schedule create "shipeasy-feedback" \
  --cron "0 9 * * 1-5" \
  --workspace /path/to/repo \
  --prompt "<TRIGGER PROMPT>"
# manage: cline schedule list | get | trigger | history
```

The unattended run uses `cline --auto-approve true` semantics. Opens PRs by
shelling out to `git` + `gh` (needs `gh` authed in the daemon's env).

### `openclaw` — `openclaw cron`

OpenClaw's gateway has built-in cron; it delegates the coding work to a
background coding agent (Claude Code / Codex / OpenCode) via its `coding-agent`
skill, which does branch → implement → open PR:

```bash
openclaw cron create "0 9 * * 1-5" "<TRIGGER PROMPT>" \
  --name shipeasy-feedback --session isolated --tz UTC
```

**Auth caveat:** isolated sessions seed only **static API-key** credential
profiles — OAuth profiles do not seed — so the embedded coding agent must be
configured with an API key, not a login.

### `codex` — confirmed flow: Codex plugin + GitHub Actions cron → Codex Cloud

This is the **verified, recommended** Codex path (confirmed working 2026-06-18).
Codex now has its own plugin system that **mirrors Claude's**, so the Shipeasy
slash commands + `ops:work` workflow install the same way; a **GitHub Actions
`schedule:` cron** drives a **Codex Cloud** task on each fire (the always-on
cloud path — machine can be off); and the run's network + secrets are configured
**once**, in the Codex Cloud environment.

**1. Install the Shipeasy plugin in Codex (one-time, in your terminal).** This
is the Codex analog of `claude plugin marketplace add` / `claude plugin install`:

```bash
codex plugin marketplace add shipeasy-ai/shipeasy
codex plugin add shipeasy@shipeasy
```

The command is then available in the Codex harness as:

```
@Shipeasy /shipeasy:ops:create_trigger --provider codex --frequency daily
```

That same plugin-install pair is the `<PLUGIN-INSTALL-FOR-THIS-HOST>` line in the
shared trigger prompt — for Codex it is
`codex plugin marketplace add shipeasy-ai/shipeasy && codex plugin add shipeasy@shipeasy`
(NOT the `claude plugin …` lines the `claude` routine uses).

**2. Configure the Codex Cloud environment (UI-only — open the page and WAIT).**
The scheduled run executes in a **Codex Cloud environment**, which defaults to a
restricted network and carries no Shipeasy creds — so the first run cannot reach
`api.shipeasy.ai` or authenticate until this is set up, and there is no CLI/API
for it. **Open the environments settings page, hand it to the user, and ask them
to return when they're done so you can finish configuring the trigger:**

  https://chatgpt.com/codex/cloud/settings/environments

This is the Codex analog of Claude's `shipeasy` cloud environment (step 4a in
`create_trigger.md`). In that page:

- **Network access** → allow `shipeasy.ai` and `api.shipeasy.ai`, keeping the
  default package-manager allowlist so `npm install -g @shipeasy/cli@latest`
  still works (GitHub clone/push/PR rides Codex's own GitHub integration and is
  unaffected).
- **Environment variables / secrets** → set `SHIPEASY_CLI_TOKEN` (the restricted
  `ops` key — see Auth & safety below; never an admin/login token) and
  `SHIPEASY_PROJECT_ID`. Setting them here lets you drop the two `export` lines
  from the trigger prompt.

**The Codex Cloud task runs under the user's own ChatGPT/Codex account token —
confirm with the user that it's their token being used** before you provision
the schedule.

**3. Schedule it with a GitHub Actions `schedule:` cron** on `<CRON>` whose run
step kicks off the Codex Cloud task (the environment from step 2 supplies its
network + creds). Use the Tier-C GitHub Actions shape below, swapping the run
step for the Codex Cloud dispatch.

> **Fallbacks, if you don't want the Actions-cloud path:** (a) **Codex
> Automations** (Codex app → Automations) take full cron but run **locally — the
> machine must be powered on** when they fire; (b) **Tier C `codex exec`** —
> `codex exec --sandbox danger-full-access "<PROMPT>"` driven by system cron or
> the same Actions `schedule:` job, running in the runner itself (configure creds
> as Actions secrets, not the Cloud environments page). A fully-cloud, machine-off
> native Automations cron has been signalled but is **not in the official docs**
> as of 2026-06-18 — re-check the
> [Codex changelog](https://developers.openai.com/codex/changelog) before relying
> on it.

---

## Tier C — headless run + external scheduler

These have a clean non-interactive run mode but **no built-in scheduler**, so an
external cron drives them. Pick the scheduler:

- **System cron / launchd / Task Scheduler** — simplest; runs as you, reuses
  your logged-in `gh`/provider creds, but the machine must be awake.
- **GitHub Actions `schedule:` cron** — always-on, but every credential must be
  a repo/org **secret** (provider key + a `GH_TOKEN`/PAT with
  `contents:write`+`pull-requests:write`).

The headless command per provider (pass the trigger prompt):

| Provider | Headless command | Unattended auth |
| --- | --- | --- |
| `codex` | `codex exec --sandbox danger-full-access "<PROMPT>"` | `CODEX_API_KEY` / `OPENAI_API_KEY` |
| `opencode` | `opencode run "<PROMPT>"` (config `permission: "allow"`, or `--dangerously-skip-permissions`) | provider key env (e.g. `ANTHROPIC_API_KEY`) |
| `continue` | `cn -p --auto "<PROMPT>"` | `CONTINUE_API_KEY` |
| `gemini` | `gemini -p "<PROMPT>" --approval-mode=yolo` | `GEMINI_API_KEY`, or Vertex `GOOGLE_APPLICATION_CREDENTIALS` + `GOOGLE_GENAI_USE_VERTEXAI=true` |

All four open PRs by running `git push` + `gh pr create` from the run (the
trigger prompt's ops:work `--pr` mode does this) — so `gh` must be installed and
authenticated in the runner.

**GitHub Actions example** (Gemini shown — the official
[`run-gemini-cli`](https://github.com/google-github-actions/run-gemini-cli)
Action; the same `schedule:` + headless-command shape works for `opencode` /
`continue` / `codex` by swapping the run step):

```yaml
name: shipeasy-feedback-trigger
on:
  schedule:
    - cron: "0 9 * * 1-5" # weekdays 09:00 UTC
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
jobs:
  trigger:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: google-github-actions/run-gemini-cli@v0
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          SHIPEASY_CLI_TOKEN: ${{ secrets.SHIPEASY_OPS_KEY }}
          SHIPEASY_PROJECT_ID: ${{ secrets.SHIPEASY_PROJECT_ID }}
        with:
          prompt: "<TRIGGER PROMPT>"
          settings: '{ "approval-mode": "yolo" }'
```

> This is the one place GitHub Actions is the right tool. The `claude` provider
> deliberately avoids Actions because it has a better native scheduler; Tier-C
> providers have no native scheduler, so Actions (or local cron) is the
> mechanism.

---

## Auth & safety (every provider)

- **Mint a restricted `ops` key — never embed an admin/login token.** It reads
  the queue, flips status, links its PR, and creates resources only; it can't
  edit/delete existing resources or mint keys, and auto-extends its 7-day expiry
  on each run. A leaked trigger prompt can't compromise the project.
- **Auto-approve flags remove the human gate.** `--sandbox danger-full-access`,
  `--approval-mode=yolo`, `--allow-all-tools`, `--dangerously-skip-permissions`,
  `cline --auto-approve true` — every Tier-B/C run uses one. Run only in an
  isolated env; never alias these.
- **Cost.** Unattended loops spend tokens/credits on a cadence (Cursor Max Mode,
  Copilot premium requests/AI credits, Gemini daily caps, model API spend). Set
  a conservative cron (weekly/daily) first and watch the first few runs.
- **PRs land for review — nothing auto-merges.** Every provider opens one PR per
  item; a human merges.

## Shipeasy connector registration — what we can fire vs. platform-scheduled

A Shipeasy **connector** (Feedback → Connectors, "Fire now" + event auto-fire)
means **Shipeasy's own cron fires the trigger** from its backend. That backend
is a Cloudflare Worker, so it can only fire a provider that exposes:

1. a **clean HTTP "start a run" endpoint** (a plain `fetch()` — the Worker can't
   spawn a CLI binary or run a scheduler), **and**
2. a **storable static token** that authorizes that call.

By that bar, providers split in two:

**Shipeasy-fireable (can be a connector):**

- **`claude`** — ✅ today. `POST …/v1/claude_code/routines/<id>/fire` with a
  per-routine bearer token. This is why claude is the only registered connector.
- **`cursor`** — ✅ viable (not yet wired). `POST https://api.cursor.com/v1/agents`
  with `Authorization: Bearer $CURSOR_API_KEY` starts a run from nothing and
  `autoCreatePR` opens the PR. A static key + a pure-HTTP start endpoint — it
  meets both criteria, so it's the natural **second** connector.

**Platform-scheduled only (NOT Shipeasy-fireable):**

- **`codex`** — ❌ no fire endpoint. Codex Cloud is triggered by the web UI, the
  IDE, the `codex` CLI, or an **`@codex` GitHub mention** — none usable from our
  Worker: a cold scheduled run has no issue/PR thread to comment on, and even
  creating one wouldn't fire it (the mention must come from the *Codex-connected
  account*, not a Shipeasy token; agent-mention triggers are gated to authorized
  actors). Codex's always-on path is its **own** scheduler — a GitHub Actions
  `schedule:` running `codex exec`, or local Automations. Do not try to fire it
  from Shipeasy.
- **`copilot`** — ❌ same shape as codex: the cloud agent is mention/assignment-
  triggered and rejects the default Actions token (needs a user PAT). Scheduled
  via Copilot automations or a scheduled Actions job, not by Shipeasy.
- **`windsurf` / `cline` / `openclaw` / `opencode` / `continue` / `gemini`** —
  ❌ scheduled by their own surface (Devin Scheduled Sessions, `cline schedule`,
  `openclaw cron`, system cron, or a GitHub Actions `schedule:` job). Pause /
  run / inspect them there.

**Rule of thumb:** if a provider can't be started from nothing by one
authenticated HTTP call, Shipeasy can't fire it — it must be scheduled on the
provider's own platform. Only `claude` (live) and `cursor` (candidate) clear
that bar.

## What's confirmed vs. moving

This surface changes monthly. Verified against vendor docs as of 2026-06-17;
flag spellings and auth requirements are version-sensitive — re-check the linked
docs before scripting. Notably unconfirmed: a fully-cloud (machine-off) Codex
Automations GA; whether Copilot's built-in Actions token (vs. a PAT) works for
the CLI specifically; OpenClaw's exact one-shot run verb and env-var names.
