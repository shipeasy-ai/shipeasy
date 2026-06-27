import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { TOOLS } from "./tools/schema.js";
import { PROMPTS, PROMPT_BODIES } from "./prompts/schema.js";
import { RESOURCE_TEMPLATES } from "./resources/schema.js";
import { handleAuthCheck, handleAuthLogout } from "./tools/shared/auth.js";
import { handleUpsertProject } from "./tools/projects/upsert.js";
import { handleDetectProject } from "./tools/shared/detect-project.js";
import { handleListResources } from "./tools/shared/list-resources.js";
import { handleGetResource } from "./tools/shared/get-resource.js";
import { handleGetSdkSnippet } from "./tools/shared/sdk-snippet.js";
import { handleInstallLoader } from "./tools/i18n/loader.js";
import { handleCreateProfile } from "./tools/i18n/profiles.js";
import { handlePushKeys, handleCreateKey, handleValidateKeys } from "./tools/i18n/keys.js";
import { handleScanCode } from "./tools/i18n/scan.js";
import { handlePublishProfile } from "./tools/i18n/publish.js";
import { handleDiscoverSite } from "./tools/i18n/discover.js";
import { handleCodemodPreview, handleCodemodApply } from "./tools/i18n/codemod.js";
import {
  handleCreateExperiment,
  handleUpdateExperiment,
  handleArchiveExperiment,
  handleRestoreExperiment,
  handleStartExperiment,
  handleStopExperiment,
  handleExperimentStatus,
  handleCreateAlertRule,
  handleUpdateAlertRule,
  handleDeleteAlertRule,
} from "./tools/exp/index.js";
import { handleOpsNotify } from "./tools/ops/notify.js";
import { handleFileBug, handleFileFeature } from "./tools/ops/feedback.js";
import {
  RELEASE_REGISTRY_DISPATCH,
  RELEASE_REGISTRY_OPS_BY_TOOL,
} from "./tools/release.js";
import { getAdminClient, notAuthenticated, notBound, ok, apiErr } from "./util/api-client.js";

const SERVER_NAME = "shipeasy";
const SERVER_VERSION = "0.1.0";

export async function startStdioServer(): Promise<void> {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: { subscribe: false, listChanged: false },
        logging: {},
      },
    },
  );

  // ── tools ──────────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const toolName = params.name;
    const known = TOOLS.some((t) => t.name === toolName);
    if (!known) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: unknown tool "${toolName}"` }],
      };
    }

    // Registry-driven release tools (gate / kill switch / config / universe):
    // one generic branch replaces ~14 hand-written ones. The op's `mutates`
    // flag drives the binding guard — read ops (list/get) run unbound.
    const regOp = RELEASE_REGISTRY_OPS_BY_TOOL.get(toolName);
    if (regOp) {
      const handle = await getAdminClient();
      if (!handle) return notAuthenticated();
      if (regOp.mutates && !handle.bound) return notBound(handle);
      try {
        return ok(await RELEASE_REGISTRY_DISPATCH[toolName](handle.client, params.arguments ?? {}));
      } catch (e) {
        return apiErr(e);
      }
    }

    // Real handlers for the auth-surface tools — everything else is still a stub
    // pointing at packages/mcp/README.md § "Tool catalog".
    if (toolName === "detect_project") {
      const args = params.arguments ?? {};
      const input = (args.paths as string[] | undefined) ?? (args.path as string | undefined);
      return handleDetectProject(input);
    }
    if (toolName === "projects_upsert") {
      const args = params.arguments ?? {};
      return handleUpsertProject(args as Parameters<typeof handleUpsertProject>[0]);
    }
    if (toolName === "auth_check") return handleAuthCheck();
    if (toolName === "auth_logout") return handleAuthLogout();
    if (toolName === "list_resources") {
      const args = params.arguments ?? {};
      return handleListResources(args as Parameters<typeof handleListResources>[0]);
    }
    if (toolName === "i18n_create_profile") {
      const args = (params.arguments ?? {}) as { name: string };
      return handleCreateProfile(args);
    }
    if (toolName === "i18n_push_keys") {
      const args = params.arguments ?? {};
      return handlePushKeys(args as Parameters<typeof handlePushKeys>[0]);
    }
    if (toolName === "i18n_create_key") {
      const args = params.arguments ?? {};
      return handleCreateKey(args as Parameters<typeof handleCreateKey>[0]);
    }
    if (toolName === "i18n_validate_keys") {
      const args = params.arguments ?? {};
      return handleValidateKeys(args as Parameters<typeof handleValidateKeys>[0]);
    }
    if (toolName === "i18n_scan_code") {
      const args = params.arguments ?? {};
      return handleScanCode(args as Parameters<typeof handleScanCode>[0]);
    }
    if (toolName === "i18n_publish_profile") {
      const args = params.arguments ?? {};
      return handlePublishProfile(args as Parameters<typeof handlePublishProfile>[0]);
    }
    if (toolName === "i18n_install_loader") {
      const args = (params.arguments ?? {}) as {
        profile?: string;
        framework?: string;
        path?: string;
      };
      return handleInstallLoader(args);
    }
    if (toolName === "get_resource") {
      const args = params.arguments ?? {};
      return handleGetResource(args as Parameters<typeof handleGetResource>[0]);
    }
    if (toolName === "get_sdk_snippet") {
      const args = params.arguments ?? {};
      return handleGetSdkSnippet(args as unknown as Parameters<typeof handleGetSdkSnippet>[0]);
    }
    if (toolName === "i18n_discover_site") {
      const args = (params.arguments ?? {}) as { url: string };
      return handleDiscoverSite(args);
    }
    if (toolName === "i18n_codemod_preview") {
      const args = params.arguments ?? {};
      return handleCodemodPreview(args as Parameters<typeof handleCodemodPreview>[0]);
    }
    if (toolName === "i18n_codemod_apply") {
      const args = params.arguments ?? {};
      return handleCodemodApply(args as Parameters<typeof handleCodemodApply>[0]);
    }
    // Gate / kill switch / config / universe are handled by the registry
    // dispatch above. Experiments stay hand-written (renamed to release_*).
    if (toolName === "release_experiments_create") {
      const args = params.arguments ?? {};
      return handleCreateExperiment(args as Parameters<typeof handleCreateExperiment>[0]);
    }
    if (toolName === "release_experiments_update") {
      const args = params.arguments ?? {};
      return handleUpdateExperiment(args as Parameters<typeof handleUpdateExperiment>[0]);
    }
    if (toolName === "release_experiments_archive") {
      const args = params.arguments ?? {};
      return handleArchiveExperiment(args as Parameters<typeof handleArchiveExperiment>[0]);
    }
    if (toolName === "release_experiments_restore") {
      const args = params.arguments ?? {};
      return handleRestoreExperiment(args as Parameters<typeof handleRestoreExperiment>[0]);
    }
    if (toolName === "release_experiments_start") {
      const args = params.arguments ?? {};
      return handleStartExperiment(args as Parameters<typeof handleStartExperiment>[0]);
    }
    if (toolName === "release_experiments_stop") {
      const args = params.arguments ?? {};
      return handleStopExperiment(args as Parameters<typeof handleStopExperiment>[0]);
    }
    if (toolName === "release_experiments_status") {
      const args = params.arguments ?? {};
      return handleExperimentStatus(args as Parameters<typeof handleExperimentStatus>[0]);
    }
    if (toolName === "exp_create_alert_rule") {
      const args = params.arguments ?? {};
      return handleCreateAlertRule(args as Parameters<typeof handleCreateAlertRule>[0]);
    }
    if (toolName === "exp_update_alert_rule") {
      const args = params.arguments ?? {};
      return handleUpdateAlertRule(args as Parameters<typeof handleUpdateAlertRule>[0]);
    }
    if (toolName === "exp_delete_alert_rule") {
      const args = params.arguments ?? {};
      return handleDeleteAlertRule(args as Parameters<typeof handleDeleteAlertRule>[0]);
    }
    if (toolName === "ops_notify") {
      const args = params.arguments ?? {};
      return handleOpsNotify(args as Parameters<typeof handleOpsNotify>[0]);
    }
    if (toolName === "file_bug") {
      const args = params.arguments ?? {};
      return handleFileBug(args as Parameters<typeof handleFileBug>[0]);
    }
    if (toolName === "file_feature") {
      const args = params.arguments ?? {};
      return handleFileFeature(args as Parameters<typeof handleFileFeature>[0]);
    }
    if (toolName === "auth_login") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text:
              "Browser auth cannot run over stdio. Run `shipeasy-mcp install` " +
              "in a terminal to authenticate, then retry `auth_check`.",
          },
        ],
      };
    }

    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            `Tool "${toolName}" is not implemented yet.\n\n` +
            `This server is the v0.1 scaffold — it advertises the full tool catalog ` +
            `so AI assistants can discover the surface area, but each handler is a stub.\n\n` +
            `See packages/mcp/README.md (§ Tool catalog) for the planned inputs, outputs, ` +
            `and backing CLI commands.`,
        },
      ],
    };
  });

  // ── prompts ────────────────────────────────────────────────────────
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));

  server.setRequestHandler(GetPromptRequestSchema, async ({ params }) => {
    const body = PROMPT_BODIES[params.name];
    if (!body) throw new Error(`Unknown prompt: ${params.name}`);
    return {
      description: PROMPTS.find((p) => p.name === params.name)?.description,
      messages: [{ role: "user", content: { type: "text", text: body } }],
    };
  });

  // ── resources ──────────────────────────────────────────────────────
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: RESOURCE_TEMPLATES,
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => ({
    contents: [
      {
        uri: params.uri,
        mimeType: "text/plain",
        text:
          `Resource "${params.uri}" is not implemented yet.\n\n` +
          `See packages/mcp/README.md § "Resources" for the planned shape.`,
      },
    ],
  }));

  // ── transport ──────────────────────────────────────────────────────
  process.on("uncaughtException", (err) => {
    process.stderr.write(`[shipeasy-mcp] uncaughtException: ${String(err)}\n`);
  });
  process.on("unhandledRejection", (err) => {
    process.stderr.write(`[shipeasy-mcp] unhandledRejection: ${String(err)}\n`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[shipeasy-mcp] v${SERVER_VERSION} ready on stdio — ${TOOLS.length} tools, ${PROMPTS.length} prompts, ${RESOURCE_TEMPLATES.length} resource templates\n`,
  );
}
