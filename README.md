# Shipeasy — multi-agent marketplace

This directory is the source-of-truth for the Shipeasy plugin marketplace.
**One plugin tree, many hosts** — the same `shipeasy/skills/` directory and
the same `shipeasy` MCP server feed every coding agent below. Each host gets
a tiny manifest that *points at* the shared files; nothing is duplicated.

➡ **Full per-agent install reference: [`INSTALL.md`](./INSTALL.md)**
(also published at <https://docs.shipeasy.ai/get-started/agents>).
➡ **Unattended scheduled triggers, per platform: [`TRIGGER-INSTALL.md`](./TRIGGER-INSTALL.md)**
(also at <https://docs.shipeasy.ai/get-started/triggers>).

## Install at a glance

There are two install tiers. **Tier 1** hosts have a native plugin system, so
one command bundles skills + MCP (and, for Claude Code, the slash commands).
**Tier 2** hosts (70+ agents) take the shared skills via the
[`vercel-labs/skills`](https://github.com/vercel-labs/skills) CLI plus a small
MCP config snippet.

### Tier 1 — one-command plugin install

| Agent | Install |
| --- | --- |
| **Claude Code** | `claude plugin marketplace add shipeasy-ai/shipeasy` → `claude plugin install shipeasy@shipeasy` |
| **Codex** | `codex plugin marketplace add shipeasy-ai/shipeasy` → `codex plugin add shipeasy@shipeasy` (or, in the TUI, `/plugin marketplace add shipeasy-ai/shipeasy` → `/plugin add shipeasy@shipeasy`) |
| **GitHub Copilot CLI** | `copilot plugin marketplace add shipeasy-ai/shipeasy` → `copilot plugin install shipeasy@shipeasy` |

### Tier 2 — skills + MCP (OpenCode, Cursor, Windsurf, Cline, Gemini, Continue, …)

```bash
# 1. skills — installs the 8 area skills
npx skills add https://github.com/shipeasy-ai/shipeasy -a <agent>

# 2. MCP — add the shipeasy server to that agent's MCP config (see INSTALL.md for the exact file)
#    most agents use the standard mcpServers shape:
#    { "mcpServers": { "shipeasy": { "command": "npx", "args": ["-y", "@shipeasy/mcp@latest"] } } }
```

`<agent>` is e.g. `opencode`, `cursor`, `windsurf`, `cline`, `gemini-cli`,
`continue`, `github-copilot` — see [`INSTALL.md`](./INSTALL.md) for the full
list and each agent's MCP file path/format (OpenCode, Copilot, and Continue
need a `type` field; the rest use the bare `mcpServers` object).

One plugin, one MCP registration, all features included. Per-feature
opt-in is controlled by enabling/disabling modules on the project
(`shipeasy modules enable <name>`), not by installing additional plugins.

**What ports where.** The eight area skills and the `shipeasy` MCP server port
to *every* agent — and the skills always delegate CRUD to the `shipeasy` MCP
tools or the `shipeasy` CLI. The 11 surviving `/shipeasy:<area>:<workflow>`
**slash commands are Claude Code-only** — no other host has a plugin
slash-command primitive, so on Codex, Copilot, OpenCode, etc. you reach the same
flows by letting a skill auto-trigger on phrasing (or, on Codex/Copilot,
invoking `@shipeasy`). Skills and MCP are *referenced, never copied*: each host's
manifest points its `skills`/`mcpServers` fields at the same `shipeasy/skills/`
and an MCP file.

## Layout

```
marketplace/
├── .claude-plugin/marketplace.json     # Claude Code: lists the shipeasy plugin
├── .agents/plugins/marketplace.json    # Codex: lists the shipeasy plugin (source ./shipeasy)
├── .github/plugin/marketplace.json     # Copilot CLI: lists the shipeasy plugin (source ./shipeasy)
├── .github/workflows/install-*.yml      # CI: per-plugin install smoke tests (claude/codex/copilot)
├── scripts/validate-plugin.mjs          # CI: deterministic manifest/skills/MCP validator
├── INSTALL.md                           # full per-agent install reference
├── README.md                            # this file
└── shipeasy/                            # the only plugin
    ├── .claude-plugin/plugin.json      # Claude Code manifest (skills + commands + mcp)
    ├── .codex-plugin/plugin.json       # Codex manifest → SAME ./skills/ + ./.mcp.json
    ├── .plugin/plugin.json             # Copilot manifest → SAME ./skills/ + ./.mcp.copilot.json
    ├── .mcp.json                        # MCP registration (mcpServers wrapper; Claude + Codex)
    ├── .mcp.copilot.json               # MCP registration with type:"local" (Copilot requires it)
    ├── commands/                        # 11 multi-step workflow slash commands — Claude Code only
    │   ├── setup.md                     #   /shipeasy:setup
    │   ├── flags/install.md             #   /shipeasy:flags:install
    │   ├── experiments/create.md        #   /shipeasy:experiments:create
    │   ├── metrics/create.md            #   /shipeasy:metrics:create
    │   ├── i18n/{install,extract,migrate,translate}.md
    │   └── ops/{install,work,create_trigger}.md
    └── skills/                          # 8 area skills
        ├── setup/SKILL.md
        ├── experiments/SKILL.md
        ├── metrics/SKILL.md
        ├── flags/SKILL.md
        ├── i18n/SKILL.md
        ├── see/SKILL.md
        └── bugs/SKILL.md
```

## Continuous verification (CI)

GitHub Actions smoke-tests that **every platform in [`INSTALL.md`](./INSTALL.md)**
can install Shipeasy. Three per-plugin workflows —
`.github/workflows/install-{claude,codex,copilot}.yml` — cover the Tier-1 hosts,
and `install-skills-matrix.yml` covers the Tier-2 agents (Cursor, Windsurf,
Cline, Gemini, OpenCode, Continue, OpenClaw) by installing the full skill set via
the [`skills`](https://github.com/vercel-labs/skills) CLI and asserting it
lands. Each per-plugin job:

1. **Validates wiring deterministically** — `node scripts/validate-plugin.mjs <host>`
   parses that host's marketplace + plugin manifests, asserts the marketplace
   `source` resolves to `./shipeasy`, that all eight area skills are present with
   a valid `name`/`description`, and that the MCP file registers `shipeasy`
   (Copilot additionally requires `type: "local"`). No network, no auth — this is
   the gate that catches a bad manifest path or schema.
2. **Installs the host CLI** (`@anthropic-ai/claude-code`, `@openai/codex`,
   `@github/copilot`) and prints its version.
3. **Installs the full skill set** from the checkout via the
   [`skills`](https://github.com/vercel-labs/skills) CLI (`-a claude-code` /
   `codex` / `github-copilot`) and asserts the installed `SKILL.md` count
   matches the source tree (the 8 area skills).
4. **Attempts the native plugin install** as a non-blocking probe. This step is
   best-effort because headless native install isn't available everywhere yet:
   Claude Code has no headless `plugin install` ([claude-code#12840](https://github.com/anthropics/claude-code/issues/12840)),
   Copilot's needs a Copilot-subscribed account (CI's `GITHUB_TOKEN` isn't one),
   and Codex's plugin install is TUI-only. It lights up automatically once those
   land.

Run the validator locally with `node scripts/validate-plugin.mjs all`.

Subdirectory commands surface as `/shipeasy:<dir>:<file>`, so for
example `commands/metrics/create.md` becomes `/shipeasy:metrics:create`.
Slash commands cover the 11 multi-step **workflows** (the full list is in the
command reference below); namespaces are `flags`, `experiments`, `metrics`,
`ops`, `i18n`, plus the top-level `setup`.

Two cross-cutting rules shape the surface:

- **Slash commands are workflows; CRUD is MCP/CLI.** The 11 slash commands are
  multi-step orchestrations. Day-to-day create / list / update / archive of a
  gate, config, kill switch, experiment, metric, alert rule, ops item, or i18n
  key runs through the generated `shipeasy` MCP tools (e.g.
  `release_flags_create`, `release_configs_*`, `release_killswitch_*`,
  `release_experiments_*`, `metrics_*`, `events_*`, `ops_*`, `ops_alerts_*`,
  `i18n_*`) or the `shipeasy` CLI (`shipeasy release flags|configs|killswitch|
  experiments …`, `shipeasy metrics …`, `shipeasy ops …`, `shipeasy alert-rules
  …`, `shipeasy i18n …`).
- **Three install sections.** `/shipeasy:flags:install` (gates + configs + kill
  switches + experiments + events), `/shipeasy:ops:install` (feedback +
  production errors + alerts), `/shipeasy:i18n:install` (translations).
- **Deletes happen in the dashboard UI.** Resources are removed from the
  dashboard.

## After install

Plugin install registers slash commands + skills with Claude Code. It does
**not** run shell commands. To complete the setup:

1. Run `/shipeasy:setup`. This installs the SDK, authenticates, binds the
   repo to a project, mints keys, and wires the SDK into the root layout.
2. Run the install section(s) you want — there are exactly three:
   - `/shipeasy:flags:install` — gates + configs + kill switches +
     experiments + events (the whole "decide-at-runtime" platform, one pass)
   - `/shipeasy:ops:install` — feedback (bugs + feature requests) +
     production errors + alerts
   - `/shipeasy:i18n:install` — translations

Each install command toggles the corresponding per-project modules and
verifies the wiring.

The `ops` namespace also owns the operational inbox. Reading and filing items
runs through the MCP/CLI surface — `ops_list` (bugs / features / errors / alerts,
`--type` filter) or `shipeasy ops list`, and `ops_create` / `shipeasy ops report`
to file a bug or feature. The looping orchestrator stays a slash command:
`/shipeasy:ops:work` (one loop that burns down bugs + feature requests +
production errors + alerts, one atomic diff each).
And `/shipeasy:ops:create_trigger` — for `--provider claude` (the default) a
scheduled Claude Code routine (via `/schedule`, runs in Anthropic's cloud, no
GitHub Actions) that pulls active bugs + feature requests and fixes them,
registered as a Shipeasy connector so it shows in the Feedback tab. `--provider
codex` is also confirmed working (a GitHub Actions `schedule:` cron driving a
Codex Cloud task; see `TRIGGER-INSTALL.md`), though only `claude` registers a
Shipeasy connector today.

## Headline workflows

The plugin is designed around three Claude-Code-driven end-to-end
workflows. All three assume `/shipeasy:setup` has already run and the
relevant feature module is enabled.

### 1. `/shipeasy:ops:work` — burn down the whole operational inbox, one-by-one

The unified work loop. Picks up every actionable item across **four sources** —
bug reports, feature requests, tracked production errors, and active alerts
— and resolves each as its own atomic diff. `--type bug|feature|error|alert|all`
scopes it; the default `all` runs bugs → features → errors → alerts.

Behaviour, per source:

- **Bugs** — fix-first. Pulls full text + attachments (screenshots loaded
  into context via the image-aware Read tool; recordings surfaced as
  `file://` URLs), investigates, fixes, marks `resolved` / `ready_for_qa`.
- **Features** — design-first. Pauses with `AskUserQuestion` to agree the
  smallest viable shape before editing; implements as one atomic diff;
  surfaces the manual `→ shipped` flip (no CLI write).
- **Errors** — diagnose-first. Reads `shipeasy ops.errors get`, locates the
  throw site, fixes the root cause. Read-only lifecycle — the fix lands in
  code and the error ages out of the open view once deployed.
- **Alerts** — triage-first. Reads `shipeasy alerts get`, follows `source`
  (`metric_rule` / `experiment_srm` / `experiment_peek` / `guardrail` /
  `killswitch_armed`) to the underlying cause. Read-only + auto-resolving;
  killswitch-armed alerts are usually intentional, so it confirms first.

Each item becomes one atomic diff — the loop does **not** parallelise, so
blame stays clean. The command refuses to `git commit`; after the loop you
review `git diff --stat` and commit yourself.

Prereqs:

- `feedback` module enabled (`/shipeasy:ops:install`).
- CLI ≥ `1.8.0` — `shipeasy alerts` (1.8.0) and
  `shipeasy ops bug attachments` (1.4.0). Older CLIs lack those
  subcommands.

### 2. Create a metric from a vague request — no slash command needed

The `metrics` skill auto-triggers on phrases like *"create a metric
for checkout conversion"*, *"track how often users complete signup"*,
*"add a metric measuring page load time"*. You do **not** need a slash
command — the skill takes over and runs the analyze-and-suggest flow:

1. **Analyze the project** to find existing `events.track(...)` call
   sites (zero new instrumentation candidates) and uninstrumented
   action points (form submits, primary CTAs, API completion handlers,
   other-analytics calls like `posthog.capture` to mirror).
2. **Propose with `AskUserQuestion`** — 2–4 options, each labelled with
   the event name + one-line behaviour, the matching DSL query and
   aggregation, and whether new instrumentation is required.
3. **Instrument** the chosen event if it doesn't already exist (single
   `Edit` adding the import + `events.track(name, { ...labels })` call).
4. **Create the metric** via `shipeasy metrics create <name> --event
   <event> --query '<dsl>'`.
5. **Verify** with `shipeasy metrics list`.

If you prefer a slash command for the same flow, use
`/shipeasy:metrics:create` — it follows the same skill content.

Prereqs:

- `events` module enabled (`/shipeasy:flags:install`).

### 3. Feature requests fold into `/shipeasy:ops:work`

There's no separate feature-request command — feature requests
are one of the four sources `/shipeasy:ops:work` handles (run it with
`--type feature` to scope to just features). The feature path is
**design-first**: the loop pauses with `AskUserQuestion` to agree the
smallest viable shape (2–4 options with file:line scope) before editing,
implements one atomic diff, then surfaces the manual `→ shipped` flip
(the CLI has no `features update`, so the loop never auto-PATCHes status).
Default `--limit` for features is `10` (heavier than bug fixes).

Prereqs:

- `feedback` module enabled (`/shipeasy:ops:install`).
- Working tree clean unless the user explicitly opts in to mix the
  loop's diffs with WIP.

### 4. `/shipeasy:experiments:create <name>` — design + provision an A/B test

End-to-end experiment design. Given just an experiment name, the command:

1. **Locates the variation point** in the code — file:line of the
   component/handler that needs to branch on the variant. Asks
   `AskUserQuestion` if the surface is ambiguous.
2. **Proposes a success metric** by analysing the project the same way
   the metrics skill does (existing events, implicit conversion points,
   existing metrics). Presents 2–4 candidates as
   `{ event, aggregation, why }` via `AskUserQuestion`.
3. **Provisions in order**, halting on first failure:
   - instruments the event (if new) — single Edit at the conversion point;
   - `shipeasy metrics create <metric_name> --event <event> --query '<dsl>'`;
   - `release_experiments_create` (MCP) with default `control 50 /
     treatment 50` groups and the picked metric as `success_metric`;
   - edits the variation point to branch on `experiments.assign(...)`.
4. **Verifies** with `shipeasy metrics list` + `shipeasy release experiments
   status <name>` (expected: `draft`) + typecheck/build of touched
   files.
5. **Stops at the draft state.** You decide when to start it — via the
   `release_experiments_start` MCP tool or `shipeasy release experiments start
   <name>`.

Prereqs:

- `experiments` + `events` modules enabled (`/shipeasy:flags:install`
  turns on both, along with gates + configs).

## Full command reference

The plugin ships exactly **11 slash commands**, all multi-step workflows under
the `/shipeasy:` namespace. Everything else — all CRUD — is done via the
generated `shipeasy` MCP tools or the `shipeasy` CLI (see "Everything else: MCP
+ CLI" below).

| Command | Argument(s) | What it does |
| --- | --- | --- |
| `/shipeasy:setup` | `[--domain <prod-domain>]` | Run base onboarding: detect subprojects, install `@shipeasy/sdk`, `shipeasy login`, create server+client keys, wire the SDK into the root layout. Stops at "ready to commit"; does **not** `git commit`. |
| **Installs (3 sections)** | | |
| `/shipeasy:flags:install` | — | Enable the whole flags platform in one pass — `gates` + `configs` + `events` + `experiments` (kill switches need no module). Smoke-test every read path. |
| `/shipeasy:ops:install` | — | Enable the `feedback` module + production error collection + alerts; verify the devtools overlay (`?se=1`); drop the project pointer skill. |
| `/shipeasy:i18n:install` | — | Enable the `translations` module, create the `en:prod` profile, inject the loader script if `getBootstrapHtml()` isn't rendered, smoke-test a key push+publish. |
| **Experiments** | | |
| `/shipeasy:experiments:create` | `<name>` | Full design flow: analyse the project for variation points + success metric candidates, ask via `AskUserQuestion`, instrument any new event, create the metric, draft the experiment, edit the variant branch. Stops in `draft` state. |
| **Metrics** | | |
| `/shipeasy:metrics:create` | `<name> --event <event> --query '<dsl>'` | Create a metric end-to-end. Same analyze-and-suggest path as the `metrics` skill — see the `metrics_grammar` MCP tool / `shipeasy metrics grammar` for the DSL. |
| **i18n** | | |
| `/shipeasy:i18n:extract` | `[target-dir]` | Run the codemod to wrap hardcoded user-visible strings in `i18n.t(...)`, push the generated keys, publish the `default` chunk. Idempotent. |
| `/shipeasy:i18n:migrate` | `<react-i18next\|react-intl\|lingui\|next-intl\|raw-i18next>` | Codemod call sites from another i18n library into `i18n.t(...)`, push existing translations, remove the old library. |
| `/shipeasy:i18n:translate` | `<target-profile> [--from <source>] [--glossary <t=v,...>]` | Stand up a new locale: seed the target profile from the source, machine-translate the draft (Anthropic, key by key), publish. Anthropic key read locally, never sent to Shipeasy. |
| **Ops (feedback + errors + alerts)** | | |
| `/shipeasy:ops:work` | `[--type bug\|feature\|error\|alert\|all] [--status <s>] [--priority high\|critical] [--limit <N>] [--pr] [--dry-run]` | The unified work loop. Loops over bugs + feature requests + production errors + alerts, one atomic diff each: bugs fix-first, features design-first, errors/alerts diagnose-first. `--pr` commits each item, opens one PR, links it to every fixed bug, and adds `Closes #<issue>` for any item with a connected GitHub issue (the mode the trigger runs). `--dry-run` prints the combined queue. Requires CLI ≥ 1.8.0. |
| `/shipeasy:ops:create_trigger` | `[--provider claude\|codex\|…] [--frequency daily\|weekdays\|weekly\|6h] [--dry-run]` | Provision a recurring feedback trigger that runs `/shipeasy:ops:work --pr` on a schedule. Provider-pluggable; `claude` (default) backs it with a scheduled Claude Code routine (via `/schedule`, no GitHub Actions) and registers a Shipeasy connector. `codex` (confirmed) uses a GitHub Actions `schedule:` cron → Codex Cloud task; other providers per `TRIGGER-INSTALL.md`. |

### Everything else: MCP + CLI

All day-to-day CRUD — create / list / update / archive of gates, configs, kill
switches, experiments, metrics, alert rules, ops items, and i18n keys — runs
through the generated `shipeasy` MCP tools or the `shipeasy` CLI. A few
representative examples:

| Task | MCP tool | CLI |
| --- | --- | --- |
| Create a feature gate | `release_flags_create` | `shipeasy release flags create` |
| List gates | `release_flags_list` | `shipeasy release flags list` |
| Roll out / enable / disable a gate | `release_flags_rollout` / `_enable` / `_disable` | `shipeasy release flags rollout\|enable\|disable` |
| Create / update a dynamic config | `release_configs_create` / `release_configs_update` | `shipeasy release configs create\|update` |
| Toggle a kill-switch override | `release_killswitch_set` / `release_killswitch_unset` | `shipeasy release killswitch set\|unset` |
| List / start / status / stop an experiment | `release_experiments_list` / `_start` / `_status` / `_stop` | `shipeasy release experiments list\|start\|status\|stop` |
| List / show metrics, print the DSL | `metrics_list` / `metrics_show` / `metrics_grammar` | `shipeasy metrics list\|show\|grammar` |
| Create / list / update an alert rule | `ops_alerts_create` / `ops_alerts_list` / `ops_alerts_update` | `shipeasy alert-rules create\|list\|update` |
| List / file an ops item | `ops_list` / `ops_create` | `shipeasy ops list\|report` |
| Create / list / validate i18n keys | `i18n_create_key` / `i18n_validate_keys` / `i18n_profiles_list` | `shipeasy i18n …` |

**Deletes happen in the dashboard UI.** Archive a stopped experiment with
`release_experiments_archive`, then remove records in the dashboard.

## Skill auto-triggers (no slash command needed)

Skills activate from natural-language phrasing. The plugin ships six.
Every phrase below is taken from the live `description:` field of the
corresponding `SKILL.md` — these are the actual triggers Claude Code
matches against.

| Skill | Auto-triggers on phrasing like… |
| --- | --- |
| `setup` | "set up shipeasy", "install shipeasy", "onboard shipeasy", "first-time integration". |
| `experiments` | "A/B test", "experiment", "split test", "holdout", "metric significance". |
| `metrics` | "create metric", "track metric", "metric DSL", "event metric", "success metric definition", "what metrics do we have". |
| `flags` | "feature flag", "feature gate", "rollout", "kill switch", "dynamic config", "remote config". |
| `i18n` | "translate", "i18n", "add a key", "make this translatable", "user-facing copy changes". |
| `ops` | "bug report", "feature request", "feedback", "user-reported issue", "report a bug", "operational queue", "fix open bugs", "burn down the queue", "work the inbox", "set up a recurring fix trigger". |

### Examples of fully command-less use

| If you type… | …Claude Code activates | …and does |
| --- | --- | --- |
| *"Create a metric that measures how often users complete checkout"* | `metrics` | Greps for `events.track(...)` call sites + uninstrumented action points (form submits, primary CTAs, mirrors of `posthog.capture`/`segment.track`/etc.), proposes 2–4 `{ event, aggregation, why }` candidates via `AskUserQuestion`, instruments the chosen event if new, runs `shipeasy metrics create …`. |
| *"Set up Shipeasy in this repo"* | `setup` | Detects subprojects, runs `shipeasy login` via Bash, mints server+client keys, wires `shipeasy({…})` + `getBootstrapHtml()` into the root layout, persists keys per-subproject to the right secret store. |
| *"Ship a feature gate for the new pricing page at 5%"* | `flags` | Calls `release_flags_create` with `rollout: 5`, shows the `gates.check(...)` call site you need to add. |
| *"Kill switch for the new checkout if it breaks"* | `flags` | Creates a `kill_checkout` gate defaulting **on** that the old code path gates on. |
| *"Wrap the homepage hero copy so we can translate it"* | `i18n` | Runs the `i18n.t(...)` wrap workflow, creates keys, pushes + publishes the chunk. |
| *"Migrate this repo from react-i18next to Shipeasy"* | `i18n` | Runs `shipeasy codemod i18n --migrate react-i18next`, pushes existing translations, removes the old library. |
| *"I got a customer bug report about the checkout button"* | `ops` | Files a single bug via `shipeasy ops bug create …`. |
| *"Resolve every open bug we have"* | `ops` | Recommends `/shipeasy:ops:work` (the looping orchestrator over bugs + features + errors + alerts) that drives the multi-item loop. |
| *"Stop the checkout-v2 experiment and ship treatment"* | `experiments` | `release_experiments_stop { name, winner: "treatment" }`. |
| *"How significant is the checkout experiment so far?"* | `experiments` | `release_experiments_status { name }`, surfaces enrolment per group + p-value + recommendation. |

If you want the *work-the-whole-inbox* loop (bugs + feature requests +
production errors + alerts), the experiment-design loop, or the
i18n-bulk-extraction loop, prefer the slash commands —
`/shipeasy:ops:work`, `/shipeasy:experiments:create <name>`,
`/shipeasy:i18n:extract`. Each one is a multi-step orchestration the
underlying skill alone won't drive end-to-end.

## Detailed command reference

The per-command `commands/<area>/<verb>.md` files are the authoritative
behaviour spec — that file *is* the prompt Claude Code follows when the
slash command runs. Open the matching file for the full, current step list
rather than relying on a copy here. The table above is the quick index; the
notes below cover the cross-cutting structure.

### The three install sections

There are three install commands, each its own `commands/<area>/install.md`:

- **`/shipeasy:flags:install`** — enables `gates`, `configs`, `events`, and
  `experiments` in one pass and smoke-tests every read path. Kill switches
  ride the same KV blob and need no module.
- **`/shipeasy:ops:install`** — enables `feedback`, turns on production-error
  collection (client `autoCollect` errors group) and alerts, verifies the
  devtools overlay (`?se=1`), and drops the `.claude/skills/shipeasy-bugs`
  project pointer.
- **`/shipeasy:i18n:install`** — enables `translations`, creates the `en:prod`
  profile, injects the loader script when `getBootstrapHtml()` isn't rendered,
  and round-trips a smoke key.

### The ops inbox

`ops` owns every operational read/triage surface. Reading and filing run through
the MCP/CLI surface; the looping orchestrator stays a slash command:

- **`ops_list` MCP tool / `shipeasy ops list [--type bug|feature|error|alert]`**
  — one read view over four sources. `bug`/`feature` come from the feedback
  table, `error` from tracked production errors, `alert` from active alerts.
  Errors and alerts are platform-produced and read-only.
- **`ops_create` MCP tool / `shipeasy ops report [--type bug|feature]
  "<title>"`** — file a single bug or feature request. Errors/alerts can't be
  filed by hand.
- **`/shipeasy:ops:work [--type bug|feature|error|alert|all]`** — the unified
  work loop over bugs + feature requests + production errors + alerts (four
  sources). One atomic diff per item; bugs fix-first,
  features design-first (with `AskUserQuestion`), errors/alerts
  diagnose-first. Read-only sources (errors/alerts) get a code fix, no status
  write. Leaves committing to the user; stops on the first 401/403.
  Requires CLI ≥ 1.8.0 (`shipeasy alerts` + `feedback bugs attachments`).
- **`/shipeasy:ops:create_trigger`** (`--provider claude` default; `codex`
  confirmed) — `claude` is a scheduled Claude Code routine (via `/schedule`, no
  GitHub Actions) that runs the bug+feature loop unattended, registered as a
  Shipeasy connector; `codex` is a GitHub Actions `schedule:` cron driving a
  Codex Cloud task (`TRIGGER-INSTALL.md`). Only `claude` registers a connector.

### Kill switches: named-override set/unset

A kill switch delivers `{ value: <bool>, switches?: { <key>: <bool> } }`.
The flat `value` is the default; `switches` is the dashboard "switches"
feature — a map of **named overrides** where the key is a custom string you
name yourself and the value is its own boolean (typically the *opposite* of
`value`, to carve out one exception). The override value is a boolean, not
free text — the *key* is the custom string. (Typed/string values are a
dynamic-config feature, not a kill-switch one.)

Set or unset one named override on one env via the `release_killswitch_set` /
`release_killswitch_unset` MCP tools (or `shipeasy release killswitch set` /
`unset`). Definition-level edits (rename, description, flat-default flip) happen
in the dashboard.

### Deletes

Deletes happen in the dashboard. The `ops:work` loop's terminal states are
`resolved` / `ready_for_qa` / `shipped` (or a code fix for errors/alerts). To
remove a gate, config, kill switch, experiment, metric, or feedback record, do
it in the dashboard.

## Publishing to GitHub

This tree is intended to live at `shipeasy-ai/shipeasy` on GitHub (the
public marketplace repo). See [`../PUBLISH-MIGRATION.md`](../PUBLISH-MIGRATION.md)
for the runbook that creates the repo, subtree-splits this directory
into it, and configures the `claude plugin marketplace add` URL.

## Relationship to the in-monorepo install guides

The agent-facing runbooks under [`../install/`](../install/) (general,
experiments-metrics, configs-gates-killswitches, translations,
bugs-feature-requests) are the long-form documentation each skill
references. The skills in this directory deliberately mirror the steps
those runbooks describe — keep them in sync. The runbooks are the canonical
source if there's ever a conflict.

## Relationship to `packages/cli/plugin/`

`packages/cli/plugin/` is the **legacy** single-plugin layout that the CLI's
`shipeasy plugin install` command writes into `.claude/`. It remains for
non-Claude-Code assistants (Cursor, Windsurf) and for users who can't reach
the public marketplace. Treat both directories as fungible until the CLI
is updated to consume `marketplace/` directly — then `packages/cli/plugin/`
can be deleted.
