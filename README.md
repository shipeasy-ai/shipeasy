# Shipeasy — Claude Code marketplace

This directory is the source-of-truth for the Shipeasy plugin marketplace
that Claude Code consumers install via:

```bash
claude plugin marketplace add shipeasy-ai/shipeasy
claude plugin install shipeasy@shipeasy
```

One plugin, one MCP registration, all features included. Per-feature
opt-in is controlled by enabling/disabling modules on the project
(`shipeasy modules enable <name>`), not by installing additional plugins.

## Layout

```
marketplace/
├── .claude-plugin/marketplace.json     # lists the shipeasy plugin
├── README.md                            # this file
└── shipeasy/                            # the only plugin
    ├── .claude-plugin/plugin.json
    ├── .mcp.json                        # MCP server registration
    ├── commands/                        # nested slash commands
    │   ├── setup.md                     #   /shipeasy:setup
    │   ├── experiment/{create,start,status,stop}.md
    │   ├── experiments/install.md
    │   ├── metric/{create,list,show,delete,grammar}.md
    │   ├── metrics/install.md
    │   ├── flag/create.md
    │   ├── flags/install.md
    │   ├── i18n/{extract,migrate,install}.md
    │   ├── bug/report.md
    │   └── bugs/install.md
    └── skills/                          # six area skills
        ├── setup/SKILL.md
        ├── experiments/SKILL.md
        ├── metrics/SKILL.md
        ├── flags/SKILL.md
        ├── i18n/SKILL.md
        └── bugs/SKILL.md
```

Subdirectory commands surface as `/shipeasy:<dir>:<file>`, so for
example `commands/metric/create.md` becomes `/shipeasy:metric:create`.

## After install

Plugin install registers slash commands + skills with Claude Code. It does
**not** run shell commands. To complete the setup:

1. Run `/shipeasy:setup`. This installs the SDK, authenticates, binds the
   repo to a project, mints keys, and wires the SDK into the root layout.
2. Per feature you want, run the matching install slash command:
   - `/shipeasy:experiments:install`
   - `/shipeasy:metrics:install`
   - `/shipeasy:flags:install`
   - `/shipeasy:i18n:install`
   - `/shipeasy:bugs:install`

Each install command toggles the corresponding per-project module and
verifies the wiring.

## Headline workflows

The plugin is designed around three Claude-Code-driven end-to-end
workflows. All three assume `/shipeasy:setup` has already run and the
relevant feature module is enabled.

### 1. `/shipeasy:bugs:fix` — resolve every open bug, one-by-one

Picks up every bug filed via the devtools overlay (or the CLI),
loops over them, pulls full text + attachments (screenshots / video
recordings) into the model's context, investigates the relevant code,
fixes it, and marks the bug `resolved` (or `ready_for_qa` if the change
needs human verification).

Behaviour:

- Reads the queue with `shipeasy feedback bugs list --status open --json`.
- For each id, calls `shipeasy feedback bugs get <id>` and
  `shipeasy feedback bugs attachments <id> --json` to fetch the full
  detail + every attachment to a local tmpdir.
- Screenshots are loaded into context via Claude Code's image-aware
  Read tool. Recordings are surfaced as `file://` URLs (you decide
  whether screenshots alone are enough or whether to extract a frame).
- Each bug becomes one atomic diff — the loop does **not** parallelise,
  so blame stays clean.
- The command refuses to `git commit`. After the loop, you review
  `git diff --stat` and commit yourself.

Prereqs:

- `feedback` module enabled (`/shipeasy:bugs:install`).
- CLI version with `shipeasy feedback bugs attachments` (shipped with
  this plugin — older CLIs lack the subcommand).

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
`/shipeasy:metric:create` — it follows the same skill content.

Prereqs:

- `events` module enabled (`/shipeasy:metrics:install`).

### 3. `/shipeasy:experiment:create <name>` — design + provision an A/B test

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
   `/shipeasy:experiment:start <name>`.

Prereqs:

- `experiments` + `events` modules enabled (`/shipeasy:experiments:install`
  + `/shipeasy:metrics:install`).

## Full command reference

Every slash command shipped by the plugin. All are under the `/shipeasy:`
namespace.

| Command | Argument(s) | What it does |
| --- | --- | --- |
| `/shipeasy:setup` | `[--domain <prod-domain>]` | Run base onboarding: detect subprojects, install `@shipeasy/sdk`, `shipeasy login`, create server+client keys, wire the SDK into the root layout. Stops at "ready to commit"; does **not** `git commit`. |
| `/shipeasy:experiments:install` | — | Enable the `experiments` module on the bound project and smoke-test `experiments.assign`. |
| `/shipeasy:experiment:create` | `<name>` | Full design flow: analyse the project for variation points + success metric candidates, ask via `AskUserQuestion`, instrument any new event, create the metric, draft the experiment, edit the variant branch. Stops in `draft` state. |
| `/shipeasy:experiment:start` | `<name>` | Move a draft experiment to running — begins assigning traffic. Immutable after this point. |
| `/shipeasy:experiment:status` | `<name>` | Enrolment per group, current p-value, significance state, recommendation (`keep_running` / `ship_treatment` / `ship_control` / `inconclusive`). |
| `/shipeasy:experiment:stop` | `<name> [--winner treatment\|control\|null]` | Freeze assignment and record the winner. Refuses to relaunch under the same name (assignment hash changes — use `<old>_v2`). |
| `/shipeasy:metrics:install` | — | Enable the `events` module (+ `experiments` if you want metrics to gate A/B tests) and round-trip a smoke metric. |
| `/shipeasy:metric:create` | `<name> --event <event> --query '<dsl>'` | Create a metric. Same analyze-and-suggest path as the `metrics` skill — see `/shipeasy:metric:grammar` for DSL. |
| `/shipeasy:metric:list` | — | Tabular or JSON list of all metrics. |
| `/shipeasy:metric:show` | `<id>` | One metric, full detail. |
| `/shipeasy:metric:delete` | `<id>` | Soft-delete a metric. Rejected if currently referenced by a running experiment. |
| `/shipeasy:metric:grammar` | — | Print the metric DSL grammar (aggregations, match ops, examples). |
| `/shipeasy:flags:install` | — | Enable `gates` + `configs` modules and smoke-test the read path. (Kill switches reuse `gates`.) |
| `/shipeasy:flag:create` | `<gate-name> [percent]` | Create a feature gate. Defaults: `rollout_percent: 0`, `default: false`, no targeting. |
| `/shipeasy:i18n:install` | — | Enable the `translations` module, create the `en:prod` profile, inject the loader script if `getBootstrapHtml()` isn't rendered, smoke-test a key push+publish. |
| `/shipeasy:i18n:extract` | `[target-dir]` | Run the codemod to wrap hardcoded user-visible strings in `i18n.t(...)`, push the generated keys, publish the `default` chunk. Idempotent. |
| `/shipeasy:i18n:migrate` | `<react-i18next\|react-intl\|lingui\|next-intl\|raw-i18next>` | Codemod call sites from another i18n library into `i18n.t(...)`, push existing translations, remove the old library. |
| `/shipeasy:bugs:install` | — | Enable the `feedback` module, confirm the devtools overlay loads (`?se=1` URL), smoke-test the CLI mirror. |
| `/shipeasy:bug:report` | `<bug\|feature> "<title>"` | File a single bug or feature request against the bound project. |
| `/shipeasy:bugs:fix` | `[--status <s>] [--priority high\|critical] [--limit <N>] [--dry-run]` | Loop over the bug queue (sorted `critical > high > medium > low > null`, then `createdAt` asc): download attachments (screenshots → Read into context, recordings → surface for human review), investigate, fix, mark `resolved` / `ready_for_qa`. One atomic diff per bug. `--dry-run` prints the sorted queue and exits. Requires CLI ≥ 1.4.0. |

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
| *"Ship a feature gate for the new pricing page at 5%"* | `flags` | Calls `exp_create_gate` with `rollout_percent: 5`, shows the `gates.check(...)` call site you need to add. |
| *"Kill switch for the new checkout if it breaks"* | `flags` | Creates a `kill_checkout` gate defaulting **on** that the old code path gates on. |
| *"Wrap the homepage hero copy so we can translate it"* | `i18n` | Runs the `i18n.t(...)` wrap workflow, creates keys, pushes + publishes the chunk. |
| *"Migrate this repo from react-i18next to Shipeasy"* | `i18n` | Runs `shipeasy codemod i18n --migrate react-i18next`, pushes existing translations, removes the old library. |
| *"I got a customer bug report about the checkout button"* | `bugs` | Files a single bug via `shipeasy feedback bugs create …`. |
| *"Resolve every open bug we have"* | `bugs` | Recommends `/shipeasy:bugs:fix` (the looping orchestrator) — the skill alone won't drive the multi-bug loop. |
| *"Stop the checkout-v2 experiment and ship treatment"* | `experiments` | `exp_stop_experiment { name, winner: "treatment" }`. |
| *"How significant is the checkout experiment so far?"* | `experiments` | `exp_experiment_status { name }`, surfaces enrolment per group + p-value + recommendation. |

If you want the *fix-every-open-bug* loop, the experiment-design loop,
or the i18n-bulk-extraction loop, prefer the slash commands —
`/shipeasy:bugs:fix`, `/shipeasy:experiment:create <name>`,
`/shipeasy:i18n:extract`. Each one is a multi-step orchestration the
underlying skill alone won't drive end-to-end.

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
`/shipeasy:flag:create`, etc.

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
