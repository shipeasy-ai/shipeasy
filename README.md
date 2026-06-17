# Shipeasy — Claude Code + Codex marketplace

This directory is the source-of-truth for the Shipeasy plugin marketplace.
**One plugin tree, two host manifests** — the same `shipeasy/skills/` and
`shipeasy/.mcp.json` are consumed by both Claude Code and Codex; nothing is
duplicated.

Claude Code consumers install via:

```bash
claude plugin marketplace add shipeasy-ai/shipeasy
claude plugin install shipeasy@shipeasy
```

Codex consumers install via (inside the Codex TUI — `/plugins` opens the
browser, or add the source directly):

```
/plugin marketplace add shipeasy-ai/shipeasy
/plugin install shipeasy@shipeasy
```

One plugin, one MCP registration, all features included. Per-feature
opt-in is controlled by enabling/disabling modules on the project
(`shipeasy modules enable <name>`), not by installing additional plugins.

**What ports to Codex:** the seven area skills (auto-triggered by phrasing,
or invoked explicitly with `@shipeasy`) and the `shipeasy` MCP server.
Codex has no slash-command primitive in plugins, so the `/shipeasy:<area>:<verb>`
commands are Claude-Code-only — Codex users reach the same flows through the
skills and `@shipeasy` instead. Skills and the MCP file are referenced, not
copied: `shipeasy/.codex-plugin/plugin.json` points its `skills` and
`mcpServers` fields at the exact same files the Claude Code plugin uses.

## Layout

```
marketplace/
├── .claude-plugin/marketplace.json     # Claude Code: lists the shipeasy plugin
├── .agents/plugins/marketplace.json    # Codex: lists the shipeasy plugin (source ./shipeasy)
├── README.md                            # this file
└── shipeasy/                            # the only plugin
    ├── .claude-plugin/plugin.json      # Claude Code manifest (skills + commands + mcp)
    ├── .codex-plugin/plugin.json       # Codex manifest → SAME ./skills/ + ./.mcp.json
    ├── .mcp.json                        # MCP server registration (mcpServers wrapper; both hosts)
    ├── commands/                        # nested slash commands — Claude Code only
    │   ├── setup.md                     #   /shipeasy:setup
    │   ├── flags/{install,create,list,update}.md      # install folds the whole platform
    │   ├── experiments/{create,list,start,status,update,stop,archive}.md
    │   ├── metrics/{create,list,show,grammar}.md
    │   ├── configs/{create,list,update}.md
    │   ├── ks/{create,list,toggle_switch}.md
    │   ├── i18n/{install,extract,migrate,validate,update,profiles,translate}.md
    │   └── ops/{install,list,report,work,create_trigger}.md
    └── skills/                          # seven area skills (shared by both hosts)
        ├── setup/SKILL.md
        ├── experiments/SKILL.md
        ├── metrics/SKILL.md
        ├── flags/SKILL.md
        ├── i18n/SKILL.md
        ├── see/SKILL.md
        └── bugs/SKILL.md
```

Subdirectory commands surface as `/shipeasy:<dir>:<file>`, so for
example `commands/metrics/create.md` becomes `/shipeasy:metrics:create`.
Command namespaces are `flags`, `configs`, `ks`, `experiments`,
`metrics`, `ops`, `i18n`.

Two cross-cutting rules shape the command set:

- **Three install sections only.** `/shipeasy:flags:install` (gates +
  configs + kill switches + experiments + events), `/shipeasy:ops:install`
  (feedback + production errors + alerts), `/shipeasy:i18n:install`
  (translations). The per-feature `configs:install`, `ks:install`,
  `experiments:install`, `metrics:install`, and `bugs:install` are gone as
  real commands.
- **No delete commands.** Deletions happen in the dashboard UI. The plugin
  ships no functional `:delete` verb for any resource, and the work loops
  never delete a record.
- **Deprecated names still resolve.** Every removed/renamed command
  (`*:install`, `*:delete`, `ks:update`, `bugs:{install,list,report,fix}`,
  `feats:implement`) is kept as a one-line **redirect stub** — invoking it
  tells you to update the CLI/plugin and points at the replacement
  (e.g. `bugs:fix` → `ops:work`, `ks:update` → `ks:toggle_switch`,
  any `*:delete` → the dashboard). This is the "update-first" recovery path:
  when a command behaves oddly, `npm i -g @shipeasy/cli@latest` +
  `/plugin marketplace update shipeasy` → `/plugin install shipeasy@shipeasy`
  before deeper debugging.

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

The `ops` namespace also owns the operational inbox — `/shipeasy:ops:list`
(bugs / features / errors / alerts, `--type` filter), `/shipeasy:ops:report`
(file a bug or feature), and `/shipeasy:ops:work` (one loop that burns down
bugs + feature requests + production errors + alerts, one atomic diff each).
And `/shipeasy:ops:create_trigger` (`--provider claude`, the only provider
today) — a scheduled Claude Code routine (via `/schedule`, runs in Anthropic's
cloud, no GitHub Actions) that pulls active bugs + feature requests and fixes
them, registered as a Shipeasy connector so it shows in the Feedback tab.

## Headline workflows

The plugin is designed around three Claude-Code-driven end-to-end
workflows. All three assume `/shipeasy:setup` has already run and the
relevant feature module is enabled.

### 1. `/shipeasy:ops:work` — burn down the whole operational inbox, one-by-one

The unified work loop (it replaces the old `bugs:fix` and
`feats:implement`). Picks up every actionable item across **four sources** —
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
  `shipeasy feedback bugs attachments` (1.4.0). Older CLIs lack those
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

There's no separate `feats:implement` command anymore — feature requests
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
   - `exp_create_experiment` (MCP) with default `control 50 /
     treatment 50` groups and the picked metric as `success_metric`;
   - edits the variation point to branch on `experiments.assign(...)`.
4. **Verifies** with `shipeasy metrics list` + `shipeasy experiments
   status <name>` (expected: `draft`) + typecheck/build of touched
   files.
5. **Stops at the draft state.** You decide when to call
   `/shipeasy:experiments:start <name>`.

Prereqs:

- `experiments` + `events` modules enabled (`/shipeasy:flags:install`
  turns on both, along with gates + configs).

## Full command reference

Every slash command shipped by the plugin. All are under the `/shipeasy:`
namespace.

| Command | Argument(s) | What it does |
| --- | --- | --- |
| `/shipeasy:setup` | `[--domain <prod-domain>]` | Run base onboarding: detect subprojects, install `@shipeasy/sdk`, `shipeasy login`, create server+client keys, wire the SDK into the root layout. Stops at "ready to commit"; does **not** `git commit`. |
| **Installs (3 sections)** | | |
| `/shipeasy:flags:install` | — | Enable the whole flags platform in one pass — `gates` + `configs` + `events` + `experiments` (kill switches need no module). Smoke-test every read path. |
| `/shipeasy:ops:install` | — | Enable the `feedback` module + production error collection + alerts; verify the devtools overlay (`?se=1`); drop the project pointer skill. |
| `/shipeasy:i18n:install` | — | Enable the `translations` module, create the `en:prod` profile, inject the loader script if `getBootstrapHtml()` isn't rendered, smoke-test a key push+publish. |
| **Experiments** | | |
| `/shipeasy:experiments:create` | `<name>` | Full design flow: analyse the project for variation points + success metric candidates, ask via `AskUserQuestion`, instrument any new event, create the metric, draft the experiment, edit the variant branch. Stops in `draft` state. |
| `/shipeasy:experiments:list` | `[--status draft\|running\|stopped\|archived] [--universe <n>] [--name-contains <s>]` | Filtered tabular list. Pulls `shipeasy experiments list --json`, applies filters client-side. |
| `/shipeasy:experiments:start` | `<name>` | Move a draft experiment to running — begins assigning traffic. Immutable after this point. |
| `/shipeasy:experiments:status` | `<name>` | Enrolment per group, current p-value, significance state, recommendation (`keep_running` / `ship_treatment` / `ship_control` / `inconclusive`). |
| `/shipeasy:experiments:update` | `<name> [--allocation <pct>] [--groups <json>] [--params <json>] [--targeting-gate <name>] [--significance <p>] [--min-runtime-days <n>] [--min-sample-size <n>]` | Patch a draft (or running) experiment. On `running` only stats thresholds + targeting-gate are editable — the API refuses changes to `allocation`/`groups`/`params`/`universe`/`salt` (all assignment-hash inputs). |
| `/shipeasy:experiments:stop` | `<name> [--winner treatment\|control\|null]` | Freeze assignment and record the winner. Refuses to relaunch under the same name (assignment hash changes — use `<old>_v2`). |
| `/shipeasy:experiments:archive` | `<name>` | Hide a stopped experiment from default views; preserves results + assignment history. Refuses on draft/running. (Permanent deletion is UI-only.) |
| **Metrics** | | |
| `/shipeasy:metrics:create` | `<name> --event <event> --query '<dsl>'` | Create a metric. Same analyze-and-suggest path as the `metrics` skill — see `/shipeasy:metrics:grammar` for DSL. |
| `/shipeasy:metrics:list` | `[--folder <f>] [--event <name>] [--agg <count\|sum\|avg\|...>] [--name-contains <s>]` | Tabular list of metrics; unfiltered call (`shipeasy metrics list`) skips the JSON post-filter step. |
| `/shipeasy:metrics:show` | `<id>` | One metric, full detail. |
| `/shipeasy:metrics:grammar` | — | Print the metric DSL grammar (aggregations, match ops, examples). |
| **Flags / configs / kill switches** | | |
| `/shipeasy:flags:create` | `<gate-name> [percent]` | Create a boolean feature gate. Defaults: `rollout: 0`, no targeting. SDK-side safe value via `gates.check(name, { default: false })`. |
| `/shipeasy:flags:list` | `[--folder <f>] [--enabled true\|false] [--min-rollout <pct>] [--name-contains <s>]` | Filtered tabular list of gates. |
| `/shipeasy:flags:update` | `<gate-name> [--rollout <pct>] [--rules <json>] [--enable\|--disable]` | Patch rollout, rules, or enabled state. Prefer `shipeasy flags rollout`/`enable`/`disable` for single-field tweaks. |
| `/shipeasy:configs:create` | `<config-name> [json-default]` | Create a dynamic config (typed JSON value). |
| `/shipeasy:configs:list` | `[--folder <f>] [--name-contains <s>]` | Filtered tabular list of configs. |
| `/shipeasy:configs:update` | `<config-name> <json-value>` | Flat update of the config value (all envs). For per-env staging use the `shipeasy configs draft` / `publish` CLI flow. |
| `/shipeasy:ks:create` | `<folder.name>` | Create a killswitch admin resource (boolean `value` + optional named `switches` overrides). Not SDK-readable; for runtime gating, use a gate. |
| `/shipeasy:ks:list` | `[--folder <f>] [--value on\|off] [--name-contains <s>]` | Filtered tabular list. Filter applies to the prod-env value by default. |
| `/shipeasy:ks:toggle_switch` | `<folder.name> <switch-key> [on\|off] [--env <env>]` | Set or unset one **named override** on a kill switch (the dashboard "switches" feature) — a custom-named key carrying its own boolean, typically the opposite of the flat default. Per key, per env. Replaces the old `ks:update`. |
| **i18n** | | |
| `/shipeasy:i18n:extract` | `[target-dir]` | Run the codemod to wrap hardcoded user-visible strings in `i18n.t(...)`, push the generated keys, publish the `default` chunk. Idempotent. |
| `/shipeasy:i18n:migrate` | `<react-i18next\|react-intl\|lingui\|next-intl\|raw-i18next>` | Codemod call sites from another i18n library into `i18n.t(...)`, push existing translations, remove the old library. |
| `/shipeasy:i18n:validate` | `[paths...] [--profile <name>]` | CI/pre-commit drift gate — confirm every `i18n.t("key")` reference in code exists server-side. Non-zero exit on missing keys. |
| `/shipeasy:i18n:update` | `<key> <new-value> [--profile <name>] [--description <text>]` | Change one existing key's value, then publish. The only overwrite path — `extract`/push are insert-only. |
| `/shipeasy:i18n:profiles` | `[list] \| [create <name> [--locales <csv>] [--from <source>]]` | List or create locale profiles (`en:prod`, `fr:prod`, …). Deletion is UI-only. |
| `/shipeasy:i18n:translate` | `<target-profile> [--from <source>] [--glossary <t=v,...>]` | Stand up a new locale: seed the target profile from the source, machine-translate the draft (Anthropic, key by key), publish. Anthropic key read locally, never sent to Shipeasy. |
| **Ops (feedback + errors + alerts)** | | |
| `/shipeasy:ops:list` | `[--type bug\|feature\|error\|alert] [--status <s>] [--priority high\|critical\|medium\|low] [--name-contains <s>]` | Unified read view over the operational inbox. `--type` picks the source (default `bug`); errors and alerts are read-only. |
| `/shipeasy:ops:report` | `[--type bug\|feature] "<title>"` | File a single bug report or feature request against the bound project. |
| `/shipeasy:ops:work` | `[--type bug\|feature\|error\|alert\|all] [--status <s>] [--priority high\|critical] [--limit <N>] [--pr] [--dry-run]` | The unified work loop (replaces `bugs:fix` + `feats:implement`). Loops over bugs + feature requests + production errors + alerts, one atomic diff each: bugs fix-first, features design-first, errors/alerts diagnose-first. `--pr` commits each item, opens one PR, links it to every fixed bug, and adds `Closes #<issue>` for any item with a connected GitHub issue (the mode the trigger runs). `--dry-run` prints the combined queue. Requires CLI ≥ 1.8.0. |
| `/shipeasy:ops:create_trigger` | `[--provider claude] [--frequency daily\|weekdays\|weekly\|6h] [--dry-run]` | Provision a recurring feedback trigger that runs `/shipeasy:ops:work --pr` on a schedule, registered as a Shipeasy connector. Provider-pluggable; `claude` (default, the only provider today) backs it with a scheduled Claude Code routine (via `/schedule`). No GitHub Actions. |

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
| `bugs` | "bug report", "feature request", "feedback", "user-reported issue", "report a bug", "fix open bugs", "burn down the bug queue". |

### Examples of fully command-less use

| If you type… | …Claude Code activates | …and does |
| --- | --- | --- |
| *"Create a metric that measures how often users complete checkout"* | `metrics` | Greps for `events.track(...)` call sites + uninstrumented action points (form submits, primary CTAs, mirrors of `posthog.capture`/`segment.track`/etc.), proposes 2–4 `{ event, aggregation, why }` candidates via `AskUserQuestion`, instruments the chosen event if new, runs `shipeasy metrics create …`. |
| *"Set up Shipeasy in this repo"* | `setup` | Detects subprojects, runs `shipeasy login` via Bash, mints server+client keys, wires `shipeasy({…})` + `getBootstrapHtml()` into the root layout, persists keys per-subproject to the right secret store. |
| *"Ship a feature gate for the new pricing page at 5%"* | `flags` | Calls `exp_create_gate` with `rollout: 5`, shows the `gates.check(...)` call site you need to add. |
| *"Kill switch for the new checkout if it breaks"* | `flags` | Creates a `kill_checkout` gate defaulting **on** that the old code path gates on. |
| *"Wrap the homepage hero copy so we can translate it"* | `i18n` | Runs the `i18n.t(...)` wrap workflow, creates keys, pushes + publishes the chunk. |
| *"Migrate this repo from react-i18next to Shipeasy"* | `i18n` | Runs `shipeasy codemod i18n --migrate react-i18next`, pushes existing translations, removes the old library. |
| *"I got a customer bug report about the checkout button"* | `bugs` | Files a single bug via `shipeasy feedback bugs create …`. |
| *"Resolve every open bug we have"* | `bugs` | Recommends `/shipeasy:ops:work` (the looping orchestrator over bugs + features + errors + alerts) — the skill alone won't drive the multi-item loop. |
| *"Stop the checkout-v2 experiment and ship treatment"* | `experiments` | `exp_stop_experiment { name, winner: "treatment" }`. |
| *"How significant is the checkout experiment so far?"* | `experiments` | `exp_experiment_status { name }`, surfaces enrolment per group + p-value + recommendation. |

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
notes below cover only the cross-cutting structure and the surfaces that
changed in 3.0.0.

### The three install sections

Installs no longer exist per feature. There are exactly three, and each is
its own `commands/<area>/install.md`:

- **`/shipeasy:flags:install`** — enables `gates`, `configs`, `events`, and
  `experiments` in one pass and smoke-tests every read path. Kill switches
  ride the same KV blob and need no module. This single command replaces the
  old `configs:install`, `ks:install`, `experiments:install`, and
  `metrics:install`.
- **`/shipeasy:ops:install`** — enables `feedback`, turns on production-error
  collection (client `autoCollect` errors group) and alerts, verifies the
  devtools overlay (`?se=1`), and drops the `.claude/skills/shipeasy-bugs`
  project pointer. Replaces the old `bugs:install`.
- **`/shipeasy:i18n:install`** — enables `translations`, creates the `en:prod`
  profile, injects the loader script when `getBootstrapHtml()` isn't rendered,
  and round-trips a smoke key.

### The ops inbox

`ops` owns every operational read/triage surface:

- **`/shipeasy:ops:list [--type bug|feature|error|alert]`** — one read view
  over four sources. `bug`/`feature` come from `shipeasy feedback …`,
  `error` from `shipeasy ops.errors`, `alert` from `shipeasy alerts`. Errors
  and alerts are platform-produced and read-only.
- **`/shipeasy:ops:report [--type bug|feature] "<title>"`** — file a single
  bug or feature request. Errors/alerts can't be filed by hand.
- **`/shipeasy:ops:work [--type bug|feature|error|alert|all]`** — the unified
  work loop. It replaces `bugs:fix` and `feats:implement`, and adds errors +
  alerts as two more sources. One atomic diff per item; bugs fix-first,
  features design-first (with `AskUserQuestion`), errors/alerts
  diagnose-first. Read-only sources (errors/alerts) get a code fix, no status
  write. Never `git commit`s; never deletes; stops on the first 401/403.
  Requires CLI ≥ 1.8.0 (`shipeasy alerts` + `feedback bugs attachments`).
- **`/shipeasy:ops:create_trigger`** (`--provider claude`, the only provider
  today) — a scheduled Claude Code routine (via `/schedule`) that runs the
  bug+feature loop unattended, registered as a Shipeasy connector. No GitHub
  Actions.

### Kill switches: `toggle_switch` instead of `update`

A kill switch delivers `{ value: <bool>, switches?: { <key>: <bool> } }`.
The flat `value` is the default; `switches` is the dashboard "switches"
feature — a map of **named overrides** where the key is a custom string you
name yourself and the value is its own boolean (typically the *opposite* of
`value`, to carve out one exception). The override value is a boolean, not
free text — the *key* is the custom string. (Typed/string values are a
dynamic-config feature, not a kill-switch one.)

`/shipeasy:ks:toggle_switch <folder.name> <switch-key> [on|off] [--env <env>]`
sets or unsets one named override on one env — `shipeasy ks set` / `ks unset`
under the hood (MCP `exp_set_killswitch_switch` / `exp_unset_killswitch_switch`).
It replaces the old wholesale `ks:update`; definition-level edits (rename,
description, flat-default flip) happen in the dashboard.

### No delete commands

Deletions are UI-only across every resource — there is no `:delete` verb in
the plugin, and the `ops:work` loop never deletes a record (terminal states
are `resolved` / `ready_for_qa` / `shipped`, or a code fix for errors/alerts).
To remove a gate, config, kill switch, experiment, metric, or feedback
record, do it in the dashboard.

## Migration from the old multi-plugin layout

If a user previously installed any of:

```
base@shipeasy
experiments-metrics@shipeasy
configs-gates@shipeasy
polylang@shipeasy
bugs@shipeasy
```

they should uninstall all five and install `shipeasy@shipeasy` instead.
The new plugin owns the same MCP server, the same skills (renamed:
`setup`, `experiments`, `metrics`, `flags`, `i18n`, `bugs`), and the same
underlying CLI flows. Only the slash command names changed —
`/shipeasy-setup` → `/shipeasy:setup`, `/shipeasy-flag` →
`/shipeasy:flags:create`, etc.

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
