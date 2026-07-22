// AUTO-GENERATED from @shipeasy/openapi by scripts/gen-commands.mjs — DO NOT EDIT.
// The full CLI command tree, projected from the spec's tags + x-cli, calling
// the generated sdk fns. Regenerate with `pnpm gen:cli`.
import type { Command } from "commander";
import * as api from "@shipeasy/openapi/client";
import { type GenCtx, defineGroup, num, bool, str, json, clean } from "../commands/_gen-runtime.js";

export function registerGeneratedCommands(program: Command, ctx: GenCtx): void {
  const g_metrics = defineGroup(program, "metrics", { summary: "Metrics: the event-backed queries that drive tracking dashboards and experiment success / guardrail measurement.", help: "Metrics: the event-backed queries that drive tracking dashboards and\nexperiment success / guardrail measurement.\n\n**Definition.** Each metric pins one source event (`event_name`), one\naggregation, and (for `sum`/`avg`/quantile) a numeric value label. The\nquery is expressed as the DSL string (`query`, e.g. `sum(purchase, amount)`)\nor its typed IR (`query_ir`) — supply exactly one.\n\n**Identity.** Keyed by a stable `name` (single segment or `folder.name`).\nResolve endpoints accept the `id` or the `name`.\n\n**Deletion.** Archive (soft-delete). Blocked while the metric is attached\nto a running experiment — stop those first.", aliases: [] });
  const g_ops = defineGroup(program, "ops", { summary: "Operational queue: the unified table of bug reports, feature requests, and auto-filed error/alert tickets, all over `/api/admin/ops`.", help: "Operational queue: the unified table of bug reports, feature requests, and\nauto-filed error/alert tickets, all over `/api/admin/ops`. One `create`\nendpoint files either user type (`type: bug | feature_request`); list, get,\nupdate, and link-pr are unified across every type. Also exposes the\n`notify` escalation bell and the read-only Slack-channels list used to\nresolve alert-rule notification targets.\n\n**Handles.** A queue item is addressed by its per-project `number` (e.g. `7`)\nor its full id — the API resolves either.", aliases: [] });
  const g_projects = defineGroup(program, "projects", { summary: "Projects: the account-level container every other resource is scoped to.", help: "Projects: the account-level container every other resource is scoped to.\n\n**Account-level, not bound-project-level.** Both operations resolve from the caller's credential rather than the `.shipeasy`-bound project — `current` reads the project the auth header maps to, and `upsert` find-or-creates under the session's owner. Neither touches the local `.shipeasy` binding; recording the result there is a consumer side-effect layered on top.\n\n**Idempotent upsert.** A project is keyed by `(owner_email, domain)`. Calling `upsert` again with the same domain returns the existing project with `created: false`, so it is safe to run on every install.", aliases: [] });
  const g_metrics_events = defineGroup(g_metrics, "events", { summary: "Events: the catalog of event names (and their typed properties) that metric queries reference.", help: "Events: the catalog of event names (and their typed properties) that metric queries reference.\n\n**Auto-discovery.** The SDK's `/collect` ingest path records any unknown event name it receives as a `pending` row (`pending: 1`) so you can review it. Metrics defined on a pending event fail until it is approved.\n\n**Approval.** `POST /{id}/approve` promotes a pending event to usable (`pending: 0`), optionally declaring its folder/description/properties in the same call. Registering a brand-new event via `POST` that matches a pending name approves it instead of failing with a conflict.\n\n**Properties.** Each event can declare typed properties (`name`, `type` of `string|number|boolean`, `required`). On update/approve the `properties` array replaces the full set — there is no merge.\n\n**Deletion.** Soft-delete (the user-facing verb is `archive`). Blocked while any metric still references the event — delete those metrics first.", aliases: [] });
  const g_ops_agents = defineGroup(g_ops, "agents", { summary: "Connected AI agents — one per authenticated trigger connector (Claude / Cursor / Copilot / Jules).", help: "Connected AI agents — one per authenticated trigger connector (Claude /\nCursor / Copilot / Jules). The read-only roster behind agent assignment\nand the `ops ack` agent types: an AI ack (`ops ack <handle> --agent\n<type>`) requires the type to appear here, so this list is where an\n`AGENT_NOT_CONNECTED` error sends you.", aliases: [] });
  const g_ops_alerts = defineGroup(g_ops, "alerts", { summary: "Alert rules: the metric-threshold definitions the analysis cron evaluates each run.", help: "Alert rules: the metric-threshold definitions the analysis cron evaluates each run.\n\n**What fires.** Each rule binds a `metricId`, a `comparator` (`gt`/`gte`/`lt`/`lte`), and a `threshold`. On every cron pass the cron aggregates the metric over the trailing `windowHours` and raises an alert at `severity` when `value comparator threshold` holds.\n\n**Immutable metric.** The bound metric (and its aggregation) is fixed at create time — there is no update path for `metricId`. Tune `threshold`/`comparator`/`windowHours`/`severity`/`name`/`enabled` instead, or delete + recreate to repoint the rule at a different metric.\n\n**Delivery.** `notify` optionally targets a Slack channel and/or email for this rule; `null` falls back to the project's default notification settings. Slack targets require a connected Slack connector.", aliases: ["ar"] });
  const g_ops_comments = defineGroup(g_ops, "comments", { summary: "Comments on a queue item — the discussion thread that hangs off any bug, feature request, or auto-filed error/alert ticket.", help: "Comments on a queue item — the discussion thread that hangs off any bug,\nfeature request, or auto-filed error/alert ticket. Append a comment or read\nthe thread; one level of threaded replies via `parentId`.\n\n**Mentions.** `@teammate` in a body raises an in-app notification for that\nperson; `@shipeasy` asks Jarvis (the AI agent) to read the item and reply.\nComments authored by Jarvis carry `authorType: system`.", aliases: [] });
  const g_ops_fired_alerts = defineGroup(g_ops, "fired-alerts", { summary: "Fired alerts: the conditions the platform has actually raised — metric-rule crossings, armed kill switches, experiment SRM/peek guards, and guardrail breaches.", help: "Fired alerts: the conditions the platform has actually raised — metric-rule\ncrossings, armed kill switches, experiment SRM/peek guards, and guardrail\nbreaches. Raised only by the platform (UI killswitch handlers plus the\nworker analysis consumer and alerts cron), never filed by hand; deduped per\n`(source, dedupeKey)` with auto-resolve when the condition clears. This\nsurface lists them and triages one (status flip + person/agent owner). The\n*rules* that define metric-threshold alerts are the sibling alert-rules\nresource.", aliases: [] });
  const g_ops_investigations = defineGroup(g_ops, "investigations", { summary: "Investigation records on a queue item — the structured, read-only write-ups an AI agent produces while working it (findings / a blocking question / QA notes), plus the `working` run rows an ack or an AI hand-off opens.", help: "Investigation records on a queue item — the structured, read-only write-ups\nan AI agent produces while working it (findings / a blocking question / QA\nnotes), plus the `working` run rows an ack or an AI hand-off opens. This is\nthe AI-write seam the cockpit's detail panel renders: `list` reads what a\nprevious run found, `create` appends a new record, and `update` fills in the\n`working` run record you were handed (findings, PR, confidence) as you work.", aliases: [] });
  const g_ops_trigger = defineGroup(g_ops, "trigger", { summary: "Recurring coding-agent triggers: the scheduled, unattended runs that burn down the ops queue in `--pr` mode (one PR per fixed item; nothing auto-merges).", help: "Recurring coding-agent triggers: the scheduled, unattended runs that burn\ndown the ops queue in `--pr` mode (one PR per fixed item; nothing\nauto-merges). Shipeasy can fire four providers directly — Claude routines,\nCursor cloud agents, Copilot cloud agents, and Google Jules (the Gemini\npath) — registered here as trigger connectors (idempotent per provider\nkey). Other platforms (Codex, Windsurf, Cline, OpenClaw, OpenCode,\nContinue) schedule on their own surface — typically a GitHub Actions\n`schedule:` cron running the platform's headless CLI with the shared\ntrigger prompt.", aliases: [] });
  const g_release = defineGroup(program, "release", { summary: "Feature delivery — flags, kill switches, dynamic configs, A/B experiments, and the universes they bucket in.", help: "Release: the feature-delivery surface. One roof over the five resources\nthat decide which code path a user gets — feature gates (flags), kill\nswitches, dynamic configs, A/B/n experiments, and the universes that bucket\nthem — each exposed as its own subcommand group.\n\n**Groups.**\n- `flags` — boolean feature gates: AND-combined targeting rules + a percentage rollout (basis points), evaluated on the SDK hot path.\n- `killswitch` (`ks`) — per-env boolean overrides for incident response; no rules, no rollout, versioned per environment.\n- `configs` — JSON-Schema-validated structured values with a draft → publish workflow, delivered per environment.\n- `experiments` — randomised A/B/n assignment plus the analysis pipeline (t-test, sequential testing, SRM detection); `universes` hold the shared bucketing space and holdouts the experiments draw from.\n\n**Delivery model.** Every write rebuilds the project's KV blob and purges\nthe CDN — SDKs poll at the plan interval and never touch the database on\nthe hot path. The destructive verb is `archive` (soft-delete), never\n`delete`.\n\nRun `shipeasy release <group> --help` for the full contract of each group.", aliases: [] });
  const g_release_configs = defineGroup(g_release, "configs", { summary: "Dynamic configs: JSON-Schema-validated structured values delivered to SDKs and editable per environment with a draft/publish workflow.", help: "Dynamic configs: JSON-Schema-validated structured values delivered to SDKs and editable per environment with a draft/publish workflow.\n\n**Identity.** Each config is keyed by `name` in `folder.name` form (e.g. `pricing.tiers`). Immutable after create.\n\n**Schema-first.** Every config carries a JSON Schema (draft 2020-12, top-level `type: 'object'`). Every published value is validated against it.\n\n**Drafts → publish.** Per-env edits go through `PUT /{id}/drafts` (stages a value) then `POST /{id}/publish` (promotes to a new version). The flat `PATCH /{id}` republishes on **every** env in one shot — bypassing drafts.\n\n**Versioning.** Each publish bumps the per-env `version` monotonically. SDKs deliver the latest published version for each env.", aliases: [] });
  const g_release_experiments = defineGroup(g_release, "experiments", { summary: "A/B/n experiments: randomised group assignment plus the analysis pipeline (t-test, sequential testing, SRM detection) on top of a universe.", help: "A/B/n experiments: randomised group assignment plus the analysis pipeline (t-test, sequential testing, SRM detection) on top of a universe.\n\n**Identity.** Stable `name` (a-z, 0-9, `_`/`-`, max 64 chars). Immutable after create.\n\n**Lifecycle.** `draft → running → stopped → archived`. Transition via `POST /{id}/status`. An archived experiment that never started can be restored with `archived → draft`; restarting an archived experiment directly is not allowed.\n\n**Allocation.** `allocation_pct` (basis points, 0–10000) is the share of the targeted audience enrolled; `groups[].weight` (must sum to 10000) splits the enrolled audience. `targeting_gate` narrows the eligible audience before allocation.\n\n**Immutable while running.** `allocation_pct`, `groups`, `salt`, `universe`, `params` cannot be edited on a running experiment — stop it first.\n\n**Metrics.** Attach via `POST /{id}/metrics`. Each metric has a role: `goal` drives the decision, `guardrail` blocks ship on regression, `secondary` is informational.\n\n**Analysis.** Daily cron writes results to D1. Read via `GET /{id}/results` (latest per metric/group/day) or `GET /{id}/timeseries` (full history). `POST /{id}/reanalyze` requeues the analysis pass.", aliases: [] });
  const g_release_flags = defineGroup(g_release, "flags", { summary: "Feature gates: boolean flags evaluated at runtime against project rules + a percentage rollout.", help: "Feature gates: boolean flags evaluated at runtime against project rules + a percentage rollout.\n\n**Identity.** Each gate is keyed by a stable `name` (a-z, 0-9, `_`/`-`, max 64 chars) which is what SDKs pass to `Shipeasy.checkGate(user, '<name>')`. The `name` is immutable — rename means delete + recreate.\n\n**Evaluation model.** A gate returns `true` when (a) `enabled` is true, and (b) the caller satisfies the gate's rules. There are two evaluation shapes:\n- **Flat** — `rules` (AND-combined predicates) gate the caller, then `rollout_pct` (basis points, 0–10000) hashes them into a bucket. Used for simple `is in X% rollout` gates.\n- **Gatekeeper stack** — an ordered array of `condition` and `rollout` sub-gates, evaluated top-to-bottom; first match wins. Used to express `internal-only ∪ 1% beta ∪ 50% public` in one gate. When `stack` is present it takes precedence over the flat fields.\n\n**Rules.** Each rule is `{ attr, op, value }`. Supported ops: `eq`, `neq`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `contains`, `regex`. Attribute names match the keys on the SDK evaluation context (e.g. `country`, `plan`, `email`).\n\n**Rollout basis points.** `rollout_pct` is in **basis points**, not percent. `0` = 0%, `100` = 1%, `5000` = 50%, `10000` = 100%. This allows sub-1% precision (e.g. `7` = 0.07%).\n\n**Lifecycle.** Create dark (`rollout_pct: 0`) → attach rules → ramp via PATCH → flip kill-switch via `disable`/`enable` → delete once retired. Deletion is blocked while a running experiment references the gate as a targeting gate.", aliases: [] });
  const g_release_killswitch = defineGroup(g_release, "killswitch", { summary: "Killswitches: per-env boolean overrides for kill-style operational toggles.", help: "Killswitches: per-env boolean overrides for kill-style operational toggles. Optimised for incident response — no rules, no rollout, just a flat boolean (plus optional per-key overrides) versioned per environment.\n\n**Identity.** Each killswitch is keyed by `name` in `folder.name` form (e.g. `payments.checkout`). Immutable after create.\n\n**Per-env values.** Every killswitch stores one version stream per env (`dev`, `stage`, `prod`). A `PATCH` with `value`/`switches` applies to **every** env in one shot (publishes a new version per env). To touch a single env, use `PUT /{id}/switch` and friends.\n\n**Switches map.** Optional `switches: { key: bool }` overrides the flat `value` for specific named call sites — useful for region/feature-scoped kills.\n\n**Versioning.** Each publish (create, update, set-switch, unset-switch) bumps the per-env `version` monotonically. SDKs deliver the latest published version.", aliases: ["ks"] });
  const g_release_experiments_universes = defineGroup(g_release_experiments, "universes", { summary: "Universes: the shared bucketing space all experiments draw from.", help: "Universes: the shared bucketing space all experiments draw from.\n\n**Identity.** Each universe is keyed by a stable `name` (a-z, 0-9, `_`/`-`, max 64 chars). Experiments reference it via `universe: '<name>'`. The name is immutable.\n\n**Unit of randomisation.** `unit_type` selects the attribute hashed into a 0–9999 bucket — default `user_id` for per-user randomisation, `account_id` to keep a whole account in the same group.\n\n**Holdout.** `holdout_range` is an inclusive `[lo, hi]` bucket range (0–9999) reserved for measurement — callers hashed into the holdout are excluded from every experiment in the universe. Pro plan or higher.\n\n**Deletion.** Blocked while any non-archived experiment references the universe — archive those first.", aliases: [] });
  const g_release_flags_attributes = defineGroup(g_release_flags, "attributes", { summary: "Targeting attributes: the auto-inferred schema of user-context keys the platform has observed in evaluation calls.", help: "Targeting attributes: the auto-inferred schema of user-context keys the\nplatform has observed in evaluation calls. Read-only — populated by the\nSDK hot path, surfaced here so you can see which keys (and value types)\nare available when writing gate/experiment targeting rules.", aliases: [] });
  const g_release_flags_templates = defineGroup(g_release_flags, "templates", { summary: "Targeting-rule templates: reusable `{ attr, op, value }` rule definitions (country, email-domain, region presets, …).", help: "Targeting-rule templates: reusable `{ attr, op, value }` rule definitions\n(country, email-domain, region presets, …). Read-only built-ins ship with\nthe platform; each project can also save its own. To target by\ncountry/plan/region, list templates, copy the matching template's `rules`,\nsubstitute the concrete value(s), and pass them to `release flags create`.", aliases: [] });

  g_metrics.command("list")
    .description("List metrics")
    .option("--q <value>", "Case-insensitive substring filter across the resource's human-readable text columns (e.g. `name`, `title`, `description`). OR-matched across those columns; omit to return everything.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listMetrics({ client, query: clean({ q: str(opts.q) }), body: json(opts.data) as never }) });
    });
  g_metrics.command("create")
    .description("Create a metric")
    .argument("<name>", "Stable metric key. Single segment or `folder.name`; lowercase letters, digits, `_`/`-`; max 128 chars.")
    .option("--folder <value>", "Optional folder name grouping items in the dashboard. Alphanumeric, `_` or `-` (no `/`). Part of the SDK lookup key (`<folder>/<name>`).")
    .option("--event-name <value>", "Source event the query reads from.")
    .option("--query <value>", "Metric query DSL string, e.g. `sum(purchase, amount)`. The alternative to `query_ir`. Every label the query references — in filters, the value position, `by (…)`, or `without (…)` — must exist as a property on the tracked event's payload; a query over a label the event never carries validates fine but returns empty results.")
    .option("--winsorize-pct <value>", "Winsorise percentile (1–99) to clamp outliers. Defaults to 99.")
    .option("--default-min-effect-of-interest <value>", "Default minimum effect of interest (relative, 0–1) — the smallest change in this metric worth acting on, used as the power-planning baseline. Intrinsic to the metric; an experiment overrides it per-attachment with `min_effect_of_interest` when a specific decision has a different cost/risk bar. `null` to omit.")
    .option("--direction <value>", "Desired direction of movement. `higher_better` (default), `lower_better`, or `neutral` (guardrail).")
    .option("--unit <value>", "Display unit (e.g. `ms`, `%`, `$`), or `null` when unitless.")
    .option("--query-ir <value>", "Typed query IR — the structured alternative to the `query` DSL string. Exactly one of `query` / `query_ir` is supplied per metric body.")
    .action(async (name, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createMetric({ client, body: clean({ name: name, folder: str(opts.folder), event_name: str(opts.eventName), query: str(opts.query), winsorize_pct: num(opts.winsorizePct), default_min_effect_of_interest: num(opts.defaultMinEffectOfInterest), direction: str(opts.direction), unit: str(opts.unit), query_ir: json(opts.queryIr) }) }) });
    });
  g_metrics.command("show")
    .description("Get a metric")
    .argument("<id>", "Stable opaque metric id (`met_…`) or the metric's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.getMetric({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_metrics.command("update")
    .description("Update a metric")
    .argument("<id>", "Stable opaque metric id (`met_…`) or the metric's `name`.")
    .option("--folder <value>", "Optional folder name grouping items in the dashboard. Alphanumeric, `_` or `-` (no `/`). Part of the SDK lookup key (`<folder>/<name>`).")
    .option("--event-name <value>", "Source event the query reads from.")
    .option("--query <value>", "Metric query DSL string, e.g. `sum(purchase, amount)`. The alternative to `query_ir`. Every label the query references — in filters, the value position, `by (…)`, or `without (…)` — must exist as a property on the tracked event's payload; a query over a label the event never carries validates fine but returns empty results.")
    .option("--winsorize-pct <value>", "Winsorise percentile (1–99) to clamp outliers. Defaults to 99.")
    .option("--default-min-effect-of-interest <value>", "Default minimum effect of interest (relative, 0–1) — the smallest change in this metric worth acting on, used as the power-planning baseline. Intrinsic to the metric; an experiment overrides it per-attachment with `min_effect_of_interest` when a specific decision has a different cost/risk bar. `null` to omit.")
    .option("--direction <value>", "Desired direction of movement. `higher_better` (default), `lower_better`, or `neutral` (guardrail).")
    .option("--unit <value>", "Display unit (e.g. `ms`, `%`, `$`), or `null` when unitless.")
    .option("--query-ir <value>", "Typed query IR — the structured alternative to the `query` DSL string. Exactly one of `query` / `query_ir` is supplied per metric body.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.updateMetric({ client, path: { id: id }, body: clean({ folder: str(opts.folder), event_name: str(opts.eventName), query: str(opts.query), winsorize_pct: num(opts.winsorizePct), default_min_effect_of_interest: num(opts.defaultMinEffectOfInterest), direction: str(opts.direction), unit: str(opts.unit), query_ir: json(opts.queryIr) }) }) });
    });
  g_metrics.command("archive")
    .description("Archive a metric")
    .argument("<id>", "Stable opaque metric id (`met_…`) or the metric's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.deleteMetric({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_metrics.command("experiments")
    .description("List experiments using a metric")
    .argument("<id>", "Stable opaque metric id (`met_…`) or the metric's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listMetricExperiments({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_metrics.command("unarchive")
    .description("Unarchive a metric")
    .argument("<id>", "Stable opaque metric id (`met_…`) or the metric's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.unarchiveMetric({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_metrics.command("series")
    .description("Get a metric's time series")
    .argument("<id>", "Stable opaque metric id (`met_…`).")
    .option("--from <value>", "Window start, epoch seconds (inclusive).")
    .option("--to <value>", "Window end, epoch seconds (exclusive). Must be greater than `from`.")
    .option("--bucket <value>", "Bucket width in seconds (60s–86400s/1d). Defaults to `3600` (hourly). Each returned point is floor-aligned to this width.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.getMetricSeries({ client, path: { id: id }, body: clean({ from: num(opts.from), to: num(opts.to), bucket: num(opts.bucket) }) }) });
    });
  g_ops.command("list")
    .description("List the operational queue")
    .option("--type <value>", "Filter by item type (`bug`/`feature_request`/`error`/`alert`), or `all`.")
    .option("--status <value>", "Filter by lifecycle status, or `all`. The human-gated holding states (`pending_approval`, `triage`) are excluded from `all`/default and returned only when requested as the exact status.")
    .option("--limit <value>", "Max items to return (1–500).")
    .option("--owner <value>", "Narrow to items owned by one person OR one agent. Matches a person by `users.id`, email, or display name, and an agent by connector id, display name, or kebab-case handle — e.g. `owner=Claude` or `owner=alice@acme.dev`. Case-insensitive exact match, applied over the returned page.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listOpsItems({ client, query: clean({ type: json(opts.type), status: json(opts.status), limit: num(opts.limit), owner: str(opts.owner) }), body: json(opts.data) as never }) });
    });
  g_ops.command("create")
    .description("File a queue item (bug or feature request) — pass --type.")
    .argument("<title>", "One-line bug title (no leading/trailing whitespace).")
    .option("--type <value>", "Discriminator — files a bug.")
    .option("--steps-to-reproduce <value>", "How to reproduce the bug.")
    .option("--actual-result <value>", "What actually happened.")
    .option("--expected-result <value>", "What was expected instead.")
    .option("--priority <value>", "Initial triage priority, or `null`.")
    .option("--status <value>", "Initial lifecycle status; defaults to `open` when omitted.")
    .option("--assignee-id <value>", "The `users.id` of the person to assign as owner at creation, or `null`.")
    .option("--subscribers <value>", "Emails of teammates to subscribe to this item's Slack pings at creation.")
    .option("--tags <value>", "Tag names to attach at creation (get-or-created by name, deduped case-insensitively).")
    .option("--reporter-email <value>", "Email of the reporter, or `null`.")
    .option("--page-url <value>", "URL of the page the bug relates to, or `null`.")
    .option("--user-agent <value>", "Reporter's user-agent string, or `null`.")
    .option("--viewport <value>", "Reporter's viewport (e.g. `1280x720`), or `null`.")
    .option("--context <value>", "Arbitrary capture context, or `null`.")
    .option("--notify <value>", "Where this bug's completion notification lands.")
    .option("--description <value>", "What the feature is.")
    .option("--use-case <value>", "Why it's needed / the use case.")
    .action(async (title, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createOpsItem({ client, body: clean({ title: title, type: str(opts.type), stepsToReproduce: str(opts.stepsToReproduce), actualResult: str(opts.actualResult), expectedResult: str(opts.expectedResult), priority: str(opts.priority), status: str(opts.status), assigneeId: str(opts.assigneeId), subscribers: json(opts.subscribers), tags: json(opts.tags), reporterEmail: str(opts.reporterEmail), pageUrl: str(opts.pageUrl), userAgent: str(opts.userAgent), viewport: str(opts.viewport), context: json(opts.context), notify: str(opts.notify), description: str(opts.description), useCase: str(opts.useCase) }) }) });
    });
  g_ops.command("bug")
    .description("File a bug report.")
    .argument("<title>", "One-line bug title (no leading/trailing whitespace).")
    .option("--steps-to-reproduce <value>", "How to reproduce the bug.")
    .option("--actual-result <value>", "What actually happened.")
    .option("--expected-result <value>", "What was expected instead.")
    .option("--priority <value>", "Initial triage priority, or `null`.")
    .option("--status <value>", "Initial lifecycle status; defaults to `open` when omitted.")
    .option("--assignee-id <value>", "The `users.id` of the person to assign as owner at creation, or `null`.")
    .option("--subscribers <value>", "Emails of teammates to subscribe to this item's Slack pings at creation.")
    .option("--tags <value>", "Tag names to attach at creation (get-or-created by name, deduped case-insensitively).")
    .option("--reporter-email <value>", "Email of the reporter, or `null`.")
    .option("--page-url <value>", "URL of the page the bug relates to, or `null`.")
    .option("--user-agent <value>", "Reporter's user-agent string, or `null`.")
    .option("--viewport <value>", "Reporter's viewport (e.g. `1280x720`), or `null`.")
    .option("--context <value>", "Arbitrary capture context, or `null`.")
    .option("--notify <value>", "Where this bug's completion notification lands.")
    .action(async (title, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createOpsItem({ client, body: clean({ title: title, stepsToReproduce: str(opts.stepsToReproduce), actualResult: str(opts.actualResult), expectedResult: str(opts.expectedResult), priority: str(opts.priority), status: str(opts.status), assigneeId: str(opts.assigneeId), subscribers: json(opts.subscribers), tags: json(opts.tags), reporterEmail: str(opts.reporterEmail), pageUrl: str(opts.pageUrl), userAgent: str(opts.userAgent), viewport: str(opts.viewport), context: json(opts.context), notify: str(opts.notify), type: "bug" }) }) });
    });
  g_ops.command("feature")
    .description("File a feature request.")
    .argument("<title>", "One-line feature-request title (no leading/trailing whitespace).")
    .option("--description <value>", "What the feature is.")
    .option("--use-case <value>", "Why it's needed / the use case.")
    .option("--priority <value>", "Initial triage priority, or `null`.")
    .option("--status <value>", "Initial lifecycle status; defaults to `open` when omitted.")
    .option("--assignee-id <value>", "The `users.id` of the person to assign as owner at creation, or `null`.")
    .option("--subscribers <value>", "Emails of teammates to subscribe to this item's Slack pings at creation.")
    .option("--tags <value>", "Tag names to attach at creation (get-or-created by name, deduped case-insensitively).")
    .option("--reporter-email <value>", "Email of the reporter, or `null`.")
    .option("--page-url <value>", "URL of the page the request relates to, or `null`.")
    .option("--user-agent <value>", "Reporter's user-agent string, or `null`.")
    .option("--context <value>", "Arbitrary capture context, or `null`.")
    .option("--notify <value>", "Where this request's completion notification lands.")
    .action(async (title, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createOpsItem({ client, body: clean({ title: title, description: str(opts.description), useCase: str(opts.useCase), priority: str(opts.priority), status: str(opts.status), assigneeId: str(opts.assigneeId), subscribers: json(opts.subscribers), tags: json(opts.tags), reporterEmail: str(opts.reporterEmail), pageUrl: str(opts.pageUrl), userAgent: str(opts.userAgent), context: json(opts.context), notify: str(opts.notify), type: "feature_request" }) }) });
    });
  g_ops.command("get")
    .description("Get one queue item")
    .argument("<handle>", "Per-project item number (e.g. `7`) or the full ops item id.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (handle, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.getOpsItem({ client, path: { handle: handle }, body: json(opts.data) as never }) });
    });
  g_ops.command("update")
    .description("Update a queue item")
    .argument("<handle>", "Per-project item number (e.g. `7`) or the full ops item id.")
    .option("--title <value>", "New bug title (no leading/trailing whitespace).")
    .option("--steps-to-reproduce <value>", "Updated reproduction steps.")
    .option("--actual-result <value>", "Updated actual result.")
    .option("--expected-result <value>", "Updated expected result.")
    .option("--status <value>", "Lifecycle status of a queue item. The working flow is `open` → `triaged` → `in_progress` → `ready_for_qa` → `resolved` (or `wont_fix`, terminal from any earlier stage). `blocked` marks an item that can't progress until an external dependency clears — a working state a human sets and clears. `ready_for_qa` is what a developer sets once a fix lands; `resolved` is the QA sign-off, normally flipped in the dashboard after verification — set it directly from code only when the fix has been verified end-to-end. `investigating_by_ai` is a system-owned display state — set when the AI agent (Jarvis) picks an item up to investigate, never chosen by a human — so it is shown but not offered as a manual choice. Two human-gated holding states park an item OUT of the work queue until a human promotes it to `open` in the dashboard, so `GET /api/admin/ops` excludes them under `status=all`/default and returns them only when requested as an exact `status`: `pending_approval` is the pre-open approval gate for untriaged inbound (e.g. connector requests filed from a customer's connectors panel) so it never gets auto-implemented — approving = flipping the status to `open`; `triage` is the onboarding-help bucket — questions/errors submitted to the \"Stuck in onboarding?\" assistant are funnelled into the platform project as `triage` rows so the team can see where people get stuck and follow up, keeping onboarding chatter out of the work queue until a human moves real items to `open`.")
    .option("--priority <value>", "Triage priority, or `null` when not set (in an update, `null` clears it).")
    .option("--github-pr-number <value>", "Link (or, when `null`, unlink) a GitHub pull request to this bug.")
    .option("--notify <value>", "Where this item's completion notification lands, or `null`.")
    .option("--description <value>", "Updated description.")
    .option("--use-case <value>", "Updated use case.")
    .action(async (handle, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.updateOpsItem({ client, path: { handle: handle }, body: clean({ title: str(opts.title), stepsToReproduce: str(opts.stepsToReproduce), actualResult: str(opts.actualResult), expectedResult: str(opts.expectedResult), status: str(opts.status), priority: str(opts.priority), githubPrNumber: num(opts.githubPrNumber), notify: str(opts.notify), description: str(opts.description), useCase: str(opts.useCase) }) }) });
    });
  g_ops.command("link-pr")
    .description("Link a fixing PR")
    .argument("<handle>", "Per-project item number (e.g. `7`) or the full ops item id.")
    .option("--pr-number <value>", "PR number to record on the item. `null` unlinks the PR.")
    .option("--pr-url <value>", "Explicit PR URL. Required for error/alert tickets (no GitHub issue to derive the URL from).")
    .action(async (handle, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.linkPrToOpsItem({ client, path: { handle: handle }, body: clean({ prNumber: num(opts.prNumber), prUrl: str(opts.prUrl) }) }) });
    });
  g_ops.command("ack")
    .description("Ack an item (start a run)")
    .argument("<handle>", "Per-project item number (e.g. `7`) or the full ops item id.")
    .option("--agent <value>", "The AI agent type acking on the item's behalf — pass your own type when you are a coding agent (Claude Code passes `claude`, Cursor `cursor`, Copilot `copilot`, Jules/Gemini `jules`). Omit entirely for a human ack by the authenticated caller.")
    .option("--session-id <value>", "The agent-run session id (e.g. Claude's `session_01…`), so the dashboard can deep-link to the exact run page. Omit when the harness has no session id.")
    .action(async (handle, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.ackOpsItem({ client, path: { handle: handle }, body: clean({ agent: str(opts.agent), sessionId: str(opts.sessionId) }) }) });
    });
  g_ops.command("notify")
    .description("Raise an attention notification")
    .option("--title <value>", "One-line headline of what's blocked.")
    .option("--summary <value>", "One sentence: why it can't be fixed in code. Renders markdown.")
    .option("--steps <value>", "Ordered steps the human should take to unblock — self-contained (the human reads only this card, not the agent's transcript), 3–6 steps, each naming the exact file, command, env var, or dashboard page. Renders markdown.")
    .option("--href <value>", "Dashboard-relative deep link to the related item. `null` is accepted and treated as \"no link\".")
    .option("--dedupe-key <value>", "Stable per-escalation key (e.g. `feedback:7`) so re-runs dedupe to one row.")
    .action(async (opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.notifyOps({ client, body: clean({ title: str(opts.title), summary: str(opts.summary), steps: json(opts.steps), href: str(opts.href), dedupeKey: str(opts.dedupeKey) }) }) });
    });
  g_projects.command("current")
    .description("Show the current project")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.getCurrentProject({ client, body: json(opts.data) as never }) });
    });
  program.command("whoami")
    .description("Show the current project")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.getCurrentProject({ client, body: json(opts.data) as never }) });
    });
  g_projects.command("upsert")
    .description("Find-or-create a project by domain")
    .option("--domain <value>", "Lowercase bare hostname (e.g. `acme.com`, `app.acme.com`, `*.acme.com`), or `*` to allow any origin. Full URLs with `https://` are not accepted. The project is keyed by `(owner_email, domain)`, so a second call with the same domain returns the existing project.")
    .option("--name <value>", "Human-readable project name. Defaults to the domain on first create.")
    .action(async (opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.upsertProject({ client, body: clean({ domain: str(opts.domain), name: str(opts.name) }) }) });
    });
  g_projects.command("update")
    .description("Update the current project")
    .argument("<id>", "Stable opaque project id. Must match the caller's own project.")
    .option("--name <value>", "New project name.")
    .option("--domain <value>", "Lowercase bare hostname (e.g. `acme.com`, `app.acme.com`, `*.acme.com`), or `*` to allow any origin. Full URLs with `https://` are not accepted. The project is keyed by `(owner_email, domain)`, so a second call with the same domain returns the existing project.")
    .option("--slug <value>", "URL-safe identifier used in app URLs and SDK config. Lowercase letters, numbers, and hyphens; 2–48 chars; cannot start or end with a hyphen. The caller lowercases the raw slug before sending.")
    .option("--default-env <value>", "Default environment new resources are scoped to.")
    .option("--timezone <value>", "IANA timezone the project's daily analysis runs in.")
    .option("--stat-method <value>", "Statistical method the experiment analyzer uses.")
    .option("--sig-threshold <value>", "Significance threshold (alpha) for experiment analysis.")
    .option("--auto-rollback <value>", "Whether a failing guardrail auto-rolls back the experiment.")
    .option("--min-sample-days <value>", "Minimum number of days an experiment must run before it can be called.")
    .option("--module-translations <value>", "Enable/disable the i18n/translations module.")
    .option("--module-configs <value>", "Enable/disable the dynamic-configs module.")
    .option("--module-gates <value>", "Enable/disable the feature-gates module.")
    .option("--module-experiments <value>", "Enable/disable the experiments module.")
    .option("--module-feedback <value>", "Enable/disable the feedback/ops module.")
    .option("--module-user <value>", "Enable/disable the user-management module.")
    .option("--module-events <value>", "Enable/disable the events module.")
    .option("--min-sample-size <value>", "Verdict power guard — minimum users per arm before a ship/hold verdict.")
    .option("--min-runtime-days <value>", "Minimum days an experiment must run before a verdict (peeking guard).")
    .option("--default-power <value>", "Target statistical power (1−β) feeding the realized-MDE calculation.")
    .option("--ci-confidence <value>", "Confidence level for the interval surfaced on results (any value in [0.5, 0.999], e.g. 0.90, 0.95, 0.975, 0.99).")
    .option("--default-allocation-pct <value>", "Default traffic allocation (basis points, 1000 = 10%) new experiments start with; overridable per experiment.")
    .option("--default-holdout <value>", "Default holdout carve-out (basis points) that seeds each new universe's holdout (0 = none).")
    .option("--default-winsorize-pct <value>", "Default winsorization percentile new metrics start with; overridable per metric.")
    .option("--default-mei <value>", "Default minimum effect of interest (relative, 0–1) new metrics start with; overridable per metric and per experiment. Null clears it.")
    .option("--cuped-baseline-days <value>", "CUPED baseline window — days of pre-experiment history, frozen at start.")
    .option("--cuped-min-overlap <value>", "CUPED selection-bias guard — min share of users with a baseline, else skip.")
    .option("--cuped-min-baseline-users <value>", "CUPED — minimum users with a baseline before it runs at all.")
    .option("--msprt-tau-mei-factor <value>", "mSPRT prior width — τ = minimum effect of interest × this factor.")
    .option("--msprt-tau-sd-factor <value>", "mSPRT fallback prior width — τ = this × control SD when no MEI is set.")
    .option("--srm-threshold <value>", "SRM chi-square p-value below which the run is called invalid.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.updateProject({ client, path: { id: id }, body: clean({ name: str(opts.name), domain: str(opts.domain), slug: str(opts.slug), defaultEnv: str(opts.defaultEnv), timezone: str(opts.timezone), statMethod: str(opts.statMethod), sigThreshold: str(opts.sigThreshold), autoRollback: bool(opts.autoRollback), minSampleDays: num(opts.minSampleDays), moduleTranslations: bool(opts.moduleTranslations), moduleConfigs: bool(opts.moduleConfigs), moduleGates: bool(opts.moduleGates), moduleExperiments: bool(opts.moduleExperiments), moduleFeedback: bool(opts.moduleFeedback), moduleUser: bool(opts.moduleUser), moduleEvents: bool(opts.moduleEvents), minSampleSize: num(opts.minSampleSize), minRuntimeDays: num(opts.minRuntimeDays), defaultPower: num(opts.defaultPower), ciConfidence: num(opts.ciConfidence), defaultAllocationPct: num(opts.defaultAllocationPct), defaultHoldout: num(opts.defaultHoldout), defaultWinsorizePct: num(opts.defaultWinsorizePct), defaultMei: num(opts.defaultMei), cupedBaselineDays: num(opts.cupedBaselineDays), cupedMinOverlap: num(opts.cupedMinOverlap), cupedMinBaselineUsers: num(opts.cupedMinBaselineUsers), msprtTauMeiFactor: num(opts.msprtTauMeiFactor), msprtTauSdFactor: num(opts.msprtTauSdFactor), srmThreshold: num(opts.srmThreshold) }) }) });
    });
  g_metrics_events.command("list")
    .description("List events")
    .option("--q <value>", "Case-insensitive substring filter across the resource's human-readable text columns (e.g. `name`, `title`, `description`). OR-matched across those columns; omit to return everything.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listEvents({ client, query: clean({ q: str(opts.q) }), body: json(opts.data) as never }) });
    });
  g_metrics_events.command("create")
    .description("Register an event")
    .argument("<name>", "Event name. Starts with a letter, digit, or `_`; letters, digits, `_`, `-`, `.`; max 128 chars. Immutable after create — this is the handle metric queries reference.")
    .option("--folder <value>", "Optional folder name grouping items in the dashboard. Alphanumeric, `_` or `-` (no `/`). Part of the SDK lookup key (`<folder>/<name>`).")
    .option("--description <value>", "Optional human-readable description of the event.")
    .option("--properties <value>", "Typed properties declared on the event. Defaults to an empty list.")
    .action(async (name, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createEvent({ client, body: clean({ name: name, folder: str(opts.folder), description: str(opts.description), properties: json(opts.properties) }) }) });
    });
  g_metrics_events.command("get")
    .description("Get an event")
    .argument("<id>", "Stable opaque event id (`evt_…`) or the event's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.getEvent({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_metrics_events.command("update")
    .description("Update an event")
    .argument("<id>", "Stable opaque event id (`evt_…`) or the event's `name`.")
    .option("--folder <value>", "Optional folder name grouping items in the dashboard. Alphanumeric, `_` or `-` (no `/`). Part of the SDK lookup key (`<folder>/<name>`).")
    .option("--description <value>", "New description for the event.")
    .option("--properties <value>", "Replaces the full property set (no merge). Omit to leave properties unchanged.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.updateEvent({ client, path: { id: id }, body: clean({ folder: str(opts.folder), description: str(opts.description), properties: json(opts.properties) }) }) });
    });
  g_metrics_events.command("archive")
    .description("Archive an event")
    .argument("<id>", "Stable opaque event id (`evt_…`) or the event's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.deleteEvent({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_metrics_events.command("approve")
    .description("Approve a pending event")
    .argument("<id>", "Stable opaque event id (`evt_…`) or the event's `name`.")
    .option("--folder <value>", "Optional folder name grouping items in the dashboard. Alphanumeric, `_` or `-` (no `/`). Part of the SDK lookup key (`<folder>/<name>`).")
    .option("--description <value>", "New description for the event.")
    .option("--properties <value>", "Replaces the full property set (no merge). Omit to leave properties unchanged.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.approveEvent({ client, path: { id: id }, body: clean({ folder: str(opts.folder), description: str(opts.description), properties: json(opts.properties) }) }) });
    });
  g_ops_agents.command("list")
    .description("List connected AI agents")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listOpsAgents({ client, body: json(opts.data) as never }) });
    });
  g_ops_alerts.command("channels")
    .description("List Slack channels")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listSlackChannels({ client, body: json(opts.data) as never }) });
    });
  g_ops_alerts.command("list")
    .description("List alert rules")
    .option("--q <value>", "Case-insensitive substring filter across the resource's human-readable text columns (e.g. `name`, `title`, `description`). OR-matched across those columns; omit to return everything.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listAlertRules({ client, query: clean({ q: str(opts.q) }), body: json(opts.data) as never }) });
    });
  g_ops_alerts.command("create")
    .description("Create an alert rule")
    .option("--name <value>", "Human label for the rule, shown on the alert and the rules list.")
    .option("--metric-id <value>", "Id of the metric to evaluate.")
    .option("--comparator <value>", "How the metric value is compared to the threshold (gt/gte/lt/lte).")
    .option("--threshold <value>", "Threshold the metric value is compared against.")
    .option("--window-hours <value>", "Lookback window (hours) the metric is aggregated over. 1–720.")
    .option("--severity <value>", "Severity of the raised alert.")
    .option("--enabled <value>", "Whether the rule is evaluated by the cron.")
    .option("--notify <value>", "Delivery target for a notification; `null` = use the project default.")
    .action(async (opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createAlertRule({ client, body: clean({ name: str(opts.name), metricId: str(opts.metricId), comparator: str(opts.comparator), threshold: num(opts.threshold), windowHours: num(opts.windowHours), severity: str(opts.severity), enabled: bool(opts.enabled), notify: json(opts.notify) }) }) });
    });
  g_ops_alerts.command("update")
    .description("Update an alert rule")
    .argument("<id>", "Stable opaque alert-rule id (`ar_…`) or the rule's `name`.")
    .option("--name <value>", "")
    .option("--comparator <value>", "")
    .option("--threshold <value>", "")
    .option("--window-hours <value>", "")
    .option("--severity <value>", "")
    .option("--enabled <value>", "")
    .option("--notify <value>", "Delivery target for a notification; `null` = use the project default.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.updateAlertRule({ client, path: { id: id }, body: clean({ name: str(opts.name), comparator: str(opts.comparator), threshold: num(opts.threshold), windowHours: num(opts.windowHours), severity: str(opts.severity), enabled: bool(opts.enabled), notify: json(opts.notify) }) }) });
    });
  g_ops_alerts.command("archive")
    .description("Delete an alert rule")
    .argument("<id>", "Stable opaque alert-rule id (`ar_…`) or the rule's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.deleteAlertRule({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_ops_comments.command("list")
    .description("List an item's comments")
    .argument("<handle>", "Per-project item number (e.g. `7`) or the full ops item id.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (handle, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listOpsComments({ client, path: { handle: handle }, body: json(opts.data) as never }) });
    });
  g_ops_comments.command("create")
    .description("Comment on an item")
    .argument("<handle>", "Per-project item number (e.g. `7`) or the full ops item id.")
    .option("--body <value>", "The comment body as markdown. Mentions (`@teammate`, `@shipeasy`) are parsed from it.")
    .option("--parent-id <value>", "Reply under this top-level comment. Omit / `null` for a top-level comment. Replying to a reply attaches to the same top-level parent (threading is one level deep).")
    .action(async (handle, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createOpsComment({ client, path: { handle: handle }, body: clean({ body: str(opts.body), parentId: str(opts.parentId) }) }) });
    });
  g_ops_fired_alerts.command("list")
    .description("List fired alerts")
    .option("--status <value>", "Filter by lifecycle state. Defaults to `active` (currently firing); `all` returns every status.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listAlerts({ client, query: clean({ status: str(opts.status) }), body: json(opts.data) as never }) });
    });
  g_ops_fired_alerts.command("update")
    .description("Update a fired alert")
    .argument("<id>", "Stable opaque alert id (`al_…`).")
    .option("--status <value>", "New lifecycle state. `resolved` / `dismissed` stamp their timestamp; `active` re-opens and clears both.")
    .option("--assignee-id <value>", "PERSON owner — a `users.id`, or `null` to clear the assignment.")
    .option("--agent <value>", "AGENT owner — a connected trigger connector's id (`connectors.id`), the built-in `\"jarvis\"` (Enterprise plan only — rejected with `403` otherwise), or `null` to clear. Stored in `assigneeConnectorId` or `assigneeAgent` depending on the value; the two are mutually exclusive.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.updateAlert({ client, path: { id: id }, body: clean({ status: str(opts.status), assigneeId: str(opts.assigneeId), agent: str(opts.agent) }) }) });
    });
  g_ops_investigations.command("list")
    .description("List an item's investigation records")
    .argument("<handle>", "Per-project item number (e.g. `7`) or the full ops item id.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (handle, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listOpsInvestigations({ client, path: { handle: handle }, body: json(opts.data) as never }) });
    });
  g_ops_investigations.command("create")
    .description("Record an investigation")
    .argument("<handle>", "Per-project item number (e.g. `7`) or the full ops item id.")
    .option("--kind <value>", "Which lifecycle stage the record documents.")
    .option("--summary <value>", "One-line summary of the record.")
    .option("--findings <value>", "The full findings write-up (markdown).")
    .option("--question <value>", "A blocking question for the team (markdown).")
    .option("--qa-notes <value>", "How to verify the fix — QA notes (markdown).")
    .option("--agent <value>", "The agent type producing the record — pass your own type when you are a coding agent.")
    .option("--model <value>", "The model the agent ran on.")
    .option("--connector-id <value>", "The trigger-connector row id the agent ran through.")
    .option("--pr-number <value>", "A PR the record references.")
    .option("--pr-url <value>", "HTML URL of that PR.")
    .option("--sources <value>", "The files/links inspected.")
    .option("--confidence <value>", "Self-reported confidence in the record.")
    .option("--tokens-used <value>", "Tokens the run consumed.")
    .option("--duration-ms <value>", "Run duration in milliseconds.")
    .option("--visibility <value>", "Record visibility. Defaults to `published`; `draft` keeps it out of the panel.")
    .option("--started-at <value>", "ISO-8601 timestamp the work started.")
    .option("--completed-at <value>", "ISO-8601 timestamp the work finished.")
    .option("--session-id <value>", "The agent-run session id, so the dashboard can deep-link to the run.")
    .action(async (handle, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createOpsInvestigation({ client, path: { handle: handle }, body: clean({ kind: str(opts.kind), summary: str(opts.summary), findings: str(opts.findings), question: str(opts.question), qaNotes: str(opts.qaNotes), agent: str(opts.agent), model: str(opts.model), connectorId: str(opts.connectorId), prNumber: num(opts.prNumber), prUrl: str(opts.prUrl), sources: json(opts.sources), confidence: str(opts.confidence), tokensUsed: num(opts.tokensUsed), durationMs: num(opts.durationMs), visibility: str(opts.visibility), startedAt: str(opts.startedAt), completedAt: str(opts.completedAt), sessionId: str(opts.sessionId) }) }) });
    });
  g_ops_investigations.command("update")
    .description("Update an investigation record")
    .argument("<handle>", "Per-project item number (e.g. `7`) or the full ops item id.")
    .argument("<investigationId>", "The investigation record id (from `POST`/`GET .../investigation` or the `runId` an ack/launch returned).")
    .option("--kind <value>", "Reclassify the record's lifecycle stage (e.g. flip a `working` run into `investigated` once findings land).")
    .option("--summary <value>", "One-line summary of the record.")
    .option("--findings <value>", "The full findings write-up (markdown).")
    .option("--question <value>", "A blocking question for the team (markdown).")
    .option("--qa-notes <value>", "How to verify the fix — QA notes (markdown).")
    .option("--model <value>", "The model the agent ran on.")
    .option("--pr-number <value>", "A PR the record references.")
    .option("--pr-url <value>", "HTML URL of that PR.")
    .option("--sources <value>", "The files/links inspected.")
    .option("--confidence <value>", "Self-reported confidence in the record.")
    .option("--tokens-used <value>", "Tokens the run consumed.")
    .option("--duration-ms <value>", "Run duration in milliseconds.")
    .option("--visibility <value>", "Record visibility. `draft` keeps it out of the panel; `published` surfaces it.")
    .option("--completed-at <value>", "ISO-8601 timestamp the work finished. Set it (or flip `kind` off `working`) to mark a run record done.")
    .option("--session-id <value>", "The agent-run session id, so the dashboard can deep-link to the run.")
    .action(async (handle, investigationId, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.updateOpsInvestigation({ client, path: { handle: handle, investigationId: investigationId }, body: clean({ kind: str(opts.kind), summary: str(opts.summary), findings: str(opts.findings), question: str(opts.question), qaNotes: str(opts.qaNotes), model: str(opts.model), prNumber: num(opts.prNumber), prUrl: str(opts.prUrl), sources: json(opts.sources), confidence: str(opts.confidence), tokensUsed: num(opts.tokensUsed), durationMs: num(opts.durationMs), visibility: str(opts.visibility), completedAt: str(opts.completedAt), sessionId: str(opts.sessionId) }) }) });
    });
  const g_ops_trigger_create = defineGroup(g_ops_trigger, "create", { summary: "Create a recurring coding-agent trigger", help: "A trigger is an unattended, scheduled agent run: on a cron cadence it runs the\nshipeasy-ops-work loop in --pr mode against your project — one atomic diff and\nONE pull request per fixed item, nothing auto-merges.\n\nWhatever the provider, the scheduled run executes this trigger prompt (headless\nCLIs take it as the prompt; cloud agents as the task body):\n\n  You are an unattended Shipeasy maintenance run. Authenticate every `shipeasy`\n  call with these env vars (the CLI reads them directly — do NOT run\n  `shipeasy login`, never echo the token). Put them at the top of EVERY shell\n  invocation that calls `shipeasy`; each command runs in a fresh shell:\n\n  export SHIPEASY_CLI_TOKEN=\"<OPS_KEY>\"\n  export SHIPEASY_PROJECT_ID=\"<PROJECT_ID>\"\n\n  Ensure the repo is bound: test -f .shipeasy || printf '{\"project_id\":\"<PROJECT_ID>\"}\\n' > .shipeasy\n  (never commit .shipeasy).\n\n  Refresh to the latest plugin + CLI, then run the ops work loop in --pr mode:\n    <PLUGIN-INSTALL-FOR-THIS-HOST>       # plugin install for claude/copilot, or `npx -y skills add …`\n    npm install -g @shipeasy/cli@latest\n  Then follow the installed shipeasy-ops-work (--pr) workflow verbatim: burn down\n  the queue, one atomic diff per item, open ONE PR per item from a safe branch\n  prefix, flip each to ready_for_qa, add \"Closes #<issue>\" where an item has a\n  connected GitHub issue. If the queue is empty, exit cleanly. Never merge.\n\n<OPS_KEY> is a restricted `ops` key — mint with\n`npx -y @shipeasy/cli@latest keys create --type ops`. It reads the queue, flips\nstatus, links the PR it opens, and creates resources only; it can never edit or\ndelete existing resources, and auto-extends its 7-day expiry on each run.\n<PROJECT_ID> comes from the bound .shipeasy. Never print either value.\n\nSafety: auto-approve flags (--approval-mode=yolo, --dangerously-skip-permissions,\n…) remove the human gate — run only in an isolated env. Unattended loops spend\ntokens/credits on a cadence: start weekly/daily and watch the first runs." });
  g_ops_trigger_create.argument("[provider]", "One of the subcommands below.");
  g_ops_trigger_create.action((provider) => {
    if (!provider) return g_ops_trigger_create.help();
    console.log("Direct (Shipeasy-fired) triggers are not supported for this platform — it\nexposes no HTTP \"start a run\" endpoint our Worker can call. Supported here:\nclaude, cursor, copilot, jules (alias: gemini) — see\n`shipeasy ops trigger create <provider> --help`.\n\nPlatform-scheduled setup instead (the platform's own scheduler fires the\nrun; nothing to register in Shipeasy):\n\n1. Mint the restricted ops key (`shipeasy sdk keys create --type ops --json`)\n   and read the project id from .shipeasy. Never print either.\n2. Build the trigger prompt (run `shipeasy ops trigger create claude --help`\n   for the shared template) with the key, project id, and your platform's\n   install line substituted.\n3. Schedule a headless run with it — a GitHub Actions `schedule:` cron\n   (always-on; credentials as repo secrets incl. a GH_TOKEN/PAT with\n   contents:write + pull-requests:write) or a local cron/daemon (machine\n   must stay awake):\n\n     codex     GitHub Actions cron → `codex cloud exec --env <ENV_ID> \"<PROMPT>\"`\n               (submits a Codex Cloud task — machine-off; configure network +\n               SHIPEASY_* secrets once at chatgpt.com/codex/cloud/settings/environments)\n     windsurf  Devin Scheduled Sessions (cloud cron; WINDSURF/DEVIN API key)\n     cline     `cline schedule create --cron \"…\" --prompt \"<PROMPT>\"` (local daemon)\n     openclaw  `openclaw cron create \"…\" \"<PROMPT>\"` (local gateway; static API key)\n     opencode  `opencode run \"<PROMPT>\"` + external cron (permission: \"allow\")\n     continue  `cn -p --auto \"<PROMPT>\"` + external cron (CONTINUE_API_KEY)\n\n4. Verify one manual fire (expect a PR or a clean empty-queue exit) and\n   manage/pause it on that platform's scheduler.");
    process.exitCode = 1;
  });
  g_ops_trigger_create.command("claude")
    .description("Register a Claude Code scheduled routine as the trigger connector")
    .option("--name <value>", "Human-readable connector label.")
    .option("--events <value>", "Events that auto-fire the routine. Defaults to empty so the trigger does not auto-fire paid runs until events are subscribed.")
    .option("--config <value>", "Non-secret config for a Claude trigger.")
    .option("--token <value>", "The routine's fire bearer token (secret). **Optional** — a tokenless trigger is recorded but not fireable until a token is added later. Encrypted into the credentials cipher; never persisted in `config` or returned.")
    .option("--enabled <value>", "Whether the trigger is active on create.")
    .addHelpText("after", "\nA trigger is an unattended, scheduled agent run: on a cron cadence it runs the\nshipeasy-ops-work loop in --pr mode against your project — one atomic diff and\nONE pull request per fixed item, nothing auto-merges.\n\nWhatever the provider, the scheduled run executes this trigger prompt (headless\nCLIs take it as the prompt; cloud agents as the task body):\n\n  You are an unattended Shipeasy maintenance run. Authenticate every `shipeasy`\n  call with these env vars (the CLI reads them directly — do NOT run\n  `shipeasy login`, never echo the token). Put them at the top of EVERY shell\n  invocation that calls `shipeasy`; each command runs in a fresh shell:\n\n  export SHIPEASY_CLI_TOKEN=\"<OPS_KEY>\"\n  export SHIPEASY_PROJECT_ID=\"<PROJECT_ID>\"\n\n  Ensure the repo is bound: test -f .shipeasy || printf '{\"project_id\":\"<PROJECT_ID>\"}\\n' > .shipeasy\n  (never commit .shipeasy).\n\n  Refresh to the latest plugin + CLI, then run the ops work loop in --pr mode:\n    <PLUGIN-INSTALL-FOR-THIS-HOST>       # plugin install for claude/copilot, or `npx -y skills add …`\n    npm install -g @shipeasy/cli@latest\n  Then follow the installed shipeasy-ops-work (--pr) workflow verbatim: burn down\n  the queue, one atomic diff per item, open ONE PR per item from a safe branch\n  prefix, flip each to ready_for_qa, add \"Closes #<issue>\" where an item has a\n  connected GitHub issue. If the queue is empty, exit cleanly. Never merge.\n\n<OPS_KEY> is a restricted `ops` key — mint with\n`npx -y @shipeasy/cli@latest keys create --type ops`. It reads the queue, flips\nstatus, links the PR it opens, and creates resources only; it can never edit or\ndelete existing resources, and auto-extends its 7-day expiry on each run.\n<PROJECT_ID> comes from the bound .shipeasy. Never print either value.\n\nSafety: auto-approve flags (--approval-mode=yolo, --dangerously-skip-permissions,\n…) remove the human gate — run only in an isolated env. Unattended loops spend\ntokens/credits on a cadence: start weekly/daily and watch the first runs.\n\nThe reference implementation — a routine in Anthropic's cloud, no GitHub\nActions. The routines API is reachable only by the agent's in-process\nRemoteTrigger tool, so provisioning is a hybrid split:\n\n1. `shipeasy ops trigger prep --frequency <4h|6h|daily|weekdays|weekly|cron>`\n   mints the restricted ops key, resolves repo + cron, and writes the exact\n   RemoteTrigger create body to a 0600 temp file (the key is never printed).\n2. The agent picks an environment_id from its RemoteTrigger env list — the\n   environment's network access must allow shipeasy.ai + api.shipeasy.ai\n   (Custom network; new envs default to Trusted, which fails every shipeasy\n   call) — then calls RemoteTrigger {action:\"create\"} and captures trig_….\n   Verify with {action:\"run\"} (confirm first — it spends tokens and may open\n   a real PR).\n3. Register the connector (idempotent by routineId; tokenless is fine):\n\n     shipeasy ops trigger create claude --config '{\"routineId\":\"trig_…\"}'\n\nThe fire token (\"Fire now\" + event auto-fire) is web-UI-only: open\nhttps://claude.ai/code/routines → the routine → add an API trigger →\nGenerate token, then re-run the create with --token <token> and optionally\n--events '[\"bug.created\",\"feature_request.created\"]' — the same row is\nupgraded in place. GitHub access is connected once via /web-setup or the\nClaude GitHub App. Manage/pause the routine at claude.ai/code/routines.\n")
    .action(async (opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createTriggerConnector({ client, body: clean({ name: str(opts.name), events: json(opts.events), config: json(opts.config), token: str(opts.token), enabled: bool(opts.enabled), provider: "claude_trigger" }) }) });
    });
  g_ops_trigger_create.command("cursor")
    .description("Register a Cursor cloud-agent trigger (cold-fire; Shipeasy launches the run)")
    .option("--name <value>", "Human-readable connector label.")
    .option("--events <value>", "Events that auto-fire a cold cloud-agent run. Defaults to empty.")
    .option("--config <value>", "Non-secret config for a Cursor trigger.")
    .option("--api-key <value>", "Cursor API key that launches the run (secret). Encrypted into the credentials cipher; never returned.")
    .option("--ops-key <value>", "Restricted Shipeasy ops key, injected into the run as `SHIPEASY_CLI_TOKEN` via the launch envVars (secret). Encrypted; never returned.")
    .option("--enabled <value>", "Whether the trigger is active on create.")
    .addHelpText("after", "\nA trigger is an unattended, scheduled agent run: on a cron cadence it runs the\nshipeasy-ops-work loop in --pr mode against your project — one atomic diff and\nONE pull request per fixed item, nothing auto-merges.\n\nWhatever the provider, the scheduled run executes this trigger prompt (headless\nCLIs take it as the prompt; cloud agents as the task body):\n\n  You are an unattended Shipeasy maintenance run. Authenticate every `shipeasy`\n  call with these env vars (the CLI reads them directly — do NOT run\n  `shipeasy login`, never echo the token). Put them at the top of EVERY shell\n  invocation that calls `shipeasy`; each command runs in a fresh shell:\n\n  export SHIPEASY_CLI_TOKEN=\"<OPS_KEY>\"\n  export SHIPEASY_PROJECT_ID=\"<PROJECT_ID>\"\n\n  Ensure the repo is bound: test -f .shipeasy || printf '{\"project_id\":\"<PROJECT_ID>\"}\\n' > .shipeasy\n  (never commit .shipeasy).\n\n  Refresh to the latest plugin + CLI, then run the ops work loop in --pr mode:\n    <PLUGIN-INSTALL-FOR-THIS-HOST>       # plugin install for claude/copilot, or `npx -y skills add …`\n    npm install -g @shipeasy/cli@latest\n  Then follow the installed shipeasy-ops-work (--pr) workflow verbatim: burn down\n  the queue, one atomic diff per item, open ONE PR per item from a safe branch\n  prefix, flip each to ready_for_qa, add \"Closes #<issue>\" where an item has a\n  connected GitHub issue. If the queue is empty, exit cleanly. Never merge.\n\n<OPS_KEY> is a restricted `ops` key — mint with\n`npx -y @shipeasy/cli@latest keys create --type ops`. It reads the queue, flips\nstatus, links the PR it opens, and creates resources only; it can never edit or\ndelete existing resources, and auto-extends its 7-day expiry on each run.\n<PROJECT_ID> comes from the bound .shipeasy. Never print either value.\n\nSafety: auto-approve flags (--approval-mode=yolo, --dangerously-skip-permissions,\n…) remove the human gate — run only in an isolated env. Unattended loops spend\ntokens/credits on a cadence: start weekly/daily and watch the first runs.\n\nCursor cloud agents are cold-fireable: one authenticated POST to\nhttps://api.cursor.com/v1/agents starts a run from nothing, and\nautoCreatePR opens the PR via Cursor's GitHub App. Registering the\nconnector stores both credentials, so Shipeasy can fire it on demand and\non subscribed events; the ops key rides the launch envVars (never the\nprompt):\n\n  shipeasy ops trigger create cursor \\\n    --config '{\"repoUrl\":\"https://github.com/<owner>/<repo>\",\"projectId\":\"<prj_…>\"}' \\\n    --api-key <CURSOR_API_KEY> --ops-key <ops_…>\n\nFor a fixed cadence (nightly runs without new feedback) add a Cursor\nAutomation (cursor.com/automations) with the same trigger prompt — cron +\n\"Pull request creation\" enabled. Note: Automations always run in Max Mode\n(billed on cloud-agent usage).\n")
    .action(async (opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createTriggerConnector({ client, body: clean({ name: str(opts.name), events: json(opts.events), config: json(opts.config), apiKey: str(opts.apiKey), opsKey: str(opts.opsKey), enabled: bool(opts.enabled), provider: "cursor_trigger" }) }) });
    });
  g_ops_trigger_create.command("copilot")
    .description("Register a GitHub Copilot cloud-agent trigger")
    .option("--name <value>", "Human-readable connector label.")
    .option("--events <value>", "Events that auto-fire a Copilot agent task. Defaults to empty.")
    .option("--config <value>", "Non-secret config for a Copilot trigger.")
    .option("--token <value>", "Copilot-licensed user PAT (secret). The ops key lives in the repo's GitHub \"Agents\" secret store and is never sent through Shipeasy. Encrypted; never returned.")
    .option("--enabled <value>", "Whether the trigger is active on create.")
    .addHelpText("after", "\nA trigger is an unattended, scheduled agent run: on a cron cadence it runs the\nshipeasy-ops-work loop in --pr mode against your project — one atomic diff and\nONE pull request per fixed item, nothing auto-merges.\n\nWhatever the provider, the scheduled run executes this trigger prompt (headless\nCLIs take it as the prompt; cloud agents as the task body):\n\n  You are an unattended Shipeasy maintenance run. Authenticate every `shipeasy`\n  call with these env vars (the CLI reads them directly — do NOT run\n  `shipeasy login`, never echo the token). Put them at the top of EVERY shell\n  invocation that calls `shipeasy`; each command runs in a fresh shell:\n\n  export SHIPEASY_CLI_TOKEN=\"<OPS_KEY>\"\n  export SHIPEASY_PROJECT_ID=\"<PROJECT_ID>\"\n\n  Ensure the repo is bound: test -f .shipeasy || printf '{\"project_id\":\"<PROJECT_ID>\"}\\n' > .shipeasy\n  (never commit .shipeasy).\n\n  Refresh to the latest plugin + CLI, then run the ops work loop in --pr mode:\n    <PLUGIN-INSTALL-FOR-THIS-HOST>       # plugin install for claude/copilot, or `npx -y skills add …`\n    npm install -g @shipeasy/cli@latest\n  Then follow the installed shipeasy-ops-work (--pr) workflow verbatim: burn down\n  the queue, one atomic diff per item, open ONE PR per item from a safe branch\n  prefix, flip each to ready_for_qa, add \"Closes #<issue>\" where an item has a\n  connected GitHub issue. If the queue is empty, exit cleanly. Never merge.\n\n<OPS_KEY> is a restricted `ops` key — mint with\n`npx -y @shipeasy/cli@latest keys create --type ops`. It reads the queue, flips\nstatus, links the PR it opens, and creates resources only; it can never edit or\ndelete existing resources, and auto-extends its 7-day expiry on each run.\n<PROJECT_ID> comes from the bound .shipeasy. Never print either value.\n\nSafety: auto-approve flags (--approval-mode=yolo, --dangerously-skip-permissions,\n…) remove the human gate — run only in an isolated env. Unattended loops spend\ntokens/credits on a cadence: start weekly/daily and watch the first runs.\n\nCopilot's cloud agent starts from one authenticated POST to\nhttps://api.github.com/agents/repos/<owner>/<repo>/tasks with\n{ prompt, create_pull_request: true }. Auth is a user-to-server token\nONLY: a fine-grained user PAT with the \"Agent tasks\" repo permission\n(read+write) for a Copilot-licensed account — the Actions GITHUB_TOKEN and\nGitHub App installation tokens are rejected. The agent reads\nSHIPEASY_CLI_TOKEN from the repo's own Agents secret store, so Shipeasy\nstores only the PAT:\n\n  shipeasy ops trigger create copilot \\\n    --config '{\"owner\":\"<owner>\",\"repo\":\"<repo>\"}' --token <fine-grained PAT>\n\nSet SHIPEASY_CLI_TOKEN (the restricted ops key) + SHIPEASY_PROJECT_ID in\nthe repo's Agents secrets first. For a fixed cadence use Copilot\nautomations (repo Agents tab; hourly/daily/weekly, private/internal repos\nonly) or a scheduled Actions job running `gh agent-task create`.\n")
    .action(async (opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createTriggerConnector({ client, body: clean({ name: str(opts.name), events: json(opts.events), config: json(opts.config), token: str(opts.token), enabled: bool(opts.enabled), provider: "copilot_trigger" }) }) });
    });
  g_ops_trigger_create.command("jules")
    .description("Register a Google Jules (Gemini) trigger")
    .aliases(["gemini"])
    .option("--name <value>", "Human-readable connector label.")
    .option("--events <value>", "Events that auto-fire a Jules session. Defaults to empty.")
    .option("--config <value>", "Non-secret config for a Jules trigger.")
    .option("--api-key <value>", "Jules API key that launches the session (secret). Encrypted into the credentials cipher; never returned.")
    .option("--ops-key <value>", "Restricted Shipeasy ops key, embedded in the prompt (Jules exposes no env channel) (secret). Encrypted; never returned.")
    .option("--enabled <value>", "Whether the trigger is active on create.")
    .addHelpText("after", "\nA trigger is an unattended, scheduled agent run: on a cron cadence it runs the\nshipeasy-ops-work loop in --pr mode against your project — one atomic diff and\nONE pull request per fixed item, nothing auto-merges.\n\nWhatever the provider, the scheduled run executes this trigger prompt (headless\nCLIs take it as the prompt; cloud agents as the task body):\n\n  You are an unattended Shipeasy maintenance run. Authenticate every `shipeasy`\n  call with these env vars (the CLI reads them directly — do NOT run\n  `shipeasy login`, never echo the token). Put them at the top of EVERY shell\n  invocation that calls `shipeasy`; each command runs in a fresh shell:\n\n  export SHIPEASY_CLI_TOKEN=\"<OPS_KEY>\"\n  export SHIPEASY_PROJECT_ID=\"<PROJECT_ID>\"\n\n  Ensure the repo is bound: test -f .shipeasy || printf '{\"project_id\":\"<PROJECT_ID>\"}\\n' > .shipeasy\n  (never commit .shipeasy).\n\n  Refresh to the latest plugin + CLI, then run the ops work loop in --pr mode:\n    <PLUGIN-INSTALL-FOR-THIS-HOST>       # plugin install for claude/copilot, or `npx -y skills add …`\n    npm install -g @shipeasy/cli@latest\n  Then follow the installed shipeasy-ops-work (--pr) workflow verbatim: burn down\n  the queue, one atomic diff per item, open ONE PR per item from a safe branch\n  prefix, flip each to ready_for_qa, add \"Closes #<issue>\" where an item has a\n  connected GitHub issue. If the queue is empty, exit cleanly. Never merge.\n\n<OPS_KEY> is a restricted `ops` key — mint with\n`npx -y @shipeasy/cli@latest keys create --type ops`. It reads the queue, flips\nstatus, links the PR it opens, and creates resources only; it can never edit or\ndelete existing resources, and auto-extends its 7-day expiry on each run.\n<PROJECT_ID> comes from the bound .shipeasy. Never print either value.\n\nSafety: auto-approve flags (--approval-mode=yolo, --dangerously-skip-permissions,\n…) remove the human gate — run only in an isolated env. Unattended loops spend\ntokens/credits on a cadence: start weekly/daily and watch the first runs.\n\nJules — Google's async coding agent (the fireable Gemini path) — starts a\nsession from one POST to https://jules.googleapis.com/v1alpha/sessions\n(header X-Goog-Api-Key) with sourceContext.source =\nsources/github/<owner>/<repo> and automationMode: \"AUTO_CREATE_PR\". Jules\nexposes no env channel, so the restricted ops key is embedded in the\nsession prompt (safe — it is the limited ops key):\n\n  shipeasy ops trigger create jules \\\n    --config '{\"source\":\"sources/github/<owner>/<repo>\"}' \\\n    --api-key <JULES_API_KEY> --ops-key <ops_…>\n\nConnect the repo to Jules once (jules.google.com → connect GitHub). For a\nfixed cadence use Jules scheduled tasks (UI-only), or fall back to the\nGemini CLI in a GitHub Actions schedule: job\n(`gemini -p \"<TRIGGER PROMPT>\" --approval-mode=yolo`; auth GEMINI_API_KEY).\n")
    .action(async (opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createTriggerConnector({ client, body: clean({ name: str(opts.name), events: json(opts.events), config: json(opts.config), apiKey: str(opts.apiKey), opsKey: str(opts.opsKey), enabled: bool(opts.enabled), provider: "jules_trigger" }) }) });
    });
  g_release_configs.command("list")
    .description("List dynamic configs")
    .option("--limit <value>", "Page size (1–500). Defaults to 100.")
    .option("--cursor <value>", "Opaque cursor returned in the previous page's `next_cursor`. Omit for the first page.")
    .option("--q <value>", "Case-insensitive substring filter across the resource's human-readable text columns (e.g. `name`, `title`, `description`). OR-matched across those columns; omit to return everything.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listConfigs({ client, query: clean({ limit: num(opts.limit), cursor: str(opts.cursor), q: str(opts.q) }), body: json(opts.data) as never }) });
    });
  g_release_configs.command("create")
    .description("Create a dynamic config")
    .argument("<name>", "Stable config/killswitch key in `folder.name` form (two lowercase segments separated by a dot, e.g. `pricing.tiers`). Immutable after create.")
    .option("--description <value>", "Optional free-form description shown in the dashboard. Max 512 chars.")
    .option("--folder <value>", "Optional folder name grouping items in the dashboard. Alphanumeric, `_` or `-` (no `/`). Part of the SDK lookup key (`<folder>/<name>`).")
    .option("--schema <value>", "JSON Schema (draft 2020-12) describing the shape of the config value. Top-level `type` must be `'object'`; every published value is validated against this schema.")
    .option("--value <value>", "Initial config value. Either a single JSON object applied to every env, or a `{ env: value }` map seeding per-env values. Must match `schema`. Defaults to `{}` on every env when omitted.")
    .action(async (name, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createConfig({ client, body: clean({ name: name, description: str(opts.description), folder: str(opts.folder), schema: json(opts.schema), value: json(opts.value) }) }) });
    });
  g_release_configs.command("get")
    .description("Get one config")
    .argument("<id>", "Stable opaque config id (`cfg_…`) or the config's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.getConfig({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_release_configs.command("update")
    .description("Update a dynamic config")
    .argument("<id>", "Stable opaque config id (`cfg_…`) or the config's `name`.")
    .option("--schema <value>", "Replacement schema. When supplied, the new schema is validated against every published value before it lands.")
    .option("--value <value>", "Flat value applied to **every** env. Publishes a new version per env. To target one env, use `PUT /{id}/drafts` then `POST /{id}/publish`.")
    .option("--folder <value>", "Optional folder name grouping items in the dashboard. Alphanumeric, `_` or `-` (no `/`). Part of the SDK lookup key (`<folder>/<name>`).")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.updateConfig({ client, path: { id: id }, body: clean({ schema: json(opts.schema), value: json(opts.value), folder: str(opts.folder) }) }) });
    });
  g_release_configs.command("archive")
    .description("Delete a dynamic config")
    .argument("<id>", "Stable opaque config id (`cfg_…`) or the config's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.deleteConfig({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_release_configs.command("draft")
    .description("Save a draft value")
    .argument("<id>", "Stable opaque config id (`cfg_…`) or the config's `name`.")
    .option("--env <value>", "Target environment. One of the project's configured envs (`dev`, `staging`, `prod`).")
    .option("--value <value>", "Draft value to stage on `env`. Validated against the config's current schema.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.saveConfigDraft({ client, path: { id: id }, body: clean({ env: str(opts.env), value: json(opts.value) }) }) });
    });
  g_release_configs.command("discard-draft")
    .description("Discard a draft")
    .argument("<id>", "Stable opaque config id (`cfg_…`) or the config's `name`.")
    .option("--env <value>", "Target environment. One of the project's configured envs (`dev`, `staging`, `prod`).")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.discardConfigDraft({ client, path: { id: id }, body: clean({ env: str(opts.env) }) }) });
    });
  g_release_configs.command("publish")
    .description("Publish a draft")
    .argument("<id>", "Stable opaque config id (`cfg_…`) or the config's `name`.")
    .option("--env <value>", "Target environment. One of the project's configured envs (`dev`, `staging`, `prod`).")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.publishConfigDraft({ client, path: { id: id }, body: clean({ env: str(opts.env) }) }) });
    });
  g_release_configs.command("activity")
    .description("List config activity")
    .argument("<id>", "Stable opaque config id (`cfg_…`) or the config's `name`.")
    .option("--limit <value>", "Max rows to return (1–100). Defaults to 20.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listConfigActivity({ client, path: { id: id }, query: clean({ limit: num(opts.limit) }), body: json(opts.data) as never }) });
    });
  g_release_configs.command("update-schema")
    .description("Update a config schema")
    .argument("<id>", "Stable opaque config id (`cfg_…`) or the config's `name`.")
    .option("--schema <value>", "Replacement JSON Schema (draft 2020-12). Validated against every published value before it lands.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.updateConfigSchema({ client, path: { id: id }, body: clean({ schema: json(opts.schema) }) }) });
    });
  g_release_configs.command("versions")
    .description("List config version history")
    .argument("<id>", "Stable opaque config id (`cfg_…`) or the config's `name`.")
    .option("--env <value>", "Environment to list history for (`dev`, `staging`, or `prod`). Defaults to `prod` when omitted.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listConfigVersions({ client, path: { id: id }, query: clean({ env: str(opts.env) }), body: json(opts.data) as never }) });
    });
  g_release_experiments.command("list")
    .description("List experiments")
    .option("--limit <value>", "Page size (1–500). Defaults to 100.")
    .option("--cursor <value>", "Opaque cursor returned in the previous page's `next_cursor`. Omit for the first page.")
    .option("--status <value>", "Filter by lifecycle status. Pass `archived` to return the archive tab; any other value (or omitting it) returns the non-archived experiments.")
    .option("--q <value>", "Case-insensitive substring filter across the resource's human-readable text columns (e.g. `name`, `title`, `description`). OR-matched across those columns; omit to return everything.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listExperiments({ client, query: clean({ limit: num(opts.limit), cursor: str(opts.cursor), status: str(opts.status), q: str(opts.q) }), body: json(opts.data) as never }) });
    });
  g_release_experiments.command("create")
    .description("Create an experiment")
    .argument("<name>", "Stable experiment key. Single segment or `folder.name` (a-z, 0-9, `_`/`-`; max 128 chars). Used by SDKs as `Shipeasy.getExperiment(user, '<name>')`. Immutable after create.")
    .option("--description <value>", "Free-form description. Max 2000 chars, markdown rendered in the dashboard.")
    .option("--hypothesis <value>", "Hypothesis statement shown in the editor. Display-only.")
    .option("--tag <value>", "Short tag chip rendered next to the name. Display-only.")
    .option("--owner-email <value>", "Owner email. Display-only.")
    .option("--audience <value>", "Audience label shown in the editor. Display-only.")
    .option("--bucket-by <value>", "")
    .option("--folder <value>", "Optional folder name grouping items in the dashboard. Alphanumeric, `_` or `-` (no `/`). Part of the SDK lookup key (`<folder>/<name>`).")
    .option("--universe <value>", "Name of an existing universe in the project. Returns `422` if the universe doesn't exist.")
    .option("--targeting-gate <value>", "Optional gate name (a `targeting`-type flag). Only callers that pass the gate are enrolled in the experiment.")
    .option("--holdout-gate <value>", "Optional per-experiment holdout gate — the name of a `holdout`-type flag (public % + whitelist). A caller the flag passes is *held out* (never assigned, sees the universe defaults). Distinct from the universe-level holdout.")
    .option("--allocation-pct <value>", "Share of the (gated) audience allocated to the experiment, in basis points (0–10000 = 0%–100%). `0` = unallocated. Under pooled assignment this is the size of the universe-pool slice claimed. Use `allocation_percent` (0–100) below to think in percent. Immutable while the experiment is running.")
    .option("--allocation-percent <value>", "Allocation as a **percentage** (0–100, fractional ok). Friendlier alias for `allocation_pct`; converted to basis points server-side (e.g. `50` = 5000 bp). If both are set, `allocation_percent` wins.")
    .option("--reserved-headroom <value>", "Basis points of this experiment's split kept empty (0–10000) so a new variant can be appended into it while running without reshuffling. Group weights must sum to `10000 − reserved_headroom`. Defaults to the universe's `recommended_headroom` when omitted.")
    .option("--salt <value>", "Hash salt for bucketing. Auto-generated if omitted. Immutable while running.")
    .option("--params <value>", "**Deprecated** — the universe now owns the config schema (`param_schema`). Retained for back-compat; new experiments should leave this empty and declare params on the universe. Map of param-name → scalar type.")
    .option("--groups <value>", "Two or more variants. Weights must sum to `10000 − reserved_headroom`. Existing weights are immutable while running, but a new variant may be appended into the reserved tail.")
    .option("--significance-threshold <value>", "p-value cutoff used by the analysis pass. Defaults to `0.05`. Values other than 0.05 require Pro plan or higher.")
    .option("--min-runtime-days <value>", "Minimum days the experiment must run before results are considered conclusive.")
    .option("--min-sample-size <value>", "Minimum exposures per group before results are considered conclusive.")
    .option("--sequential-testing <value>", "Enable sequential testing (always-valid p-values). Requires Premium plan or higher.")
    .option("--goal-metric <value>", "Inline metric — a DSL `query`, or an `event` (+ `aggregation`/`value`) the server compiles into one.")
    .option("--guardrail-metrics <value>", "Up to 10 guardrail metrics defined inline. Each is upserted (event + metric) and attached with role=guardrail.")
    .action(async (name, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createExperiment({ client, body: clean({ name: name, description: str(opts.description), hypothesis: str(opts.hypothesis), tag: str(opts.tag), owner_email: str(opts.ownerEmail), audience: str(opts.audience), bucket_by: str(opts.bucketBy), folder: str(opts.folder), universe: str(opts.universe), targeting_gate: str(opts.targetingGate), holdout_gate: str(opts.holdoutGate), allocation_pct: num(opts.allocationPct), allocation_percent: num(opts.allocationPercent), reserved_headroom: num(opts.reservedHeadroom), salt: str(opts.salt), params: json(opts.params), groups: json(opts.groups), significance_threshold: num(opts.significanceThreshold), min_runtime_days: num(opts.minRuntimeDays), min_sample_size: num(opts.minSampleSize), sequential_testing: bool(opts.sequentialTesting), goal_metric: json(opts.goalMetric), guardrail_metrics: json(opts.guardrailMetrics) }) }) });
    });
  g_release_experiments.command("get")
    .description("Get one experiment")
    .argument("<id>", "Stable opaque experiment id (`exp_…`) or the experiment's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.getExperiment({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_release_experiments.command("update")
    .description("Update an experiment")
    .argument("<id>", "Stable opaque experiment id (`exp_…`) or the experiment's `name`.")
    .option("--name <value>", "Stable experiment key. Single segment or `folder.name` (a-z, 0-9, `_`/`-`; max 128 chars). Used by SDKs as `Shipeasy.getExperiment(user, '<name>')`. Immutable after create.")
    .option("--description <value>", "")
    .option("--hypothesis <value>", "")
    .option("--tag <value>", "")
    .option("--owner-email <value>", "")
    .option("--audience <value>", "")
    .option("--bucket-by <value>", "")
    .option("--folder <value>", "Optional folder name grouping items in the dashboard. Alphanumeric, `_` or `-` (no `/`). Part of the SDK lookup key (`<folder>/<name>`).")
    .option("--targeting-gate <value>", "")
    .option("--holdout-gate <value>", "Per-experiment holdout gate — the name of a `holdout`-type flag, or `null` to clear. A caller the flag passes is held out.")
    .option("--allocation-pct <value>", "Basis-points allocation (0–10000). Use `allocation_percent` (0–100) for percent. Immutable while the experiment is running.")
    .option("--reserved-headroom <value>", "Basis points of the split kept empty for appended variants. Group weights must sum to `10000 − reserved_headroom`. May be shrunk (never grown into existing weights) while running when appending a variant.")
    .option("--allocation-percent <value>", "Allocation as a **percentage** (0–100). Friendlier alias for `allocation_pct`; converted to basis points server-side. Wins over `allocation_pct` if both are supplied. Immutable while running.")
    .option("--salt <value>", "Hash salt. Immutable while running.")
    .option("--universe <value>", "New universe name. Immutable while running. Returns `422` if the universe doesn't exist.")
    .option("--params <value>", "**Deprecated** — the universe owns the config schema (`param_schema`). Retained for back-compat. Map of param-name → scalar type.")
    .option("--groups <value>", "Replacement groups. Weights must sum to `10000 − reserved_headroom`. Existing weights/values are immutable while running; a new variant may be appended into the reserved tail.")
    .option("--significance-threshold <value>", "")
    .option("--min-runtime-days <value>", "")
    .option("--min-sample-size <value>", "")
    .option("--sequential-testing <value>", "")
    .option("--goal-metric <value>", "Inline metric — a DSL `query`, or an `event` (+ `aggregation`/`value`) the server compiles into one.")
    .option("--guardrail-metrics <value>", "Replaces the guardrail set wholesale (event auto-upserted per entry).")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.updateExperiment({ client, path: { id: id }, body: clean({ name: str(opts.name), description: str(opts.description), hypothesis: str(opts.hypothesis), tag: str(opts.tag), owner_email: str(opts.ownerEmail), audience: str(opts.audience), bucket_by: str(opts.bucketBy), folder: str(opts.folder), targeting_gate: str(opts.targetingGate), holdout_gate: str(opts.holdoutGate), allocation_pct: num(opts.allocationPct), reserved_headroom: num(opts.reservedHeadroom), allocation_percent: num(opts.allocationPercent), salt: str(opts.salt), universe: str(opts.universe), params: json(opts.params), groups: json(opts.groups), significance_threshold: num(opts.significanceThreshold), min_runtime_days: num(opts.minRuntimeDays), min_sample_size: num(opts.minSampleSize), sequential_testing: bool(opts.sequentialTesting), goal_metric: json(opts.goalMetric), guardrail_metrics: json(opts.guardrailMetrics) }) }) });
    });
  g_release_experiments.command("archive")
    .description("Delete an experiment")
    .argument("<id>", "Stable opaque experiment id (`exp_…`) or the experiment's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.deleteExperiment({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_release_experiments.command("start")
    .description("Start an experiment (draft → running)")
    .argument("<id>", "Stable opaque experiment id (`exp_…`) or the experiment's `name`.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.setExperimentStatus({ client, path: { id: id }, body: clean({ status: "running" }) }) });
    });
  g_release_experiments.command("stop")
    .description("Stop a running experiment")
    .argument("<id>", "Stable opaque experiment id (`exp_…`) or the experiment's `name`.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.setExperimentStatus({ client, path: { id: id }, body: clean({ status: "stopped" }) }) });
    });
  g_release_experiments.command("restore")
    .description("Restore an archived experiment (→ draft)")
    .argument("<id>", "Stable opaque experiment id (`exp_…`) or the experiment's `name`.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.setExperimentStatus({ client, path: { id: id }, body: clean({ status: "draft" }) }) });
    });
  g_release_experiments.command("set-metrics")
    .description("Attach metrics")
    .argument("<id>", "Stable opaque experiment id (`exp_…`) or the experiment's `name`.")
    .option("--metrics <value>", "Replacement metrics list — replaces the current attachments wholesale.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.setExperimentMetrics({ client, path: { id: id }, body: clean({ metrics: json(opts.metrics) }) }) });
    });
  g_release_experiments.command("results")
    .description("Get analysis results")
    .argument("<id>", "Stable opaque experiment id (`exp_…`) or the experiment's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.getExperimentResults({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_release_experiments.command("timeseries")
    .description("Get analysis timeseries")
    .argument("<id>", "Stable opaque experiment id (`exp_…`) or the experiment's `name`.")
    .option("--metric <value>", "Optional metric name to filter the series.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.getExperimentTimeseries({ client, path: { id: id }, query: clean({ metric: str(opts.metric) }), body: json(opts.data) as never }) });
    });
  g_release_experiments.command("reanalyze")
    .description("Re-queue analysis")
    .argument("<id>", "Stable opaque experiment id (`exp_…`) or the experiment's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.reanalyzeExperiment({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_release_experiments.command("readout-create")
    .description("Mint a readout snapshot")
    .argument("<id>", "Stable opaque experiment id (`exp_…`) or the experiment's `name`.")
    .option("--kind <value>", "Why the snapshot is being minted — `manual` (\"Share readout\"), or automatically on `ship` / `stop`.")
    .option("--acknowledged-caveat-ids <value>", "Ids of the open caveats the caller ticked (decision-gating acknowledgment). Unlisted caveats are stored as unacknowledged.")
    .option("--require-all-acknowledged <value>", "When `true`, refuse (`422`) to mint while any open caveat is not listed in `acknowledgedCaveatIds` — server-side ship gating.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createExperimentReadout({ client, path: { id: id }, body: clean({ kind: str(opts.kind), acknowledgedCaveatIds: json(opts.acknowledgedCaveatIds), requireAllAcknowledged: bool(opts.requireAllAcknowledged) }) }) });
    });
  g_release_experiments.command("readout-get")
    .description("Get a readout snapshot")
    .argument("<id>", "Stable opaque experiment id (`exp_…`) or the experiment's `name`.")
    .argument("<readoutId>", "Readout snapshot id, as returned by `createExperimentReadout`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, readoutId, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.getExperimentReadout({ client, path: { id: id, readoutId: readoutId }, body: json(opts.data) as never }) });
    });
  g_release_flags.command("list")
    .description("List feature gates")
    .option("--limit <value>", "Page size (1–500). Defaults to 100.")
    .option("--cursor <value>", "Opaque cursor returned in the previous page's `next_cursor`. Omit for the first page.")
    .option("--q <value>", "Case-insensitive substring filter across the resource's human-readable text columns (e.g. `name`, `title`, `description`). OR-matched across those columns; omit to return everything.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listGates({ client, query: clean({ limit: num(opts.limit), cursor: str(opts.cursor), q: str(opts.q) }), body: json(opts.data) as never }) });
    });
  g_release_flags.command("create")
    .description("Create a feature gate")
    .argument("<name>", "Stable gate key used by SDKs (`Shipeasy.checkGate(user, '<name>')`). Single segment or `folder.name`. Lowercase letters, digits, `_` or `-`; max 128 chars. Immutable after create — rename = delete + recreate.")
    .option("--type <value>", "Gate kind. `targeting` (default) is a normal flag with the full builder. `holdout` is a **restricted** flag — only a public rollout % and a whitelist are allowed; attribute rules and a gatekeeper stack are rejected. Used as an experiment's `holdout_gate`.")
    .option("--enabled <value>", "Master switch. Defaults to `true`. Set `false` to create the gate disabled (evaluates to `false` regardless of rules/rollout); flip on via `POST /{id}/enable` or PATCH.")
    .option("--rollout-pct <value>", "Initial rollout in **basis points** (0–10000 = 0%–100%) — `100` here means **1%**, not 100%. Use `rollout_percent` (0–100) below if you'd rather think in percent. Use `0` to create the gate dark and ramp via PATCH after deploy validation.")
    .option("--rollout-percent <value>", "Initial rollout as a **percentage** (0–100, fractional ok). Friendlier alias for `rollout_pct`; converted internally to basis points (e.g. `100` here = 10000 bp = 100%). If both `rollout_pct` and `rollout_percent` are set, `rollout_percent` wins.")
    .option("--rules <value>", "Targeting predicates. AND-combined. If non-empty, the gate returns `true` only for callers that satisfy every rule **and** fall under `rollout_pct`.")
    .option("--salt <value>", "Hash salt for percentage bucketing. Auto-generated if omitted. Provide explicitly to keep a gate's buckets stable across delete/recreate. **Immutable after create** — there is no PATCH for `salt` because changing it would re-bucket every caller.")
    .option("--stack <value>", "Optional gatekeeper stack. When provided, takes precedence over `rules` + `rollout_pct` at evaluation time. Omit (or pass `null`) for a flat gate.")
    .option("--title <value>", "Human-readable title shown in the dashboard. Free-form, no key format constraint.")
    .option("--description <value>", "Long-form description / runbook. Markdown is rendered in the dashboard.")
    .option("--folder <value>", "Optional folder name grouping items in the dashboard. Alphanumeric, `_` or `-` (no `/`). Part of the SDK lookup key (`<folder>/<name>`).")
    .option("--group <value>", "Group label for dashboard organisation (e.g. team or product area).")
    .option("--owner-email <value>", "Owner contact. Displayed verbatim; not used for auth.")
    .action(async (name, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createGate({ client, body: clean({ name: name, type: str(opts.type), enabled: bool(opts.enabled), rollout_pct: num(opts.rolloutPct), rollout_percent: num(opts.rolloutPercent), rules: json(opts.rules), salt: str(opts.salt), stack: json(opts.stack), title: str(opts.title), description: str(opts.description), folder: str(opts.folder), group: str(opts.group), owner_email: str(opts.ownerEmail) }) }) });
    });
  g_release_flags.command("get")
    .description("Get one gate")
    .argument("<id>", "Stable opaque gate id (`gat_…`) or the gate's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.getGate({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_release_flags.command("update")
    .description("Update a feature gate")
    .argument("<id>", "Stable opaque gate id (`gat_…`) or the gate's `name`.")
    .option("--type <value>", "Gate kind. Switching to `holdout` requires the gate carry only a public rollout % + whitelist (attribute rules / stack are rejected).")
    .option("--rollout-pct <value>", "New rollout in **basis points** (0–10000 = 0%–100%) — `100` here means **1%**. Use `rollout_percent` (0–100) below for percent. Omit both to leave unchanged.")
    .option("--rollout-percent <value>", "New rollout as a **percentage** (0–100). Friendlier alias for `rollout_pct`; converted internally. Wins over `rollout_pct` if both are supplied. Omit both to leave unchanged.")
    .option("--rules <value>", "Replaces the rule list wholesale. To add a value to an `in` rule, send the full new `rules` array with the augmented `value` (e.g. previous `['US','CA']` → `['US','CA','GB']`).")
    .option("--enabled <value>", "Master switch. `false` makes the gate evaluate to `false` for every caller regardless of `rollout_pct`, `rules`, or `stack` — use as kill switch.")
    .option("--stack <value>", "Replaces the gatekeeper stack wholesale. Send `null` to revert to flat `rules` + `rollout_pct` evaluation.")
    .option("--title <value>", "Human-readable title shown in the dashboard. Free-form, no key format constraint.")
    .option("--description <value>", "Long-form description / runbook. Markdown is rendered in the dashboard.")
    .option("--folder <value>", "Optional folder name grouping items in the dashboard. Alphanumeric, `_` or `-` (no `/`). Part of the SDK lookup key (`<folder>/<name>`).")
    .option("--group <value>", "Group label for dashboard organisation (e.g. team or product area).")
    .option("--owner-email <value>", "Owner contact. Displayed verbatim; not used for auth.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.updateGate({ client, path: { id: id }, body: clean({ type: str(opts.type), rollout_pct: num(opts.rolloutPct), rollout_percent: num(opts.rolloutPercent), rules: json(opts.rules), enabled: bool(opts.enabled), stack: json(opts.stack), title: str(opts.title), description: str(opts.description), folder: str(opts.folder), group: str(opts.group), owner_email: str(opts.ownerEmail) }) }) });
    });
  g_release_flags.command("archive")
    .description("Delete a feature gate")
    .argument("<id>", "Stable opaque gate id (`gat_…`) or the gate's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.deleteGate({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_release_flags.command("enable")
    .description("Enable a gate")
    .argument("<id>", "Stable opaque gate id (`gat_…`) or the gate's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.enableGate({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_release_flags.command("disable")
    .description("Disable a gate")
    .argument("<id>", "Stable opaque gate id (`gat_…`) or the gate's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.disableGate({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_release_flags.command("activity")
    .description("List gate activity")
    .argument("<id>", "Stable opaque gate id (`gat_…`) or the gate's `name`.")
    .option("--limit <value>", "Max rows to return (1–100). Defaults to 20.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listGateActivity({ client, path: { id: id }, query: clean({ limit: num(opts.limit) }), body: json(opts.data) as never }) });
    });
  g_release_killswitch.command("list")
    .description("List killswitches")
    .option("--limit <value>", "Page size (1–500). Defaults to 100.")
    .option("--cursor <value>", "Opaque cursor returned in the previous page's `next_cursor`. Omit for the first page.")
    .option("--q <value>", "Case-insensitive substring filter across the resource's human-readable text columns (e.g. `name`, `title`, `description`). OR-matched across those columns; omit to return everything.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listKillswitches({ client, query: clean({ limit: num(opts.limit), cursor: str(opts.cursor), q: str(opts.q) }), body: json(opts.data) as never }) });
    });
  g_release_killswitch.command("create")
    .description("Create a killswitch")
    .argument("<name>", "Stable config/killswitch key in `folder.name` form (two lowercase segments separated by a dot, e.g. `pricing.tiers`). Immutable after create.")
    .option("--description <value>", "Optional free-form description shown in the dashboard. Max 512 chars.")
    .option("--folder <value>", "Optional folder name grouping items in the dashboard. Alphanumeric, `_` or `-` (no `/`). Part of the SDK lookup key (`<folder>/<name>`).")
    .option("--value <value>", "Default value applied to every env at creation. Defaults to `false`. Use `true` to ship the killswitch pre-tripped.")
    .option("--switches <value>", "Initial per-switch overrides applied to every env. Empty/omitted leaves the killswitch with only the flat `value`.")
    .action(async (name, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createKillswitch({ client, body: clean({ name: name, description: str(opts.description), folder: str(opts.folder), value: bool(opts.value), switches: json(opts.switches) }) }) });
    });
  g_release_killswitch.command("get")
    .description("Get one killswitch")
    .argument("<id>", "Stable opaque killswitch id (`ksw_…`) or the killswitch's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.getKillswitch({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_release_killswitch.command("update")
    .description("Update a killswitch")
    .argument("<id>", "Stable opaque killswitch id (`ksw_…`) or the killswitch's `name`.")
    .option("--description <value>", "New description, or `null` to clear it. Max 512 chars.")
    .option("--folder <value>", "Optional folder name grouping items in the dashboard. Alphanumeric, `_` or `-` (no `/`). Part of the SDK lookup key (`<folder>/<name>`).")
    .option("--value <value>", "Flat value applied to every env. Publishes a new version per env when set. Omit to leave values unchanged.")
    .option("--switches <value>", "Replace the switches map wholesale on every env. To edit a single entry on a single env use `PUT /{id}/switch` instead.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.updateKillswitch({ client, path: { id: id }, body: clean({ description: str(opts.description), folder: str(opts.folder), value: bool(opts.value), switches: json(opts.switches) }) }) });
    });
  g_release_killswitch.command("archive")
    .description("Delete a killswitch")
    .argument("<id>", "Stable opaque killswitch id (`ksw_…`) or the killswitch's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.deleteKillswitch({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_release_killswitch.command("set")
    .description("Set one switch entry")
    .argument("<id>", "Stable opaque killswitch id (`ksw_…`) or the killswitch's `name`.")
    .option("--env <value>", "Target environment. One of the project's configured envs (`dev`, `staging`, `prod`).")
    .option("--switch-key <value>", "Switch key to set.")
    .option("--value <value>", "New boolean value for this `switchKey` on this `env`.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.setKillswitchSwitch({ client, path: { id: id }, body: clean({ env: str(opts.env), switchKey: str(opts.switchKey), value: bool(opts.value) }) }) });
    });
  g_release_killswitch.command("unset")
    .description("Remove one switch entry")
    .argument("<id>", "Stable opaque killswitch id (`ksw_…`) or the killswitch's `name`.")
    .option("--env <value>", "Target environment. One of the project's configured envs (`dev`, `staging`, `prod`).")
    .option("--switch-key <value>", "Switch key to remove.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.unsetKillswitchSwitch({ client, path: { id: id }, body: clean({ env: str(opts.env), switchKey: str(opts.switchKey) }) }) });
    });
  g_release_killswitch.command("set-value")
    .description("Set the flat value on one env")
    .argument("<id>", "Stable opaque killswitch id (`ksw_…`) or the killswitch's `name`.")
    .option("--env <value>", "Target environment. One of the project's configured envs (`dev`, `staging`, `prod`).")
    .option("--value <value>", "Flat boolean to publish on `env`. Publishes a new version on that env only.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.setKillswitchValue({ client, path: { id: id }, body: clean({ env: str(opts.env), value: bool(opts.value) }) }) });
    });
  g_release_experiments_universes.command("list")
    .description("List universes")
    .option("--limit <value>", "Page size (1–500). Defaults to 100.")
    .option("--cursor <value>", "Opaque cursor returned in the previous page's `next_cursor`. Omit for the first page.")
    .option("--q <value>", "Case-insensitive substring filter across the resource's human-readable text columns (e.g. `name`, `title`, `description`). OR-matched across those columns; omit to return everything.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listUniverses({ client, query: clean({ limit: num(opts.limit), cursor: str(opts.cursor), q: str(opts.q) }), body: json(opts.data) as never }) });
    });
  g_release_experiments_universes.command("create")
    .description("Create a universe")
    .argument("<name>", "Stable universe key. Single segment or `folder.name`. Lowercase letters, digits, `_` or `-`; max 128 chars. Immutable after create.")
    .option("--folder <value>", "Optional folder name grouping items in the dashboard. Alphanumeric, `_` or `-` (no `/`). Part of the SDK lookup key (`<folder>/<name>`).")
    .option("--description <value>", "Human-readable blurb shown in the universe picker/hovercard.")
    .option("--unit-type <value>", "Unit of randomisation. Typically `user_id`. Use `account_id` to keep whole accounts in the same group across an experiment.")
    .option("--holdout-range <value>", "Inclusive `[lo, hi]` bucket range (0–9999) reserved as the **holdout** — callers hashed into this slice are excluded from every experiment in the universe. `null` disables the holdout. Pro plan or higher required.")
    .option("--recommended-headroom <value>", "Basis points of reserved headroom seeded into each new experiment created in this universe (0 = none). Lets variants be appended into a running experiment without reshuffling.")
    .option("--param-schema <value>", "The universe-owned config schema — an ordered `{ name, type, default }[]`. Experiments may only override values per variant, never add fields. `null` starts an empty schema.")
    .action(async (name, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createUniverse({ client, body: clean({ name: name, folder: str(opts.folder), description: str(opts.description), unit_type: str(opts.unitType), holdout_range: json(opts.holdoutRange), recommended_headroom: num(opts.recommendedHeadroom), param_schema: json(opts.paramSchema) }) }) });
    });
  g_release_experiments_universes.command("update")
    .description("Update a universe")
    .argument("<id>", "Stable opaque universe id (`uni_…`) or the universe's `name`.")
    .option("--folder <value>", "Optional folder name grouping items in the dashboard. Alphanumeric, `_` or `-` (no `/`). Part of the SDK lookup key (`<folder>/<name>`).")
    .option("--description <value>", "Human-readable blurb shown in the universe picker/hovercard.")
    .option("--holdout-range <value>", "Inclusive `[lo, hi]` bucket range (0–9999) reserved as the **holdout** — callers hashed into this slice are excluded from every experiment in the universe. `null` disables the holdout. Pro plan or higher required.")
    .option("--recommended-headroom <value>", "Basis points of reserved headroom seeded into new experiments in this universe.")
    .option("--param-schema <value>", "Replace the universe config schema. Additive changes + default edits are always allowed; removing a param a running experiment overrides is rejected (deprecate-only).")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.updateUniverse({ client, path: { id: id }, body: clean({ folder: str(opts.folder), description: str(opts.description), holdout_range: json(opts.holdoutRange), recommended_headroom: num(opts.recommendedHeadroom), param_schema: json(opts.paramSchema) }) }) });
    });
  g_release_experiments_universes.command("archive")
    .description("Delete a universe")
    .argument("<id>", "Stable opaque universe id (`uni_…`) or the universe's `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.deleteUniverse({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_release_flags_attributes.command("list")
    .description("List targeting attributes")
    .option("--q <value>", "Case-insensitive substring filter across the resource's human-readable text columns (e.g. `name`, `title`, `description`). OR-matched across those columns; omit to return everything.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listAttributes({ client, query: clean({ q: str(opts.q) }), body: json(opts.data) as never }) });
    });
  g_release_flags_attributes.command("create")
    .description("Declare a targeting attribute")
    .argument("<name>", "Attribute key (lowercase alphanumeric start, then letters/digits/`_`/`-`; max 64 chars). Immutable after create.")
    .option("--type <value>", "Declared value type of a targeting attribute.")
    .option("--enum-values <value>", "Allowed values when `type` is `enum` (required in that case — 422 otherwise); `null` for non-enum types.")
    .option("--required <value>", "Whether the attribute must be present on the evaluation context.")
    .option("--description <value>", "Optional human note shown in the dashboard.")
    .option("--sdk-path <value>", "Optional dotted path the SDK reads the value from.")
    .action(async (name, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createAttribute({ client, body: clean({ name: name, type: str(opts.type), enum_values: json(opts.enumValues), required: bool(opts.required), description: str(opts.description), sdk_path: str(opts.sdkPath) }) }) });
    });
  g_release_flags_attributes.command("get")
    .description("Get a targeting attribute")
    .argument("<id>", "The attribute id.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.getAttribute({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_release_flags_attributes.command("update")
    .description("Update a targeting attribute")
    .argument("<id>", "The attribute id.")
    .option("--type <value>", "Declared value type of a targeting attribute.")
    .option("--enum-values <value>", "Replacement allowed values (for `enum`), or `null` to clear.")
    .option("--required <value>", "Whether the attribute must be present on the evaluation context.")
    .option("--description <value>", "Optional human note shown in the dashboard.")
    .option("--sdk-path <value>", "Optional dotted path the SDK reads the value from.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.updateAttribute({ client, path: { id: id }, body: clean({ type: str(opts.type), enum_values: json(opts.enumValues), required: bool(opts.required), description: str(opts.description), sdk_path: str(opts.sdkPath) }) }) });
    });
  g_release_flags_attributes.command("archive")
    .description("Archive a targeting attribute")
    .argument("<id>", "The attribute id.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.deleteAttribute({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_release_flags_templates.command("list")
    .description("List gate templates")
    .option("--q <value>", "Case-insensitive substring filter across the resource's human-readable text columns (e.g. `name`, `title`, `description`). OR-matched across those columns; omit to return everything.")
    .option("--query <value>", "Deprecated alias for `q`, kept working for one release. Prefer `q`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.listGateTemplates({ client, query: clean({ q: str(opts.q), query: str(opts.query) }), body: json(opts.data) as never }) });
    });
  g_release_flags_templates.command("create")
    .description("Create a gate template")
    .argument("<name>", "Human label. Unique per project.")
    .option("--description <value>", "One-liner shown in pickers and matched by the list `query` filter.")
    .option("--category <value>", "")
    .option("--icon-key <value>", "Display-only icon hint.")
    .option("--auto <value>", "Mark the attribute as request-derived (resolved at the SDK edge).")
    .option("--rules <value>", "The rule definition captured by the template.")
    .action(async (name, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.createGateTemplate({ client, body: clean({ name: name, description: str(opts.description), category: str(opts.category), icon_key: str(opts.iconKey), auto: bool(opts.auto), rules: json(opts.rules) }) }) });
    });
  g_release_flags_templates.command("get")
    .description("Get one gate template")
    .argument("<id>", "Built-in slug (`country`) or customer template id (`gtpl_…`).")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: false, invoke: (client) => api.getGateTemplate({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
  g_release_flags_templates.command("update")
    .description("Update a gate template")
    .argument("<id>", "Customer template id (`gtpl_…`) or its `name`.")
    .option("--name <value>", "")
    .option("--description <value>", "")
    .option("--category <value>", "")
    .option("--icon-key <value>", "")
    .option("--auto <value>", "")
    .option("--rules <value>", "")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.updateGateTemplate({ client, path: { id: id }, body: clean({ name: str(opts.name), description: str(opts.description), category: str(opts.category), icon_key: str(opts.iconKey), auto: bool(opts.auto), rules: json(opts.rules) }) }) });
    });
  g_release_flags_templates.command("archive")
    .description("Delete a gate template")
    .argument("<id>", "Customer template id (`gtpl_…`) or its `name`.")
    .option("--data <value>", "Request body as a JSON object.")
    .action(async (id, opts) => {
      await ctx.run({ mutates: true, invoke: (client) => api.deleteGateTemplate({ client, path: { id: id }, body: json(opts.data) as never }) });
    });
}
