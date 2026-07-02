# Skill reference

> Full reference for the Shipeasy plugin surface. For installation see
> [`../README.md`](../README.md) and [`../INSTALL.md`](../INSTALL.md); for
> unattended scheduled triggers see `shipeasy ops trigger create <provider>
> --help` (also at <https://docs.shipeasy.ai/get-started/triggers>).

The plugin ships **12 skills** — **9 area skills** that auto-trigger on natural
language and carry the guidance for each subsystem, plus **3 workflow skills**
for the multi-step flows. Everything else — all day-to-day CRUD — runs through
the generated `shipeasy` MCP tools or the `shipeasy` CLI. (The thin
`*-install` onboarding wrappers for flags/i18n were removed — `shipeasy setup`
and `shipeasy install <group>` do that work now — and the i18n
migrate/translate workflows live inside `shipeasy-i18n` as references.)

Larger skills follow a **router + references** layout: a thin `SKILL.md`
carries the triggers, hard rules, and a routing table pointing into the
skill's `references/` directory, which holds the per-topic runbooks. Agents
read a reference only when routed to it, so the extra depth costs no context
until needed.

Two cross-cutting rules shape the whole surface:

- **Workflow skills are orchestrations; CRUD is MCP/CLI.** Create / list /
  update / archive of a gate, config, kill switch, experiment, metric, alert
  rule, ops item, or i18n key runs through the generated `shipeasy` MCP tools
  or the `shipeasy` CLI.
- **Deletes happen in the dashboard UI.** Resources are removed from the
  dashboard, never from the CLI/MCP surface (the destructive verb on the
  surface is **`archive`**, never `delete`).

Every skill installs on **every host** (native plugin or the `skills` CLI). In
Claude Code each skill is additionally user-invocable as a command
(`/shipeasy:<skill-name>`, with `$ARGUMENTS` support); on other hosts the same
skill triggers from phrasing or the host's explicit skill invocation.

---

## The 12 skills

### Area skills (guidance; auto-trigger on phrasing)

| Skill | Covers | Auto-triggers on phrasing like… |
| --- | --- | --- |
| `shipeasy-setup` | Base onboarding: detect subprojects, install SDK, login, bind, keys, wiring | "set up shipeasy", "install shipeasy", "onboard shipeasy" |
| `shipeasy-common` | Shared prerequisites: `.shipeasy` binding, MCP ⇄ CLI ⇄ API surfaces, version-drift updates, `docs_get` lookups, archive-not-delete | "shipeasy not working", "update shipeasy CLI/MCP", ".shipeasy file" |
| `shipeasy-flags` | Feature gates, dynamic configs, kill switches | "feature flag", "rollout", "kill switch", "dynamic config" |
| `shipeasy-experiments` | A/B experiments, universes, holdouts | "A/B test", "experiment", "split test", "holdout" |
| `shipeasy-metrics` | Event metrics + the query DSL | "create metric", "track metric", "metric DSL" |
| `shipeasy-alerts` | Metric-threshold alert rules | "alert rule", "alert me when", "metric threshold" |
| `shipeasy-ops` | The operational inbox: bugs, feature requests, error/alert tickets | "bug report", "feature request", "ops inbox" |
| `shipeasy-i18n` | Translatable text end-to-end: `i18n.t()` wrapping, keys, profiles, publish, plus the migrate-a-library and machine-translate-a-locale runbooks (`references/`) | "translate", "i18n", "make this translatable", "new locale", "migrate i18n" |
| `shipeasy-see` | Structured error reporting (`see()`, consequences, violations) | error handling, `console.error` migration, try/catch reviews |

### Workflow skills (multi-step orchestrations)

| Skill | Argument(s) | What it does |
| --- | --- | --- |
| `shipeasy-ops-install` | — | Enable `feedback` + production error collection, wire the devtools overlay and `see()` reporting per the project's language docs, and add the CLAUDE.md error-handling rule. |
| `shipeasy-ops-work` | `[--type bug\|feature\|error\|alert\|measure_plan\|all] [--priority high\|critical] [--limit <N>] [--pr] [--dry-run]` | The unified work loop over the operational queue — one atomic diff per item, each type worked per its `references/` runbook. `--pr` opens one PR per item (the mode the scheduled trigger runs). |
| `shipeasy-ops-trigger` | `[--provider claude\|cursor\|copilot\|…] [--frequency 4h\|6h\|daily\|weekdays\|weekly] [--dry-run]` | Provision a recurring, unattended trigger that runs the `shipeasy-ops-work` loop in `--pr` mode on a schedule. Provider-pluggable; the per-platform runbook is the built-in help of `shipeasy ops trigger create <provider>` (spec-generated; MCP: `ops_trigger_create_*`). |

(The former `shipeasy-i18n-migrate` / `shipeasy-i18n-translate` workflow
skills are now references inside `shipeasy-i18n` — same flows, routed from
its SKILL.md.)

The `SKILL.md` files under `shipeasy/skills/<name>/` (plus their
`references/*.md`) are the authoritative behaviour spec — the file *is* the
prompt the agent follows. Open the matching file for the full, current step
list rather than relying on a copy here.

---

## Headline workflows

### 1. `shipeasy-ops-work` — burn down the whole operational inbox

Picks up every actionable item across the unified queue — bug reports, feature
requests, tracked production errors, and active alerts — and resolves each as
its own atomic diff. `--type` scopes it. Each item becomes one atomic diff —
the loop does **not** parallelise, so blame stays clean. Without `--pr` it
refuses to `git commit`; you review and commit yourself.

Prereqs: `feedback` module enabled (`shipeasy-ops-install`).

### 2. Create a metric from a vague request

The `shipeasy-metrics` skill auto-triggers on phrases like *"create a metric
for checkout conversion"* and runs the analyze-and-suggest flow: find existing
`flags.track(...)` call sites and uninstrumented action points, propose 2–4
candidates via `AskUserQuestion`, instrument the chosen event if new, create
the metric, verify with `shipeasy metrics list`.

Prereqs: `events` module enabled (`shipeasy install flags`).

### 3. Design + provision an A/B test from a vague ask

The `shipeasy-experiments` skill drives the analyze → propose → provision flow:
locate the variation point, propose a success metric, instrument the event,
create the metric, draft the experiment (`release_experiments_create`), and
edit the variation point to branch on the assignment call. Stops at the
**draft** state — you decide when to start it.

Prereqs: flags platform enabled (`shipeasy install flags`).

### 4. Schedule the loop — `shipeasy-ops-trigger`

Provisions the unattended trigger that runs `shipeasy-ops-work --pr` on a
cadence. `--provider claude` (default) backs it with a scheduled Claude Code
routine in Anthropic's cloud (no GitHub Actions) and registers a Shipeasy
connector; other providers per `shipeasy ops trigger create <provider> --help`.

---

## Everything else: MCP + CLI

All day-to-day CRUD — create / list / update / archive of gates, configs, kill
switches, experiments, metrics, alert rules, ops items, and i18n keys — runs
through the generated `shipeasy` MCP tools or the `shipeasy` CLI. A few
representative examples:

| Task | MCP tool | CLI |
| --- | --- | --- |
| Create a feature gate | `release_flags_create` | `shipeasy release flags create` |
| Roll out / enable / disable a gate | `release_flags_rollout` / `_enable` / `_disable` | `shipeasy release flags rollout\|enable\|disable` |
| Create / update a dynamic config | `release_configs_create` / `release_configs_update` | `shipeasy release configs create\|update` |
| Toggle a kill-switch override | `release_killswitch_set` / `release_killswitch_unset` | `shipeasy release killswitch set\|unset` |
| List / start / results / stop an experiment | `release_experiments_list` / `_start` / `_results` / `_stop` | `shipeasy release experiments list\|start\|results\|stop` |
| List / show metrics, print the DSL | `metrics_list` / `metrics_show` / `metrics_grammar` | `shipeasy metrics list\|show\|grammar` |
| Create / list / update an alert rule | `ops_alerts_create` / `ops_alerts_list` / `ops_alerts_update` | `shipeasy ops alerts create\|list\|update` |
| List / file an ops item | `ops_list` / `ops_create` (or `ops_bug` / `ops_feature`) | `shipeasy ops list`, `shipeasy ops bug\|feature` |
| Push / set / validate i18n keys | `i18n_keys_push` / `i18n_keys_set` | `shipeasy i18n push\|update\|validate` |

Exact parameter shapes live in the tool itself — `shipeasy <cmd> --help`, the
MCP tool schema, or `docs_get`. **Deletes happen in the dashboard UI**; the
surface verb is `archive`.

---

## Enabling modules

Module enablement is a pure CLI verb — `shipeasy setup` offers it, or run one
directly:

- **`shipeasy install flags`** — gates, configs, events, experiments, and alert
  rules in one pass (kill switches ride the same KV blob and need no module).
- **`shipeasy install ops`** — `feedback` + production-error collection + alerts.
  Codebase wiring (devtools overlay, `see()` reporting) stays in the
  `shipeasy-ops-install` skill.
- **`shipeasy install i18n`** — `translations`, creates the `en:prod` profile.

Each verb enables the modules and verifies the admin read paths. The per-area
how-to skills (`shipeasy-flags`, `shipeasy-ops`, `shipeasy-i18n`) carry the
usage guidance and are installed by `shipeasy setup`.

---

## Layout

```
marketplace/
├── .claude-plugin/marketplace.json     # Claude Code: lists the shipeasy plugin
├── .agents/plugins/marketplace.json    # Codex: lists the shipeasy plugin (source ./shipeasy)
├── .github/plugin/marketplace.json     # Copilot CLI: lists the shipeasy plugin (source ./shipeasy)
├── .github/workflows/install-*.yml      # CI: per-plugin install smoke tests (claude/codex/copilot)
├── scripts/validate-plugin.mjs          # CI: deterministic manifest/skills/MCP validator
├── docs/reference.md                    # this file
├── INSTALL.md                           # full per-agent install reference
├── README.md                            # front page
└── shipeasy/                            # the only plugin
    ├── .claude-plugin/plugin.json      # Claude Code manifest (skills + mcp)
    ├── .codex-plugin/plugin.json       # Codex manifest → SAME ./skills/ + ./.mcp.json
    ├── .plugin/plugin.json             # Copilot manifest → SAME ./skills/ + ./.mcp.copilot.json
    ├── .mcp.json                        # MCP registration (mcpServers wrapper; Claude + Codex)
    ├── .mcp.copilot.json               # MCP registration with type:"local" (Copilot requires it)
    └── skills/                          # ALL 12 skills — router SKILL.md + optional references/
        ├── shipeasy-{setup,common,flags,experiments,metrics,alerts,ops,see}/SKILL.md
        ├── shipeasy-i18n/{SKILL.md,references/}      # wrapping, admin-keys, migrate, translate
        ├── shipeasy-ops-install/SKILL.md
        ├── shipeasy-ops-work/{SKILL.md,references/}  # per-item-type runbooks
        └── shipeasy-ops-trigger/SKILL.md
```

Skills and MCP are *referenced, never copied*: each host's manifest points its
`skills`/`mcpServers` fields at the same `shipeasy/skills/` directory and an MCP
file. Nothing is duplicated per host — and there is no separate `commands/`
surface; every workflow is a skill.

## Continuous verification (CI)

GitHub Actions smoke-tests that **every platform in [`../INSTALL.md`](../INSTALL.md)**
can install Shipeasy. Three per-plugin workflows —
`.github/workflows/install-{claude,codex,copilot}.yml` — cover the Tier-1 hosts,
and `install-skills-matrix.yml` covers the Tier-2 agents by installing the full
skill set via the [`skills`](https://github.com/vercel-labs/skills) CLI and
asserting the installed `SKILL.md` count matches the source tree. Each
per-plugin job:

1. **Validates wiring deterministically** — `node scripts/validate-plugin.mjs <host>`
   parses that host's marketplace + plugin manifests, asserts the marketplace
   `source` resolves to `./shipeasy`, that all 12 skills are present with a
   valid `name`/`description` matching their directory, and that the MCP file
   registers `shipeasy` (Copilot additionally requires `type: "local"`).
2. **Installs the host CLI** and prints its version.
3. **Installs the full skill set** from the checkout via the `skills` CLI and
   asserts the installed `SKILL.md` count matches the source tree.
4. **Attempts the native plugin install** as a non-blocking probe (headless
   native install isn't available everywhere yet).

Run the validator locally with `node scripts/validate-plugin.mjs all`.

The [`skills-contract`](../skills-contract/) package additionally asserts that
every CLI command / MCP tool a skill references exists on the real surfaces,
and that no skill references a stale `/shipeasy:*` slash command.
