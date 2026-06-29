import type { Prompt } from "@modelcontextprotocol/sdk/types.js";

/**
 * Workflow playbooks exposed via MCP `prompts`. See packages/mcp/README.md
 * § "Prompts" for the full list.
 *
 * The i18n authoring playbooks (`setup_i18n`, `translate_site`, `i18n_health`)
 * were removed: they orchestrated filesystem / AST tools (`detect_project`,
 * `i18n_scan_code`, the codemods, `i18n_validate_keys`, `i18n_install_loader`,
 * `i18n_push_keys`, `i18n_translate_draft`) that now live in the `shipeasy` CLI,
 * not this MCP server. The remaining over-MCP i18n surface is pure-API
 * (`i18n_create_profile` / `i18n_create_key` / `i18n_set` / `i18n_publish_profile`).
 */
export const PROMPTS: Prompt[] = [
  {
    name: "setup_experimentation",
    description: "Install the SDK, add env keys, wire a provider, verify with a sample gate.",
  },
  {
    name: "create_experiment",
    description: "Propose → create → inject code → start → monitor an A/B experiment.",
  },
  {
    name: "analyze_experiment",
    description: "Pull results, compute lift + significance, emit ship/hold/wait verdict.",
  },
  {
    name: "cleanup_winner",
    description: "Remove losing branches + dead gate code after shipping a winner.",
  },
  {
    name: "rotate_sdk_keys",
    description: "Revoke + re-issue client/server keys and update env vars.",
  },
];

export const PROMPT_BODIES: Record<string, string> = Object.fromEntries(
  PROMPTS.map((p) => [
    p.name,
    `# ${p.name}\n\nThis playbook is not implemented yet. See packages/mcp/README.md § Prompts for the planned steps.`,
  ]),
);
