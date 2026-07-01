# Installing the Shipeasy feedback trigger on any platform

A **trigger** is an *unattended, scheduled* agent run: on a cron cadence it runs
**the `shipeasy-ops-work` loop in `--pr` mode** against your project — burning down the feedback
queue (bugs, feature requests, auto-filed error/alert tickets) one item at a
time, committing each fix on its own branch, and opening **one PR per item** for
review. No human in the loop.

The `shipeasy-ops-trigger` skill (`--provider <platform>`) provisions it. The
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
`npx -y skills add https://github.com/shipeasy-ai/shipeasy -a <agent>`
for the rest. The run also needs `@shipeasy/mcp` reachable — most hosts already
have it from setup.

---

## Tier A — native cloud scheduler

### `claude` — Claude Code scheduled routine

The reference implementation. `/schedule` creates a routine that runs in
Anthropic's cloud on your cron, opens PRs through the GitHub proxy, and
registers as a Shipeasy **connector** (Feedback → Connectors, with "Fire now").
**Does not use GitHub Actions.** Full walkthrough:
the `shipeasy-ops-trigger` skill with `--provider claude` (see
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

### `codex` — confirmed flow: GitHub Actions cron → `codex cloud exec` → Codex Cloud

This is the **verified, recommended** Codex path (confirmed working 2026-06-24).
Codex has its own plugin system that **mirrors Claude's**, so the Shipeasy slash
commands install the same way. The scheduler is a **GitHub Actions `schedule:`
cron** whose one job runs **`codex cloud exec --env <ENV_ID>`** — that submits a
real **Codex Cloud** task (the always-on cloud path — machine can be off after
submission). The task runs **inside the named Codex Cloud environment**, so its
network access + Shipeasy creds are configured **once, on the environment page**;
the GitHub runner only carries the two secrets needed to *submit* the task.

**Do the work upfront — don't just hand the user a checklist.** `create_trigger
--provider codex` should: mint the `ops` key, **write the workflow file** with
the Write tool, **open the Codex Cloud environment page in the browser**
(`open`/`xdg-open`), then **pause** while the user sets network + creds there,
and on return **commit the workflow** and fire one verification task. The only
genuinely manual, no-API step is the environment page.

**1. Install the Shipeasy plugin in Codex (one-time, in your terminal).** The
Codex analog of `claude plugin marketplace add` / `claude plugin install`:

```bash
codex plugin marketplace add shipeasy-ai/shipeasy
codex plugin add shipeasy@shipeasy
```

In the Codex harness the command is addressed by handle:

```
@Shipeasy run the shipeasy-ops-trigger skill --provider codex --frequency 4h
```

**2. Open the Codex Cloud environment page and WAIT (the one manual step).** The
task executes in a **Codex Cloud environment**, which defaults to a restricted
network and carries no Shipeasy creds — so until this is set the task can't reach
`api.shipeasy.ai` or authenticate, and there is **no CLI/API** to configure it.
**Open the page for the user, then pause and ask them to return when done:**

  https://chatgpt.com/codex/cloud/settings/environments

On that page (the Codex analog of Claude's `shipeasy` cloud environment):

- **Network access** → **Custom**, allow `shipeasy.ai` and `api.shipeasy.ai`,
  keeping the default package-manager allowlist.
- **Environment variables / secrets** → set `SHIPEASY_CLI_TOKEN` (the restricted
  `ops` key — see Auth & safety below; never an admin/login token) and
  `SHIPEASY_PROJECT_ID`. These live here because the **task runs here**.
- Note the **environment id** (`codex cloud` lists it, or the dashboard) — it's
  the `--env` value the scheduler passes.

**3. Write + commit the GitHub Actions workflow.** The job submits the cloud task
on `<CRON>` via `codex cloud exec`. The runner only needs `CODEX_API_KEY` (to
authenticate the submit) and `CODEX_ENV_ID` (the env from step 2) as repo
secrets — the Shipeasy creds + network are already on the environment:

```yaml
# .github/workflows/shipeasy-trigger.yml
name: Shipeasy trigger (Codex)
on:
  schedule:
    - cron: "<CRON>"
  workflow_dispatch: {}
jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - run: npm install -g @openai/codex
      - name: Submit a Codex Cloud task
        env:
          CODEX_API_KEY: ${{ secrets.CODEX_API_KEY }}
        run: codex cloud exec --env ${{ secrets.CODEX_ENV_ID }} "Run the shipeasy-ops-work skill with --pr for this project and follow that workflow exactly."
```

**4. Verify (and the instant trigger).** Fire one task on demand — this is the
real "instant trigger", a one-liner that submits to Codex Cloud (machine off):

```bash
codex cloud exec --env <ENV_ID> "Run the shipeasy-ops-work skill with --pr for this project and follow that workflow exactly."
```

`workflow_dispatch` (`gh workflow run shipeasy-trigger.yml`) runs the same
submit from GitHub. **Note:** `codex cloud exec` is a **CLI**, not a public REST
endpoint — Shipeasy's Worker can't fire the task itself (a REST task-lifecycle
API is an open request, [openai/codex#24777](https://github.com/openai/codex/issues/24777)),
so unlike a Claude routine there is no Shipeasy connector / auto-fire-on-new-bug
for Codex. The schedule + manual `codex cloud exec` cover unattended + on-demand.

> **Fallbacks:** (a) **Codex Automations** (Codex app → Automations) take the
> same cron but run **locally — the machine must be powered on**; (b) running the
> work in the runner itself with `codex exec --sandbox danger-full-access
> "<PROMPT>"` (creds as Actions secrets, not the Cloud environments page) instead
> of dispatching to the cloud. Prefer `codex cloud exec` — machine-off and the
> env page is the single config surface.

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
| `codex` | `codex cloud exec --env <ENV_ID> "<PROMPT>"` (submit to Codex Cloud; or in-runner `codex exec --sandbox danger-full-access "<PROMPT>"`) | `CODEX_API_KEY` / `OPENAI_API_KEY` |
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
          gemini_api_key: ${{ secrets.GEMINI_API_KEY }}
          prompt: "<TRIGGER PROMPT>"
          # Do NOT put `settings: '{ "approval-mode": "yolo" }'` here — settings.json
          # only accepts general.defaultApprovalMode = default|auto_edit|plan, and
          # `yolo` there throws an enum error on startup. `yolo` is a CLI flag only.
          # Scope tools in `settings` if you want; gate-off goes on the CLI:
          settings: |
            { "tools": { "core": ["ShellTool(git)", "WriteFileTool", "ReplaceTool"] } }
```

> **Disabling the human gate (verified 2026-06-24).** Auto-approval (`yolo`) is a
> **CLI flag** — `gemini --approval-mode=yolo` (or `--yolo`) — and is **not** a
> `settings.json` key. If the pinned `run-gemini-cli` version exposes no yolo
> passthrough input, drive the CLI directly in a `run:` step instead:
> `npx https://github.com/google-gemini/gemini-cli --approval-mode=yolo --prompt "<TRIGGER PROMPT>"`.
> Auth is `gemini_api_key` (env `GEMINI_API_KEY`) or `use_vertex_ai: true` + WIF.
>
> **Prefer no Actions at all?** Use **Jules** — Google's async coding agent
> (Gemini-powered, distinct from the Gemini CLI). It is **Shipeasy-fireable** (see
> below): the dashboard's guided Gemini flow registers a Jules connector, so
> Shipeasy launches the session and there is no workflow to maintain.

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

**Shipeasy-fireable (wired as a connector — guided flow on the dashboard `/triggers` page):**

- **`claude`** — ✅ live. `POST …/v1/claude_code/routines/<id>/fire` with a
  per-routine bearer token. The only *routine* connector (preconfigured run);
  the three below are *cold-fire* (the whole job rides in the launch prompt).
- **`cursor`** — ✅ live. `POST https://api.cursor.com/v1/agents` with
  `Authorization: Bearer $CURSOR_API_KEY`, `repos[].url` + `autoCreatePR: true`
  starts a run from nothing and opens the PR via Cursor's GitHub App. The ops key
  rides the launch `envVars`, so it never appears in the prompt.
- **`copilot`** — ✅ live (with an auth caveat). `POST
  https://api.github.com/agents/repos/<owner>/<repo>/tasks` with
  `{ prompt, create_pull_request: true }` starts a cloud-agent task from nothing.
  **Auth: a user-to-server token only** — a fine-grained user PAT with the
  **"Agent tasks"** repo permission (read+write) for a Copilot-licensed account.
  The Actions `GITHUB_TOKEN` and GitHub App *installation* tokens are rejected.
  The agent reads `SHIPEASY_CLI_TOKEN` from the repo's own **Agents** secret
  store, so Shipeasy stores only the PAT.
- **`gemini` (Jules)** — ✅ live. `POST
  https://jules.googleapis.com/v1alpha/sessions` with header `X-Goog-Api-Key`,
  `sourceContext.source = sources/github/<owner>/<repo>` and
  `automationMode: "AUTO_CREATE_PR"` starts a Jules session that opens a PR.
  Jules exposes no env channel, so the restricted ops key is embedded in the
  session prompt (safe — it's the limited `ops` key). The Gemini-CLI-in-Actions
  path above remains a fallback for teams that prefer GitHub Actions.

**Platform-scheduled only (NOT Shipeasy-fireable):**

- **`codex`** — ❌ no fire endpoint **for our Worker**. A real cloud task IS
  scriptable — `codex cloud exec --env <ENV_ID> "<PROMPT>"` submits one (machine
  off) — but only from the `codex` CLI authed as the Codex-connected account;
  there is **no public REST task-creation API** Shipeasy could call (open request,
  [openai/codex#24777](https://github.com/openai/codex/issues/24777)). So the
  always-on path is Codex's **own** scheduler — a GitHub Actions `schedule:`
  running `codex cloud exec`, or local Automations — and the instant trigger is
  that same one-liner (or `gh workflow run`). Do not try to fire it from Shipeasy.
- **`windsurf` / `cline` / `openclaw` / `opencode` / `continue`** — ❌ scheduled
  by their own surface (Devin Scheduled Sessions, `cline schedule`, `openclaw
  cron`, system cron, or a GitHub Actions `schedule:` job). Pause / run / inspect
  them there. (The Gemini *CLI* in Actions is here too; **Jules** is the fireable
  Gemini path above.)

**Rule of thumb:** if a provider can be started from nothing by one authenticated
HTTP call, Shipeasy can fire it — `claude`, `cursor`, `copilot`, and `gemini`
(Jules) all clear that bar (verified 2026-06-24). Everything else is scheduled on
the provider's own platform.

> **Note — `copilot`/`gemini` schedule story.** As fireable connectors these
> auto-fire on new feedback + on demand ("Trigger now"). For a *fixed cadence*
> (e.g. nightly when no new feedback arrives), Shipeasy's own scheduled fire is
> event/manual; use the platform's native scheduler (Copilot automations, Jules
> scheduled tasks — both UI-only) or a GitHub Actions `schedule:` job for that.

## What's confirmed vs. moving

This surface changes monthly. Verified against vendor docs as of 2026-06-17;
flag spellings and auth requirements are version-sensitive — re-check the linked
docs before scripting. Notably unconfirmed: a fully-cloud (machine-off) Codex
Automations GA; whether Copilot's built-in Actions token (vs. a PAT) works for
the CLI specifically; OpenClaw's exact one-shot run verb and env-var names.
