import type { Tool } from "@modelcontextprotocol/sdk/types.js";

/**
 * Tool catalog for @shipeasy/mcp.
 *
 * Full plan + input/output shapes: packages/mcp/README.md § "Tool catalog".
 *
 * Every handler currently returns NOT_IMPLEMENTED (see src/index.ts). This
 * schema file is the source of truth; implement handlers in src/tools/** and
 * wire them into the switch in src/index.ts.
 */
export const TOOLS: Tool[] = [
  // ────────────────────────────── shared ──────────────────────────────
  {
    name: "detect_project",
    description:
      "Inspect the working directory and return language, framework, package manager, shipeasy SDK install state (experimentation + i18n), and loader-script presence.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Single directory to analyze. Defaults to cwd.",
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Multiple directories to analyze in one call. Takes precedence over path.",
        },
      },
    },
  },
  {
    name: "projects_upsert",
    description:
      "Find-or-create a Shipeasy project by domain (idempotent) and bind the cwd to it via .shipeasy. Use this on fresh installs BEFORE any other write tool — every other write tool refuses to run until .shipeasy exists. Re-running with the same domain returns the existing project unchanged.",
    inputSchema: {
      type: "object",
      required: ["domain"],
      properties: {
        domain: {
          type: "string",
          description:
            "Hostname-like identifier for the project (e.g. shouks.app, acme.com). Primary key for upsert.",
        },
        name: {
          type: "string",
          description:
            "Human-readable project name. Defaults to the domain on first create; ignored on later upserts.",
        },
        path: {
          type: "string",
          description: "Directory to write .shipeasy in. Defaults to the MCP server's cwd.",
        },
        bind: {
          type: "boolean",
          description: "Write .shipeasy after upsert. Default true. Set false to skip binding.",
        },
      },
    },
  },
  {
    name: "auth_check",
    description:
      "Report whether ~/.config/shipeasy/config.json holds a valid CLI token. Returns { authenticated, project_id, base_url, user_email }.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "auth_login",
    description:
      "Launch the PKCE device-auth flow via `shipeasy login`. Opens a browser; blocks up to 5 minutes. Caller should render a 'waiting for browser…' spinner.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "auth_logout",
    description: "Delete ~/.config/shipeasy/config.json. No network call.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_resources",
    description:
      "Unified listing across gates, configs, experiments, events, metrics, alert_rules, universes, attributes, i18n profiles/chunks/keys/drafts, and sdk_keys.",
    inputSchema: {
      type: "object",
      required: ["kind"],
      properties: {
        kind: {
          type: "string",
          enum: [
            "gates",
            "configs",
            "experiments",
            "events",
            "metrics",
            "alert_rules",
            "universes",
            "attributes",
            "profiles",
            "chunks",
            "keys",
            "drafts",
            "sdk_keys",
            "all",
          ],
        },
        limit: { type: "number" },
        search: { type: "string" },
      },
    },
  },
  {
    name: "get_resource",
    description: "Fetch a single resource by kind + name_or_id. Same routing as list_resources.",
    inputSchema: {
      type: "object",
      required: ["kind", "name_or_id"],
      properties: {
        kind: { type: "string" },
        name_or_id: { type: "string" },
      },
    },
  },
  {
    name: "get_sdk_snippet",
    description:
      "Return ready-to-paste install / env-vars / init / usage / tracking code for the detected language + framework, for either subsystem.",
    inputSchema: {
      type: "object",
      required: ["domain", "language", "type", "name"],
      properties: {
        domain: { type: "string", enum: ["experiment", "i18n"] },
        language: {
          type: "string",
          enum: [
            "typescript",
            "javascript",
            "python",
            "ruby",
            "go",
            "java",
            "php",
            "swift",
            "kotlin",
          ],
        },
        framework: { type: "string" },
        type: {
          type: "string",
          enum: [
            "gate",
            "experiment",
            "config",
            "label_load",
            "label_render",
            "loader_script",
            "provider_setup",
          ],
        },
        name: { type: "string" },
        params: { type: "object" },
        success_event: { type: "string" },
        success_value: { type: "boolean" },
      },
    },
  },

  // ────────────────────────── experimentation ──────────────────────────
  {
    name: "exp_create_gate",
    description:
      "Create a feature gate. A flat gate is `rules` + a single `rollout` %. For tiered " +
      "rollouts (e.g. 'US @ 50% → bots @ 30% → everyone else @ 10%') pass `stack` — an ordered " +
      "list of steps evaluated first-match-wins; flat `rules`/`rollout` are then ignored.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", description: "Snake_case; auto-slugged." },
        description: { type: "string" },
        rollout: { type: "number", description: "Flat-gate rollout, 0–100." },
        rules: { type: "string", description: "Flat-gate JSON rules array." },
        stack: {
          type: "string",
          description:
            "Optional gatekeeper stack — a JSON array of ordered steps, evaluated top-to-bottom, " +
            "first match wins; takes precedence over flat rules/rollout. Each step is either a " +
            'condition: { "id": "<stable-id>", "type": "condition", "rules": [{attr,op,value}], ' +
            '"rolloutPct": <0-10000 basis points> } — rules match then bucket at rolloutPct (omit ⇒ ' +
            '100%); or a rollout: { "id": "<id>", "type": "rollout", "rolloutPct": <0-10000 bp> }. ' +
            'End with a catch-all rollout step (no rules) to decide everyone who fell through. ' +
            "rolloutPct is BASIS POINTS: 5000 = 50%, 1000 = 10%, 100 = 1%.",
        },
      },
    },
  },
  {
    name: "exp_update_gate",
    description:
      "Update a feature gate's rollout, rules, gatekeeper stack, or enabled flag. Pass `stack` " +
      "to replace the tiered rollout wholesale (same shape as exp_create_gate).",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        rollout: { type: "number", description: "0–100" },
        rules: { type: "string", description: "JSON rules array" },
        stack: {
          type: "string",
          description:
            "JSON array of ordered first-match-wins steps (condition/rollout, rolloutPct in basis " +
            "points) — replaces the gatekeeper stack wholesale. See exp_create_gate for the shape.",
        },
        enabled: { type: "boolean" },
      },
    },
  },
  {
    name: "exp_create_killswitch",
    description:
      "Create a killswitch — a static `{ value, switches }` config delivered as-is to the client. Name must be `folder.name`. Switches take precedence over `value` for that switch_key.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: {
          type: "string",
          description: "`folder.name` — exactly two lowercase segments separated by a dot.",
        },
        description: { type: "string" },
        value: { type: "boolean", description: "Default value (default false)." },
        switches: {
          type: "string",
          description:
            "JSON object of { switch_key: bool } overrides; takes precedence over value.",
        },
      },
    },
  },
  {
    name: "exp_update_killswitch",
    description: "Update a killswitch's default value, switches map, or description.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        value: { type: "boolean" },
        switches: {
          type: "string",
          description: "JSON { switch_key: bool } — replaces wholesale.",
        },
        description: { type: "string" },
      },
    },
  },
  {
    name: "exp_delete_killswitch",
    description: "Delete a killswitch by name.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    },
  },
  {
    name: "exp_set_killswitch_switch",
    description:
      "Set or update one switch entry on one env. Lets you flip individual lanes (e.g. `eu_only`) without touching the rest of the killswitch.",
    inputSchema: {
      type: "object",
      required: ["name", "env", "switch_key", "value"],
      properties: {
        name: { type: "string" },
        env: { type: "string", enum: ["dev", "staging", "prod"] },
        switch_key: { type: "string" },
        value: { type: "boolean" },
      },
    },
  },
  {
    name: "exp_unset_killswitch_switch",
    description: "Remove one switch entry from one env. Falls back to the default value.",
    inputSchema: {
      type: "object",
      required: ["name", "env", "switch_key"],
      properties: {
        name: { type: "string" },
        env: { type: "string", enum: ["dev", "staging", "prod"] },
        switch_key: { type: "string" },
      },
    },
  },
  {
    name: "exp_delete_gate",
    description: "Delete a feature gate by name. Refuses if used by a running experiment.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    },
  },
  {
    name: "exp_create_config",
    description:
      "Create a remote-config object validated against a JSON Schema. Configs are object-only.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        schema: {
          type: "string",
          description:
            "JSON Schema (must have top-level type=object). Defaults to a permissive object schema.",
        },
        value: {
          type: "string",
          description: "Initial value as JSON object. Defaults to {}.",
        },
        description: { type: "string" },
      },
    },
  },
  {
    name: "exp_update_config",
    description:
      "Update a config's value (legacy flat update — applies to all envs). Use the dashboard for per-env draft/publish.",
    inputSchema: {
      type: "object",
      required: ["name", "value"],
      properties: {
        name: { type: "string" },
        value: { type: "string", description: "JSON-encoded value" },
      },
    },
  },
  {
    name: "exp_delete_config",
    description: "Delete a config by name.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    },
  },
  {
    name: "exp_create_universe",
    description: "Create an experiment universe (container with optional holdout range).",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        unit_type: { type: "string", description: "Default: user_id" },
        holdout_range: {
          type: "string",
          description: "Holdout range as 'lo,hi' integers in [0,9999]; omit for none",
        },
      },
    },
  },
  {
    name: "exp_update_universe",
    description: "Update a universe's holdout range.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        holdout_range: {
          type: "string",
          description: "Holdout range as 'lo,hi' integers in [0,9999], or 'null' to clear",
        },
      },
    },
  },
  {
    name: "exp_delete_universe",
    description: "Delete a universe by name. Refuses if any experiment still references it.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    },
  },
  {
    name: "exp_create_experiment",
    description:
      "Create an experiment draft with groups, params, optional targeting gate, a success (goal) metric, optional guardrail metrics, and full statistical config. Pass success_event (+ success_aggregation) to attach the goal metric inline — required before the experiment can be started. Does NOT start — call exp_start_experiment.",
    inputSchema: {
      type: "object",
      required: ["name", "universe"],
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        universe: { type: "string" },
        allocation: { type: "number", description: "0–100, default 10" },
        groups: { type: "string", description: "JSON [{name,weight,params}]" },
        params_schema: { type: "object" },
        targeting_gate: { type: "string" },
        bucket_by: {
          type: "string",
          description:
            "User-attribute used as the bucketing key. Defaults to user_id. Use e.g. company_id / account_id to keep a whole org on one variant, or session_id / device_id for anonymous traffic.",
        },
        success_event: {
          type: "string",
          description:
            "Event name for the goal metric. Attaching a goal metric is what makes the experiment startable; the event is auto-created if missing.",
        },
        success_aggregation: {
          type: "string",
          description: "Goal-metric reducer. Defaults to count_users when success_event is set.",
          enum: ["count_users", "count_events", "sum", "avg", "retention_7d", "retention_30d"],
        },
        success_value: {
          type: "string",
          description:
            "Numeric event property to reduce over. Required only for sum / avg aggregations (e.g. 'amount').",
        },
        guardrail_metrics: {
          type: "string",
          description:
            "Optional JSON array of guardrail metrics — safety metrics that must NOT regress (latency, error rate, refunds…). Each entry is a metric-DSL query string, e.g. '[\"avg(latency_ms)\",\"count_users(error_shown)\"]', or an object { \"query\": \"...\", \"name\": \"...\" }. Up to 10. The analysis pass classifies these separately (advisory vs hold) and alerts on a breach independent of the goal.",
        },
        significance_threshold: {
          type: "number",
          description: "p-value cutoff (alpha). Default 0.05. Non-0.05 needs Pro plan or higher.",
        },
        min_runtime_days: {
          type: "number",
          description: "Minimum days to run before results are conclusive. Default 0.",
        },
        min_sample_size: {
          type: "number",
          description: "Minimum exposures per group before results are conclusive. Default 100.",
        },
        sequential_testing: {
          type: "boolean",
          description:
            "Enable always-valid (sequential / mSPRT) p-values so you can peek without inflating false positives. Default false. Requires Premium plan or higher.",
        },
      },
    },
  },
  {
    name: "exp_update_experiment",
    description:
      "Update a draft (or running) experiment's allocation, groups, targeting gate, bucketing, stats thresholds, guardrail metrics, or goal metric. Pass success_event (+ success_aggregation) to attach/replace the goal metric — use this to make a draft startable when it's missing one.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        allocation: { type: "number", description: "0–100" },
        groups: { type: "string", description: "JSON [{name,weight,params}]" },
        targeting_gate: {
          type: "string",
          description:
            "Gate name; pass empty string or omit to leave unchanged; pass the literal 'none' to clear the gate",
        },
        bucket_by: {
          type: "string",
          description:
            "User-attribute used as the bucketing key (user_id default; e.g. company_id). Immutable while running.",
        },
        significance_threshold: { type: "number", description: "0.0001–0.5" },
        min_runtime_days: { type: "number" },
        min_sample_size: { type: "number" },
        sequential_testing: {
          type: "boolean",
          description: "Toggle always-valid sequential p-values. Requires Premium plan or higher.",
        },
        guardrail_metrics: {
          type: "string",
          description:
            "JSON array of guardrail metrics (DSL query strings or { query, name } objects) — replaces the guardrail set. See exp_create_experiment.",
        },
        success_event: {
          type: "string",
          description: "Event name for the goal metric. Attaches/replaces the role=goal metric.",
        },
        success_aggregation: {
          type: "string",
          description: "Goal-metric reducer. Defaults to count_users when success_event is set.",
          enum: ["count_users", "count_events", "sum", "avg", "retention_7d", "retention_30d"],
        },
        success_value: {
          type: "string",
          description: "Numeric event property to reduce over. Required only for sum / avg.",
        },
      },
    },
  },
  {
    name: "exp_delete_experiment",
    description:
      "Soft-delete (archive) an experiment by name. The name stays reserved; restore it with exp_restore_experiment.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    },
  },
  {
    name: "exp_restore_experiment",
    description:
      "Restore a soft-deleted (archived) experiment back to draft so it can be re-completed and started. Only works if it never started; preserves the attached goal metric.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    },
  },
  {
    name: "exp_start_experiment",
    description: "Transition a draft experiment to running.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    },
  },
  {
    name: "exp_stop_experiment",
    description: "Stop a running experiment; optionally promote a winning group.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        promote_group: { type: "string" },
      },
    },
  },
  {
    name: "exp_experiment_status",
    description: "Return experiment stats + ship/hold/wait verdict.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string" } },
    },
  },

  // ────────────────────────── alert rules ──────────────────────────
  // Metric-threshold rules the cron evaluates to raise alerts. The `metric`
  // (and its aggregation) is fixed at create time — `exp_update_alert_rule`
  // exposes no metric field. To list existing rules + their ids, use
  // `list_resources { kind: "alert_rules" }`.
  {
    name: "exp_create_alert_rule",
    description:
      "Create a metric-threshold alert rule. The cron aggregates the metric over the trailing window and raises an alert at `severity` when `value <comparator> threshold` holds. The metric (and its aggregation) is fixed for the rule's life.",
    inputSchema: {
      type: "object",
      required: ["name", "metric", "comparator", "threshold"],
      properties: {
        name: { type: "string", description: "Human label shown on the rule and raised alert." },
        metric: { type: "string", description: "Metric id or name to evaluate." },
        comparator: {
          type: "string",
          enum: ["gt", "gte", "lt", "lte"],
          description: "How the metric value is compared to `threshold`.",
        },
        threshold: {
          type: "number",
          description: "Threshold the metric value is compared against.",
        },
        window_hours: {
          type: "number",
          description: "Lookback window in whole hours (1–720). Default 24.",
        },
        severity: {
          type: "string",
          enum: ["danger", "warn", "info"],
          description: "Severity of the raised alert. Default 'warn'.",
        },
        enabled: { type: "boolean", description: "Whether the cron evaluates it. Default true." },
        notify: {
          type: "object",
          description:
            "Where to deliver this rule's alert, overriding the project default. Omit to inherit the default. Pick a Slack channel from the project's real channels (use the dashboard channel picker / `list_resources`) — never invent an id.",
          properties: {
            slack_channel: {
              type: "object",
              description: "Slack channel to post to (requires a Slack connector).",
              properties: {
                id: { type: "string", description: "Slack channel id, e.g. C0123ABCD." },
                name: { type: "string", description: "Channel name without the leading #." },
              },
              required: ["id", "name"],
            },
            email: { type: "string", description: "Email address to notify for this rule." },
          },
        },
      },
    },
  },
  {
    name: "exp_update_alert_rule",
    description:
      "Update an alert rule's tunable knobs (threshold, comparator, window, severity, name, enabled). The metric is immutable — delete + recreate to repoint a rule at a different metric.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Alert rule id, id-prefix, or unique name." },
        name: { type: "string" },
        comparator: { type: "string", enum: ["gt", "gte", "lt", "lte"] },
        threshold: { type: "number" },
        window_hours: { type: "number", description: "Whole hours, 1–720." },
        severity: { type: "string", enum: ["danger", "warn", "info"] },
        enabled: { type: "boolean" },
        notify: {
          type: "object",
          description:
            "Replace the rule's delivery target. `slack_channel` requires a Slack connector; pick a real channel, never invent an id. Pass an empty object to keep, or set fields to null to clear back to the project default.",
          properties: {
            slack_channel: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
              },
              required: ["id", "name"],
            },
            email: { type: "string" },
          },
        },
      },
    },
  },
  {
    name: "exp_delete_alert_rule",
    description: "Delete an alert rule by id, id-prefix, or unique name.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
  },

  // ────────────────────────────── i18n ──────────────────────────────
  {
    name: "i18n_scan_code",
    description:
      "AST-walk the repo and return candidate translatable strings (JSX text, string literals, template strings). Local-only — no network.",
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" } },
        framework: { type: "string" },
      },
    },
  },
  {
    name: "i18n_discover_site",
    description:
      "Fetch a URL, parse <link rel='i18n-config'> + /.well-known/i18n.json, return profiles + glossary + framework hints.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: { url: { type: "string" } },
    },
  },
  {
    name: "i18n_create_profile",
    description: "Create a new locale profile (e.g. 'fr:prod').",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        source_profile: { type: "string" },
      },
    },
  },
  {
    name: "i18n_push_keys",
    description:
      "Add NEW keys to a profile chunk. Insert-only: existing keys are never overwritten — they come back under `skipped`, and only new keys are added. Pass 'source: codemod' to read from i18n-codemod-review.json, or 'file' for any {key: value} JSON file. To change an existing value, update one key at a time via the dashboard or `shipeasy i18n update`.",
    inputSchema: {
      type: "object",
      required: ["profile"],
      properties: {
        profile: { type: "string" },
        chunk: { type: "string", description: "Chunk name (default: 'default')" },
        file: { type: "string", description: "Path to local JSON file of {key: value} pairs." },
        source: {
          type: "string",
          enum: ["codemod"],
          description: "Read keys from i18n-codemod-review.json",
        },
        path: { type: "string", description: "Project root when source=codemod (defaults to cwd)" },
      },
    },
  },
  {
    name: "i18n_create_key",
    description:
      "Add a single new key to a profile. Insert-only: if the key already exists it is left unchanged (never overwritten).",
    inputSchema: {
      type: "object",
      required: ["profile", "key", "value"],
      properties: {
        profile: { type: "string" },
        key: { type: "string" },
        value: { type: "string" },
        description: { type: "string" },
        chunk: { type: "string" },
      },
    },
  },
  {
    name: "i18n_translate_draft",
    description:
      "Run Anthropic translation on a draft, key by key. Anthropic API key is read from the operator's env — never sent to shipeasy.",
    inputSchema: {
      type: "object",
      required: ["draft_id", "source_profile", "target_profile"],
      properties: {
        draft_id: { type: "string" },
        source_profile: { type: "string" },
        target_profile: { type: "string" },
        glossary: { type: "array" },
        anthropic_api_key_env: {
          type: "string",
          description: "Env var name to read key from. Default ANTHROPIC_API_KEY.",
        },
        max_parallel: { type: "number" },
      },
    },
  },
  {
    name: "i18n_publish_profile",
    description: "Publish a chunk or whole profile: rebuild KV manifest + purge CDN.",
    inputSchema: {
      type: "object",
      required: ["profile"],
      properties: {
        profile: { type: "string" },
        chunk: { type: "string", description: "Omit to publish the whole profile." },
      },
    },
  },
  {
    name: "i18n_codemod_preview",
    description:
      "Preview an AST transform that wraps translatable strings in <ShipeasyString> or shipeasy_t(). Returns a diff; writes nothing.",
    inputSchema: {
      type: "object",
      required: ["framework", "files"],
      properties: {
        framework: {
          type: "string",
          enum: ["nextjs", "react", "remix", "vue", "svelte", "angular", "rails", "django"],
        },
        files: { type: "array", items: { type: "string" } },
        strategy: { type: "string" },
        key_prefix: { type: "string" },
      },
    },
  },
  {
    name: "i18n_codemod_apply",
    description:
      "Apply a previously-previewed codemod. Requires confirm: true — never writes without explicit consent from the caller.",
    inputSchema: {
      type: "object",
      required: ["framework", "files", "confirm"],
      properties: {
        framework: { type: "string" },
        files: { type: "array", items: { type: "string" } },
        strategy: { type: "string" },
        key_prefix: { type: "string" },
        confirm: { type: "boolean" },
      },
    },
  },
  {
    name: "i18n_validate_keys",
    description:
      "Pre-commit check — scan code for referenced keys, confirm each exists server-side. Exits non-zero on drift.",
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "i18n_install_loader",
    description:
      "Emit the correct <script src='…/sdk/i18n/loader.js' data-key=… data-profile=…> snippet for the detected framework's entry HTML / layout.",
    inputSchema: {
      type: "object",
      required: ["profile"],
      properties: {
        profile: { type: "string" },
        framework: { type: "string" },
        path: { type: "string", description: "Project root directory (defaults to cwd)" },
      },
    },
  },

  // ────────────────────────────── ops ──────────────────────────────
  {
    name: "ops_notify",
    description:
      "Raise a 'needs your attention' bell notification in the dashboard — the escalation channel when an ops item can't be fixed in code (missing credential/device/prod env, a product decision, an env or alert-rule knob only a human can change). Create-only and idempotent on the dedupe key. Provide a clear title, a one-line summary, and an ordered, self-contained list of steps the human should take.",
    inputSchema: {
      type: "object",
      required: ["title", "summary"],
      properties: {
        title: { type: "string", description: "One-line headline of what's blocked." },
        summary: { type: "string", description: "One sentence: why it can't be fixed in code." },
        steps: {
          type: "array",
          items: { type: "string" },
          description:
            "Ordered, actionable steps the human should take (3–6; name exact files/commands).",
        },
        href: {
          type: "string",
          description:
            "Dashboard-relative deep link to the related item (e.g. /dashboard/<project>/bugs/42).",
        },
        item: {
          type: "string",
          description: "Queue item number this is about — sets a stable dedupe key (feedback:<n>).",
        },
        dedupeKey: {
          type: "string",
          description: "Explicit dedupe key (overrides item); re-runs collapse to one feed row.",
        },
      },
    },
  },
];
