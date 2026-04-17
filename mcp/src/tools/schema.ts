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
      "Unified listing across gates, configs, experiments, events, metrics, universes, attributes, i18n profiles/chunks/keys/drafts, and sdk_keys.",
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
    description: "Create a feature gate with targeting rules and rollout percentage.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", description: "Snake_case; auto-slugged." },
        description: { type: "string" },
        rollout: { type: "number", description: "0–100" },
        rules: { type: "string", description: "JSON rules array" },
        killswitch: { type: "boolean" },
      },
    },
  },
  {
    name: "exp_create_config",
    description: "Create a static sitevar (same value for every user).",
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
    name: "exp_create_experiment",
    description:
      "Create an experiment draft with groups, params, optional targeting gate, and optional success metric. Does NOT start — call exp_start_experiment.",
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
        success_event: { type: "string" },
        success_aggregation: {
          type: "string",
          enum: ["count_users", "count_events", "sum", "avg", "retention_7d", "retention_30d"],
        },
      },
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
    description: "Bulk upload a JSON file of label keys to a chunk.",
    inputSchema: {
      type: "object",
      required: ["profile", "chunk", "file"],
      properties: {
        profile: { type: "string" },
        chunk: { type: "string" },
        file: { type: "string", description: "Path to local JSON file of {key: value} pairs." },
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
      },
    },
  },
];
