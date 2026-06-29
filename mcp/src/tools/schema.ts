import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { REGISTRY_TOOLS } from "./registry.js";

/**
 * Tool catalog for @shipeasy/mcp.
 *
 * Full plan + input/output shapes: packages/mcp/README.md § "Tool catalog".
 *
 * `STATIC_TOOLS` are the only hand-written tools left — the ones that CANNOT be
 * registry ops:
 *   - auth (`auth_check` / `auth_login` / `auth_logout`) — local CLI-token state
 *     + the device-auth flow.
 *   - `projects_upsert` — find-or-create over the API AND layers the `.shipeasy`
 *     fs bind every other write tool depends on.
 *
 * Everything else — gates, kill switches, configs, universes, experiments,
 * metrics, events, ops (queue + alert rules), `projects current`, attributes,
 * SDK-docs, AND the whole i18n admin surface (`i18n_profiles_*`, `i18n_keys_*`,
 * `i18n_drafts_list`) — is generated from the shared operation registry
 * (`REGISTRY_TOOLS`, see ./registry.ts). The exported `TOOLS` is the full catalog
 * (static + registry-generated).
 *
 * All filesystem / AST tools have moved to the `shipeasy` CLI and are no longer
 * exposed over MCP: `detect_project`, the i18n source scanners / codemods
 * (`i18n_scan_code`, `i18n_codemod_preview`/`apply`, `i18n_validate_keys`,
 * `i18n_install_loader`, `i18n_discover_site`), the file-only bulk push
 * (`i18n_push_keys`), and the local-Anthropic translator (`i18n_translate_draft`).
 * The MCP server only makes admin-API calls now (plus the auth + `.shipeasy`
 * bind primitives).
 *
 * Retired here (now registry-driven): `list_resources`/`get_resource` (typed
 * `*_list`/`*_get` tools), `get_sdk_snippet` (→ `docs_*`), `exp_*_alert_rule`
 * (→ `ops_alerts_*`), `ops_notify` (→ `ops_notify`), `file_bug`/`file_feature`
 * (→ `ops_create --type`).
 */
const STATIC_TOOLS: Tool[] = [
  // ────────────────────────────── bind / auth ──────────────────────────────
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
];

/**
 * Full tool catalog = the hand-written auth/bind tools + every registry-generated
 * tool. The registry owns the whole CRUD + read + docs surface (incl. the i18n
 * admin API); only the auth + `.shipeasy` bind tools above stay hand-written. All
 * fs/AST tooling now lives in the `shipeasy` CLI.
 */
export const TOOLS: Tool[] = [...STATIC_TOOLS, ...REGISTRY_TOOLS];
