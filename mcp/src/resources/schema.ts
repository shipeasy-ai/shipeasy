import type { ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";

/**
 * Resource URI templates exposed via MCP `resources`. See packages/mcp/README.md
 * § "Resources" for the full list + semantics.
 */
export const RESOURCE_TEMPLATES: ResourceTemplate[] = [
  {
    uriTemplate: "shipeasy://project",
    name: "project",
    description: "Cached detect_project + auth_check output for the current repo.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "shipeasy://experiments/{name}",
    name: "experiment",
    description: "Experiment config + latest stats JSON.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "shipeasy://gates/{name}",
    name: "gate",
    description: "Gate config + rollout state.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "shipeasy://configs/{name}",
    name: "config",
    description: "Config value + history.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "shipeasy://i18n/profiles/{profile}",
    name: "i18n-profile",
    description: "i18n profile metadata + chunk list + coverage %.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "shipeasy://i18n/profiles/{profile}/{chunk}",
    name: "i18n-chunk",
    description: "Published label strings for one chunk.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "shipeasy://i18n/drafts/{draft_id}",
    name: "i18n-draft",
    description: "Draft metadata + per-key diff vs. source profile.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "shipeasy://plans/current",
    name: "current-plan",
    description: "Plan tier + current-month usage + remaining quota.",
    mimeType: "application/json",
  },
];
