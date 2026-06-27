import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { RELEASE_REGISTRY_TOOLS } from "./release.js";

/**
 * Tool catalog for @shipeasy/mcp.
 *
 * Full plan + input/output shapes: packages/mcp/README.md § "Tool catalog".
 *
 * `STATIC_TOOLS` are hand-written tools. The gate/kill-switch/config/universe
 * tools are NOT here — they are generated from the shared operation registry
 * (`RELEASE_REGISTRY_TOOLS`, see ./release.ts) and concatenated below, so one
 * definition drives the CLI, the MCP server, and the docs. The exported `TOOLS`
 * is the full catalog (static + registry-generated).
 */
const STATIC_TOOLS: Tool[] = [
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

  // ───────────────────────── feedback (bugs / features) ─────────────────────
  {
    name: "file_bug",
    description:
      "File a bug report into the bound project's feedback queue (and, where a GitHub/Slack connector is configured, open a real issue / post a message). The body fields become the GitHub issue body verbatim — so if the report is vague (no clear repro, no expected-vs-actual), ask the user ONE or TWO short clarifying questions FIRST, then fold the answers into the fields below. Create-only.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string", description: "Short, specific one-line summary of the bug." },
        steps_to_reproduce: {
          type: "string",
          description: "Explicit/numbered steps to reproduce. Markdown allowed.",
        },
        actual_result: { type: "string", description: "What actually happens (the breakage)." },
        expected_result: { type: "string", description: "What was expected instead." },
        priority: {
          type: "string",
          enum: ["nice_to_have", "medium", "high", "critical"],
          description: "Optional severity; omit if unsure and let the team triage.",
        },
        page_url: { type: "string", description: "Optional URL where the bug occurs." },
      },
    },
  },
  {
    name: "file_feature",
    description:
      "File a feature request into the bound project's feedback queue (and, where a GitHub/Slack connector is configured, open a real issue / post a message). The body fields become the GitHub issue body verbatim — so if it's unclear WHAT exactly to build (scope, surface, acceptance criteria), ask the user ONE or TWO short clarifying questions FIRST, then fold the answers into the fields below. Create-only.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string", description: "Short, specific one-line summary of the request." },
        description: {
          type: "string",
          description: "What to build and how it should behave — the concrete proposal.",
        },
        use_case: { type: "string", description: "Why it's needed / the problem it solves." },
        priority: {
          type: "string",
          enum: ["nice_to_have", "medium", "high", "critical"],
          description: "Optional importance; omit if unsure and let the team triage.",
        },
        page_url: { type: "string", description: "Optional related URL." },
      },
    },
  },
];

/**
 * Full tool catalog = hand-written tools + the registry-generated release tools
 * (gate / kill switch / config / universe). Experiment + alert-rule tools stay
 * hand-written (richer goal-metric/verdict + ops-module ownership).
 */
export const TOOLS: Tool[] = [...STATIC_TOOLS, ...RELEASE_REGISTRY_TOOLS];
