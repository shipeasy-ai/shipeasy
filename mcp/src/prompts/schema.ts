import type { Prompt } from "@modelcontextprotocol/sdk/types.js";

/**
 * Workflow playbooks exposed via MCP `prompts`. See packages/mcp/README.md
 * § "Prompts" for the full list.
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
    name: "setup_i18n",
    description: "Install SDK + loader script, create en:prod, run codemod, validate.",
  },
  {
    name: "translate_site",
    description: "Given a URL: discover, add target locale, translate, review, publish.",
  },
  {
    name: "i18n_health",
    description: "Report missing keys, unused keys, drift between profiles.",
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
