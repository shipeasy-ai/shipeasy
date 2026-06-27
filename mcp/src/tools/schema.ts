import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { REGISTRY_TOOLS } from "./registry.js";

/**
 * Tool catalog for @shipeasy/mcp.
 *
 * Full plan + input/output shapes: packages/mcp/README.md § "Tool catalog".
 *
 * `STATIC_TOOLS` are the hand-written tools that CANNOT be registry ops: auth,
 * `detect_project` (arbitrary repo scan), `projects_upsert` (layers a
 * `.shipeasy` fs bind), and the fs/AST i18n tools (scan/codemod/loader/discover
 * + the codemod-review push/key write tools). Everything else — gates, kill
 * switches, configs, universes, experiments, metrics, events, ops (queue +
 * alert rules), `projects current`, attributes, SDK-docs, and the read-only
 * i18n list ops — is generated from the shared operation registry
 * (`REGISTRY_TOOLS`, see ./registry.ts). The exported `TOOLS` is the full
 * catalog (static + registry-generated).
 *
 * Retired here (now registry-driven): `list_resources`/`get_resource` (typed
 * `*_list`/`*_get` tools), `get_sdk_snippet` (→ `docs_*`), `exp_*_alert_rule`
 * (→ `ops_alerts_*`), `ops_notify` (→ `ops_notify`), `file_bug`/`file_feature`
 * (→ `ops_create --type`).
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

  // ────────────────────────────── i18n (fs / AST) ──────────────────────────────
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
];

/**
 * Full tool catalog = the hand-written fs/auth tools + every registry-generated
 * tool. The registry now owns the whole CRUD + read + docs surface; only the
 * fs/AST/auth/bind tools above stay hand-written.
 */
export const TOOLS: Tool[] = [...STATIC_TOOLS, ...REGISTRY_TOOLS];
