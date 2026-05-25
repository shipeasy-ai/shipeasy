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

## Detailed command reference

Full docs for every slash command shipped by the plugin. Each section
mirrors the corresponding `commands/<area>/<verb>.md` file in this
repo — that file *is* the prompt Claude Code follows when the slash
command is invoked, so this section is the authoritative behaviour
spec.

### Setup

#### `/shipeasy:setup` `[--domain <production-domain>]`

*Run the Shipeasy base install — SDK, auth, project bind, keys, root-layout init, MCP registration.*

Run end-to-end Shipeasy base onboarding. Follow the `setup` skill step
by step. Do not skip the verification gates.

Hard rules:

- **Use the Bash tool for every CLI command.** Don't ask the user to run
  `shipeasy login`, `pnpm add ...`, etc. The MCP server cannot do
  browser flows over stdio; the Bash tool can. Run the commands.
- **`shipeasy login` opens a browser** — spawn it via Bash, wait for the
  CLI to exit 0 (user clicks "Authorize" in the browser), continue.
- **Handle monorepos.** Detect every subproject (frontend + backend +
  service dirs, etc.). One `.shipeasy` lives at the monorepo root;
  per-subproject SDK installs run inside each subproject's dir.

Steps in brief (full detail in the skill):

1. Preconditions: Node ≥20, inside a git repo.
2. **Detect subprojects** — scan for `package.json`, `pyproject.toml`,
   `Gemfile`, `go.mod`, `pom.xml`, `composer.json`, `Package.swift`,
   `build.gradle*`. Classify by language (only JS has a published SDK
   today; flag the rest for manual follow-up).
3. `shipeasy login` (via Bash) at the monorepo root. Browser opens; user
   picks an existing project or fills in name + production domain to
   create a new one. CLI auto-writes `.shipeasy` on return. Commit it.
4. `shipeasy keys create --type server` + `--type client` — same pair
   used by every subproject.
5. For each JS subproject: `cd <dir> && pnpm add @shipeasy/sdk [@shipeasy/react]`,
   persist keys to that subproject's `.env.local` (or its detected
   secret store).
6. For each JS entry point: add the single `await shipeasy({...})` call
   (root layout / `main.tsx` / `src/server.ts` depending on framework).
   For Next.js App Router also render `getBootstrapHtml()` into `<head>`.
7. Verify: `shipeasy whoami`, `shipeasy keys list`, per-subproject build.
8. Print the hand-off report and stop. **Do not run `git commit`.**

When done, point the user at the per-feature install commands:

```
/shipeasy:experiments:install
/shipeasy:metrics:install
/shipeasy:flags:install
/shipeasy:i18n:install
/shipeasy:bugs:install
```

### Experiments

#### `/shipeasy:experiments:install`

*Enable the experiments module and verify A/B + event collection works*

Per-feature install for `experiments`. Prereq: `/shipeasy:setup` already
run and `.shipeasy` exists.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run `/shipeasy:setup` first.

2. Enable the module:

   ```bash
   shipeasy modules enable experiments
   shipeasy modules list      # expect: experiments ✓
   ```

3. Smoke-test the assignment endpoint from a server context (just to
   confirm wiring, not to actually create an experiment):

   ```ts
   import { experiments } from "@shipeasy/sdk/server";
   const { group } = await experiments.assign("smoke-test", { user_id: "anon" });
   console.log({ group }); // returns the default group; no experiment exists yet
   ```

4. Print the hand-off:

   ```
   ✅ experiments install complete
   Module:  experiments ✓
   Next:    Use the `experiments` skill or /shipeasy:experiment:create <name>
            to design and launch your first A/B test.
   ```

#### `/shipeasy:experiment:create` `<name>`

*Analyze the project, propose variation points + a success metric, then create a Shipeasy A/B experiment end-to-end (events instrumented, metric created, experiment drafted).*

Drive the whole "design a new A/B test" flow from analysis to draft.
Follow the `experiments` skill for semantics. The user typing this
command does **not** know yet which event or metric to use — your job is
to look at the codebase, propose options, confirm with `AskUserQuestion`,
then provision everything.

Prereqs: `.shipeasy` bound, `experiments` + `events` modules enabled
(run `/shipeasy:experiments:install` + `/shipeasy:metrics:install` if
not). Experiment `<name>` taken from `$ARGUMENTS`; if blank, ask.

##### Phase 1 — locate variation points in the user's code

Search the codebase for *where the variant decision needs to be made*.
Heuristics in priority order:

1. The user's prompt that triggered this command usually names a feature
   (`/shipeasy:experiment:create checkout_button_v2` → look at checkout
   flow). Grep for the feature name first.
2. If unclear, ask for the surface area before scanning blindly — one
   `AskUserQuestion` with 2–4 candidate areas from the route table
   (`apps/**/page.tsx`, `src/routes/**`).

For each candidate variation point, capture:

- file:line of the component / handler that would branch on the variant
- the user-visible behaviour you'd toggle (button copy, route order,
  ranking weights, layout, …)

Stop at **one** variation point per experiment. Multi-variate is out of
scope here.

##### Phase 2 — propose a success metric

A metric ties variant → outcome. Look for:

1. **Existing `events.track(...)` call sites** — `grep -rn 'events\.track\b' src apps` (anywhere in the JS subprojects). These are pre-existing events; a metric over them needs zero new instrumentation.
2. **Implicit conversion points** — checkout submit, signup form
   submit, "Add to cart" handler, share button, etc. — code that fires
   when the user does the thing the experiment cares about. These need a
   new `events.track(name, props)` call.
3. **Existing metrics** — `shipeasy metrics list --json` for anything
   already defined; reusing avoids both an event and a metric.

Build 2–4 candidate metrics, each as `{ event, aggregation, why }`.
Examples:

- `count_users(checkout_completed)` — distinct users who finished
  checkout. Best when "did they convert?" is binary.
- `sum(purchase, amount)` — total revenue. Best when bigger basket is
  the win condition.
- `avg(time_to_paint, ms)` — page-load metric. Best for perf
  experiments.

Present with `AskUserQuestion`:

```
Q: Which metric should decide this experiment?
   Options:
   1. <name1> — <DSL> (reuses event <event1>, no new instrumentation)
   2. <name2> — <DSL> (needs new events.track("<event2>", { ... }) at <file:line>)
   3. <name3> — <DSL> (needs new event)
```

##### Phase 3 — provision (in order, halt on first failure)

For the chosen metric:

**3a.** If the event isn't emitted yet, instrument it. Edit the call
site (one Edit per file). Single import:

```ts
import { events } from "@shipeasy/sdk/client"; // or "@shipeasy/sdk/server"
events.track("<event>", { /* labels referenced by the metric query */ });
```

Confirm labels in the payload match every `{label=...}`, `by (...)`,
`value_label` referenced by the metric query — otherwise the metric
returns empty.

**3b.** Create the metric:

```bash
shipeasy metrics create "<metric_name>" \
  --event "<event_name>" \
  --query '<dsl>'
```

**3c.** Create the experiment draft. Default groups are
`control` 50% + `treatment` 50` unless the user asked otherwise. Use
MCP for typed errors:

```
mcp tool: exp_create_experiment {
  "name": "<name from $ARGUMENTS>",
  "universe": "default",
  "groups": [
    { "name": "control",   "allocation": 50, "params": { "variant": "v1" } },
    { "name": "treatment", "allocation": 50, "params": { "variant": "v2" } }
  ],
  "success_metric": "<metric_name>"
}
```

**3d.** Edit the variation point so the runtime branches on
`experiments.assign(...)`:

```ts
import { experiments } from "@shipeasy/sdk/server"; // or "@shipeasy/sdk/client"
const { group } = await experiments.assign("<name>", { user_id });
if (group === "treatment") {
  /* new code path */
} else {
  /* old code path */
}
```

##### Phase 4 — verify

```bash
shipeasy metrics list                       # the new metric appears
shipeasy experiments status "<name>"        # state: draft
```

Plus build/type-check the touched files.

##### Phase 5 — hand-off

Tell the user:

```
✅ Experiment <name> drafted.
   Variant point: <file:line>
   Event:         <event_name> (new | reused)
   Metric:        <metric_name> = <DSL>
   Groups:        control 50 / treatment 50
Next:
   /shipeasy:experiment:start <name>      # begin assigning traffic
   /shipeasy:experiment:status <name>     # check enrolment + significance later
```

Do **not** start the experiment automatically — the user reviews the
diff first.

##### Rules

- Don't restart an experiment under the same name once stopped (the
  assignment hash changes, re-randomising users). New attempts use
  `<old>_v2`.
- Don't add multiple success metrics. Pre-register one. The skill's
  warning about post-hoc metric additions applies here.
- Don't gate eligibility inside the experiment groups — push restrictions
  to a `targeting_gate` (a separate feature gate) so the universe stays
  clean.

#### `/shipeasy:experiment:start` `<name>`

*Start a Shipeasy A/B experiment (draft → running)*

Start a draft experiment so it begins assigning traffic. Follow the
`experiments` skill.

```
mcp tool: exp_start_experiment { "name": "<name>" }
```

CLI fallback: `shipeasy experiments start <name>`.

Once running, the experiment is immutable — groups, allocation, and
success metric cannot change. To modify, stop and recreate under a new
name (the assignment hash changes; never reuse the old name).

#### `/shipeasy:experiment:status` `<name>`

*Show enrolment + significance state for a Shipeasy experiment*

Show experiment status. Follow the `experiments` skill.

```
mcp tool: exp_experiment_status { "name": "<name>" }
```

CLI fallback: `shipeasy experiments status <name>`.

Returns: enrolled count per group, current p-value, whether the metric
has reached significance at the configured alpha, and a recommendation
(`keep_running`, `ship_treatment`, `ship_control`, `inconclusive`).

#### `/shipeasy:experiment:stop` `<name> [--winner treatment|control|null]`

*Stop a Shipeasy experiment and record the winner*

Stop a running experiment. Freezes assignment and writes the final
result. Follow the `experiments` skill.

```
mcp tool: exp_stop_experiment { "name": "<name>", "winner": "treatment" | "control" | null }
```

CLI fallback: `shipeasy experiments stop <name>`.

When stopping, refuse to relaunch under the same name — the assignment
hash changes and re-randomizes existing users. Suggest a new name
(`<old>_v2`).

### Metrics

#### `/shipeasy:metrics:install`

*Enable the events module so Shipeasy can collect metric data (plus optional experiments wiring)*

Per-plugin setup for metrics. Prereq: `base@shipeasy` installed and
`.shipeasy` exists.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run
   `claude plugin install base@shipeasy` + `/shipeasy-setup` first.

2. Enable modules:

   ```bash
   shipeasy modules enable events         # required: source data for metrics
   shipeasy modules enable experiments    # required if metrics gate A/B tests
   shipeasy modules list                  # expect: events ✓ (experiments ✓)
   ```

3. Smoke-test event tracking + metric round-trip:

   ```ts
   // in app code, somewhere it can run
   import { events } from "@shipeasy/sdk/client"; // or "@shipeasy/sdk/server"
   events.track("smoke_test", { amount: 1 });
   ```

   ```bash
   shipeasy metrics create smoke_count \
     --event smoke_test \
     --query 'count(smoke_test)'
   shipeasy metrics list                       # expect: smoke_count row
   shipeasy metrics delete <id-from-above>     # clean up
   ```

4. Hand-off:

   ```
   ✅ metrics setup complete
   Modules: events ✓ [experiments ✓]
   Next:    /shipeasy:metric:create <name> --event <event> --query '<dsl>'
            or use the `metrics` skill.
   ```

#### `/shipeasy:metric:create` `<name> --event <event> --query '<dsl>'`

*Create a Shipeasy metric (event-backed query) for tracking or experiment success*

Create a new metric. Follow the `metrics` skill.

Prereqs:

- `base@shipeasy` installed, `.shipeasy` bound.
- `events` module enabled (and `experiments` if the metric will be a
  success criterion). If unsure, run
  `/shipeasy:metrics:install` first.

Workflow:

1. Pick metric `<name>` and source `<event>`.
2. Pick DSL:
   `aggregation(event[{label op value, ...}][, value_label]) [by (...)] [without (...)]`.
   Run `shipeasy metrics grammar` for full syntax. Aggregations:
   `count_users`, `count`, `sum`, `avg`, `min`, `max`, `unique`,
   `p50/p75/p90/p95/p99/p999`, `retention_<N>d`. Match ops: `=`, `!=`,
   `=~`, `!~`.
3. If the event is not yet emitted in app code, instrument it first.
   Labels referenced by the query must exist on the event payload:

   ```ts
   import { events } from "@shipeasy/sdk/client"; // or "@shipeasy/sdk/server"
   events.track("checkout_completed", { amount, country });
   ```

4. Create:

   ```bash
   shipeasy metrics create <name> \
     --event <event_name> \
     --query '<dsl>' \
     [--folder <folder>] \
     [--winsorize <pct>]   # default 99
     [--mde <0..1>]        # min detectable effect for power calcs
   ```

   The event inside `--query` must equal `--event` — the CLI enforces this.

5. Verify: `shipeasy metrics list` (expect the new row with the rendered query).

#### `/shipeasy:metric:list`

*List metrics in the bound Shipeasy project*

Prereq: `.shipeasy` bound.

```bash
shipeasy metrics list            # tabular
shipeasy metrics list --json     # JSON
```

#### `/shipeasy:metric:show` `<id>`

*Show one Shipeasy metric by id*

Prereq: `.shipeasy` bound.

```bash
shipeasy metrics show <id>
shipeasy metrics show <id> --json
```

#### `/shipeasy:metric:delete` `<id>`

*Soft-delete a Shipeasy metric*

Soft-delete a metric. The API refuses if the metric is referenced by a
running experiment — stop the experiment first.

```bash
shipeasy metrics delete <id>
```

#### `/shipeasy:metric:grammar`

*Print the Shipeasy metric query DSL grammar*

```bash
shipeasy metrics grammar
```

Quick reference:

```
name(event[{label op value, ...}][, value_label]) [by (l1, l2)] [without (l1)]
```

Aggregations: `count_users`, `count`, `sum`, `avg`, `min`, `max`,
`unique`, `p50`/`p75`/`p90`/`p95`/`p99`/`p999`, `retention_<N>d`.

Match ops: `=`, `!=`, `=~`, `!~`. Strings quoted.

Examples:

```
count_users(checkout_completed)
sum(purchase{country="US"}, amount)
p99(req_dur{route=~"/api/.*"}, ms) by (route, status)
retention_7d(session_start)
avg(req_dur{tier!="free"}, ms) without (region)
```

Labels referenced in filters / value position / `by` / `without` must
be declared as properties on the source event.

### Flags (gates + configs + kill switches)

#### `/shipeasy:flags:install`

*Enable the gates + configs modules and verify the SDK reads them*

Per-feature install for `flags` (gates + configs + kill switches).
Prereq: `/shipeasy:setup` already run and `.shipeasy` exists.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run `/shipeasy:setup` first.

2. Enable the modules (independent toggles — enable what you need):

   ```bash
   shipeasy modules enable gates
   shipeasy modules enable configs
   shipeasy modules list      # expect: gates ✓ configs ✓
   ```

   (Kill switches reuse the `gates` module; no separate toggle.)

3. Smoke-test the read path from a server context:

   ```ts
   import { gates, configs } from "@shipeasy/sdk/server";
   console.log(await gates.check("smoke-test")); // false (no such gate)
   console.log(await configs.get("smoke-config", "fallback")); // "fallback"
   ```

4. Print the hand-off:

   ```
   ✅ flags install complete
   Modules: gates ✓ configs ✓
   Next:    Use the `flags` skill or /shipeasy:flag:create <name> [percent]
            to create your first gate / config / kill switch.
   ```

#### `/shipeasy:flag:create` `<gate-name> [percent]`

*Create a Shipeasy feature gate with the right rollout/targeting shape*

Create or update a Shipeasy feature gate. Follow the `flags` skill.

Defaults:

- `rollout_percent`: 0 (start dark, ramp manually).
- `default`: false (the safe path on KV failure).
- No targeting unless the user specifies attributes.

Steps:

1. If MCP is registered, use `exp_create_gate` for typed errors:
   ```
   mcp tool: exp_create_gate { "name": "<name>", "rollout_percent": <pct>, "default": false }
   ```
2. Otherwise:
   ```bash
   shipeasy flags create --name <name> --percent <pct>
   ```
3. Show the user the SDK call sites they need to add:
   ```ts
   import { gates } from "@shipeasy/sdk/server"; // or /client
   if (await gates.check("<name>", { user_id })) {
     /* new path */
   }
   ```
4. Remind: ramp is manual (5 → 25 → 50 → 100). Don't mention "automatic
   rollout" — Shipeasy doesn't auto-ramp.

### i18n (translations)

#### `/shipeasy:i18n:install`

*Enable the translations module, create the en:prod profile, and (if needed) inject the loader script*

Per-feature install for `i18n` (translations). Prereq: `/shipeasy:setup`
already run and `.shipeasy` exists.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run `/shipeasy:setup` first.

2. Enable the module:

   ```bash
   shipeasy modules enable translations
   shipeasy modules list      # expect: translations ✓
   ```

3. Create the primary profile (the CLI does **not** auto-create):

   ```bash
   shipeasy i18n profiles list
   shipeasy i18n profiles create en:prod --locales en   # only if missing
   ```

   **Use `en:prod`.** It matches the default `getBootstrapHtml()` and
   server-SSR string fetch — anything else needs a manual override.

4. Loader script — only run this if the project does **not** render
   `getBootstrapHtml()` (Pages Router, plain HTML, Vite, …). For canonical
   Next.js App Router projects, skip it; the bootstrap already injects the
   loader.

   ```bash
   shipeasy i18n install-loader --profile en:prod
   ```

5. Smoke-test the wrap-and-push flow with a single key:

   ```bash
   echo '{"smoke.test":"Smoke test value"}' > /tmp/se-smoke.json
   shipeasy i18n push /tmp/se-smoke.json --profile en:prod
   shipeasy i18n publish --profile en:prod
   rm /tmp/se-smoke.json
   ```

6. Print the hand-off:

   ```
   ✅ i18n install complete
   Module:    translations ✓
   Profile:   en:prod (en)
   Next:      Use the `i18n` skill or /shipeasy:i18n:extract
              to wrap hardcoded copy and push keys.
   ```

#### `/shipeasy:i18n:extract` `[target-dir]`

*Extract hardcoded user-visible strings and wrap them with i18n.t() from @shipeasy/sdk/client*

You are running an automated i18n extraction. Do not pause to ask the user
clarifying questions. Do not propose alternatives. Just run the steps below
and report at the end.

##### Steps

1. Apply the codemod against `$ARGUMENTS` (or auto-detected source dirs if
   empty — the CLI handles detection):

   ```bash
   shipeasy codemod i18n $ARGUMENTS
   ```

   The CLI auto-detects targets when no argument is given (it walks `app/`,
   `src/`, `components/`, `lib/`, `pages/` if they exist). It writes:
   - rewritten source files (`i18n.t("<key>", "<fallback>", …)` calls + the
     `import { i18n } from "@shipeasy/sdk/client"` line),
   - a flat `src/i18n/en.json` (or `i18n/en.json` if no `src/`) with the
     extracted key/value pairs (merge mode — safe to re-run).

2. Locate the generated keys file and push + publish:

   ```bash
   FILE=$(test -f src/i18n/en.json && echo src/i18n/en.json || echo i18n/en.json)
   shipeasy i18n push "$FILE" --profile en:prod --chunk default
   shipeasy i18n publish --profile en:prod --chunk default
   ```

3. Show the user the change footprint and tell them to review:

   ```bash
   git diff --stat
   ```

##### Rules

- **Do not ask the user** which directories to scan or whether to apply.
  The codemod is idempotent and reversible via `git`. Just run it.
- **Do not run with `--dry-run`** unless the user explicitly typed `dry-run`
  in their slash-command arguments.
- **Do not commit.** Stop after `git diff --stat`.
- If the codemod errors, show the error and stop — don't try to "self-heal"
  by switching directories or editing the config.

##### Final report (one short paragraph)

- files scanned / files modified / total keys pushed,
- the keys file path,
- one-line `git diff --stat` summary,
- the next command the user might want: `npm run build` (or `pnpm build`).

#### `/shipeasy:i18n:migrate` `<library-name>`

*Migrate an existing i18n library (react-i18next, react-intl, lingui, next-intl, raw-i18next) to Shipeasy*

Migrate the project's existing i18n library to `@shipeasy/sdk` i18n.

Supported migration sources (`$ARGUMENTS`):

- `react-i18next`
- `react-intl`
- `lingui`
- `next-intl`
- `raw-i18next`

Steps:

1. Confirm `$ARGUMENTS` matches one of the supported sources. If not, ask the user.
2. Preview:
   ```bash
   shipeasy codemod i18n --migrate $ARGUMENTS --dry-run --verbose
   ```
3. Apply:
   ```bash
   shipeasy codemod i18n --migrate $ARGUMENTS
   ```
4. The codemod rewrites call sites (`t("…")`, `<Trans>`, `<FormattedMessage>`,
   etc.) to `i18n.t(…)`. Existing translation files (`en.json`, etc.) are
   preserved — push them with:
   ```bash
   shipeasy i18n push en.json --profile en:prod
   ```
5. Remove the old library:
   ```bash
   pnpm remove i18next react-i18next   # or matching package set
   ```
6. Show the user the full diff before they commit. Run typecheck + build.

Do not delete the old translation JSON files until the user confirms keys are
visible in the Shipeasy dashboard.

### Bugs (feedback)

#### `/shipeasy:bugs:install`

*Enable the feedback module and verify the devtools overlay loads*

Per-feature install for `bugs`. Prereq: `/shipeasy:setup` already run and
`.shipeasy` exists.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run `/shipeasy:setup` first.

2. Enable the module:

   ```bash
   shipeasy modules enable feedback
   shipeasy modules list      # expect: feedback ✓
   ```

3. Verify the devtools overlay (the same overlay end users use to submit
   reports). The base install's `getBootstrapHtml()` already lazily
   injects `se-devtools.js` whenever the URL contains `?se` /
   `?se_devtools` — confirm by loading any page with `?se=1` appended.

   If the panel never appears in the browser, base setup is incomplete —
   send the user back to `/shipeasy:setup` to render
   `getBootstrapHtml()` into `<head>`.

4. Smoke-test the CLI mirror:

   ```bash
   shipeasy feedback bugs list           # should return [] or rows, never 403
   shipeasy feedback features list       # same
   ```

5. Print the hand-off:
   ```
   ✅ bugs install complete
   Module:  feedback ✓
   Wired:   devtools overlay (?se=1 on any page rendering getBootstrapHtml)
   Next:    Use the `bugs` skill, /shipeasy:bug:report bug "<title>", or
            ask end users to submit via the in-page Report panel.
   ```

#### `/shipeasy:bug:report` `<bug|feature> <title>`

*File a Shipeasy bug report or feature request from the CLI*

File a bug report or feature request against the bound project. Follow
the `bugs` skill.

Prereq:

- Project bound (`.shipeasy` present).
<<<<<<<< HEAD:shipeasy/commands/bugs/bug.md
- `feedback` module enabled (`/shipeasy:bugs:install` or `shipeasy modules enable feedback`).
========
- `feedback` module enabled — run `/shipeasy:bugs:install` first if not.
>>>>>>>> f82a432 (feat: consolidate 5 plugins into single shipeasy plugin):shipeasy/commands/bug/report.md

Steps:

1. Pick the subcommand:
   - `bugs create` for something broken.
   - `features create` for something missing.
2. Run:
   ```bash
   shipeasy feedback bugs create "<title>" \
     --description "<what / where / repro>" \
     [--page-url "<url>"]
   ```
3. Confirm it landed: `shipeasy feedback bugs list` (or `features list`).
4. Don't `delete` unless the user asked — triage happens in the dashboard.

#### `/shipeasy:bugs:fix` `[--status <open|triaged|in_progress>] [--priority high|critical] [--limit <N>] [--dry-run]`

*Loop over every open Shipeasy bug for the bound project, pull details + screenshots/recordings into context, investigate, and resolve them one-by-one.*

Resolve every actionable bug in the bound project. Follow the `bugs`
skill for triage semantics. **Loop, do not batch.** Each bug is its own
mini-investigation; finishing one before starting the next keeps the
diff reviewable and avoids cross-bug contamination.

Prereqs:

- `.shipeasy` bound. Run `/shipeasy:setup` first if missing.
- `feedback` module enabled. Run `/shipeasy:bugs:install` if `shipeasy feedback bugs list` returns `403`.
- CLI ≥ `1.4.0` (`shipeasy feedback bugs attachments` subcommand was
  added there). Older CLIs will fail step 1.2 with
  `error: unknown command 'attachments'` — bump the CLI before retrying.
- Working tree clean **or** the user explicitly asked to fix on top of
  WIP. If `git status --porcelain` is non-empty and the user hasn't
  confirmed, stop and ask. Mixing the loop's per-bug diffs with pre-existing
  WIP makes the resulting commits unreviewable.

##### 0. Build the work queue

Parse `$ARGUMENTS` for the optional flags up-front:

- `--status <s>` — default `open`. Anything in `BUG_STATUSES`.
- `--priority high|critical` — filter to only those priorities.
- `--limit <N>` — default `20`. Slice after sort.
- `--dry-run` — print the queue and exit 0. No status flips, no edits.

```bash
STATUS=${STATUS_FROM_ARGS:-open}
LIMIT=${LIMIT_FROM_ARGS:-20}
PRIORITY_FILTER=${PRIORITY_FROM_ARGS:-}      # high | critical | "" (no filter)
DRY_RUN=${DRY_RUN_FROM_ARGS:-}                # "1" if --dry-run was passed

shipeasy feedback bugs list --status "$STATUS" --json > /tmp/se-bugs-raw.json
```

Sort the queue with `priority desc, createdAt asc`. Priority order:
`critical > high > medium > low > null`. Without `jq` use Node:

```bash
node - <<'JS' < /tmp/se-bugs-raw.json > /tmp/se-bugs-queue.json
const RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const limit = parseInt(process.env.LIMIT || "20", 10);
const filter = process.env.PRIORITY_FILTER || "";
const rows = JSON.parse(require("fs").readFileSync(0, "utf-8"))
  .filter(b => !filter || b.priority === filter)
  .sort((a, b) =>
    (RANK[b.priority] || 0) - (RANK[a.priority] || 0) ||
    a.createdAt.localeCompare(b.createdAt))
  .slice(0, limit);
process.stdout.write(JSON.stringify(rows, null, 2));
JS
```

Print a one-line summary per bug before starting:

```
Queue (3):
  #abc12  critical  "Checkout 500 on iOS"   2026-05-17
  #def34  high      "Sidebar overflow"      2026-05-17
  #ghi56  medium    "Typo on /pricing"      2026-05-16
```

If the queue is empty: print "No bugs matching status=<STATUS>
priority=<filter>. Done." and stop.

If `--dry-run`: stop here. Do **not** flip status, do **not** edit
files, do **not** download attachments. The queue print above is the
deliverable.

Otherwise, extract just the ids for the loop:

```bash
node -e 'JSON.parse(require("fs").readFileSync(0,"utf8")).forEach(b=>console.log(b.id))' \
  < /tmp/se-bugs-queue.json > /tmp/se-bugs-queue.txt
wc -l /tmp/se-bugs-queue.txt
```

##### 1. For each bug id in /tmp/se-bugs-queue.txt — strict loop

Do the steps below for **one** id, then restart from 1.1 with the next
id. Do not interleave. Do not parallelise. Use TodoWrite to mirror the
queue so progress survives mid-loop interruption.

###### 1.1 Pull the bug detail (no attachments yet)

```bash
shipeasy feedback bugs get "$ID" --json > /tmp/se-bug.json
cat /tmp/se-bug.json
```

Read the JSON. Extract:

- `title`, `description`, `pageUrl`, `priority`, `status`, `createdAt`.
- `context` (usually contains userAgent, viewport, console logs, repro
  steps captured by the devtools overlay).
- `attachments[]` (an array of `{ id, kind, filename, contentType, size }`).

###### 1.2 Download every attachment to a local tmpdir

```bash
shipeasy feedback bugs attachments "$ID" --json > /tmp/se-attachments.json
cat /tmp/se-attachments.json
```

Each row is `{ id, kind, path, bytes }`. `kind` is one of
`screenshot | recording | file`.

###### 1.3 Bring attachments into context

For **screenshots** (`kind == "screenshot"`, or `contentType` starts
with `image/`): use the Read tool on `path`. The image is rendered to
you visually — use it.

For **recordings** (`kind == "recording"`, usually `.webm` or `.mp4`):
you cannot watch video directly. Surface to the user as a clickable
file:// URL and ask whether you should keep going on text + screenshots
alone, or if they want to extract a frame manually (`ffmpeg -ss <t> -i
<path> -frames:v 1 /tmp/frame.png`). Do not silently skip — recordings
often carry the only repro signal.

For **other files** (`kind == "file"`): treat by content-type. JSON / txt
/ md → Read them. Binary blobs → list size and content-type, do not try
to interpret.

###### 1.4 Move the bug to in_progress

```bash
shipeasy feedback bugs update "$ID" --status in_progress
```

This signals to the dashboard and to humans that someone (you) owns
this report right now. Skip if already in_progress.

###### 1.5 Investigate

Use the bug's `pageUrl`, `title`, and `description` to locate the
relevant code. Typical entry points:

- `pageUrl` → grep route files (`app/**/page.tsx`, `pages/**`, `src/routes/**`).
- Stack frame in `context.error.stack` → file:line for the throw site.
- Screenshot text → grep for visible strings (often unique enough to
  pinpoint the component).

**Reproduce locally if possible.** If the dev server is already running
(`pnpm dev` etc.), open the page and confirm the bug. If not, decide
whether spinning it up is worth the cost for this specific bug.

###### 1.6 Fix

Edit the offending file(s). Keep the diff scoped to this bug. Hard
rules for the per-bug edit:

- **No drive-by refactors.** Touch only what the bug requires. The
  resulting diff should be small enough to review in one sitting.
- **No silencing.** Fix the root cause — do not catch and swallow, do
  not stub a value, do not delete the failing assertion. If you find a
  test that's failing for the same reason, fix the code, not the test.
- **Reuse the `superpowers:systematic-debugging` skill** if the root
  cause is not obvious from the first read. Don't guess.

Run the relevant verification gate:

- Unit/integration tests touching the changed file.
- `pnpm type-check` if TS changed.
- For UI fixes, re-load the page in the running dev server.

If you can't reproduce and can't confidently fix: leave the bug at
`in_progress`, write a one-paragraph hand-off note explaining what's
missing (repro on a real device, customer-only env, missing logs), and
move on. **Do not flip to `resolved`** just to clear the queue.

###### 1.7 Mark resolved (only if confidently fixed and verified)

```bash
shipeasy feedback bugs update "$ID" --status resolved
```

If the fix is high-risk or needs human verification, use
`--status ready_for_qa` instead.

###### 1.8 Report and continue

Print a one-paragraph summary per bug:

```
✔ <id> "<title>" → resolved
  Repro:   <one line>
  Fix:     <files changed, one line each>
  Verify:  <test cmd | dev-server URL | "manual">
```

Then proceed to the next id.

##### 2. Final report

After the loop:

```
Processed N bugs.
  resolved:     X
  ready_for_qa: Y
  left as in_progress (couldn't fix): Z
Diff footprint:
$(git diff --stat)
```

Show the diff stat. **Do not run `git commit` or `git push`.** The user
reviews and commits.

##### Rules

- **One bug at a time.** Loop, don't parallelise. Different bugs almost
  always touch different files; resolving them sequentially keeps blame
  clean.
- **Never delete a bug.** Resolving (`--status resolved`) is the
  terminal state. Deletion is for spam, and that's a human call.
- **Never `--status wont_fix` without asking the user.** That's a
  product decision, not an engineering one.
- **Recordings need human acknowledgement.** Don't claim a bug is fixed
  if you skipped the recording — surface the file path and ask whether
  the screenshots alone are sufficient.
- **Stop the loop on first auth/permission error.** A `401` or `403`
  from the CLI means the binding/feedback module is wrong — don't burn
  through the queue producing the same failure.

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
