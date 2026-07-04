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
import { GENERATED_DISPATCH, GENERATED_MUTATES, CUSTOM_DISPATCH } from "./tools/registry.js";
import { getGeneratedClient } from "./tools/_gen-runtime.js";
import { notAuthenticated, notBound, ok, apiErr } from "./util/api-client.js";
import {
  LIST_TOKEN_PARAM,
  guardEnabled,
  guardedCreateFamily,
  listFamily,
  listMintsToken,
  listGuardError,
  listTokenBlock,
  mintListToken,
  verifyToken,
} from "./tools/list-guard.js";

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

    // Generated API tools — gates, kill switches, configs, universes,
    // experiments, metrics, events, ops (queue + alert rules), `projects
    // current`, attributes. Projected from the spec; one generic branch covers
    // them all. The generated `mutates` flag drives the binding guard — read
    // ops (list/get) run unbound; writes require a `.shipeasy` binding.
    const genDispatch = GENERATED_DISPATCH[toolName];
    if (genDispatch) {
      const handle = await getGeneratedClient();
      if (!handle) return notAuthenticated();
      if (GENERATED_MUTATES[toolName] && !handle.bound) return notBound(handle);
      const args = params.arguments ?? {};

      // List-before-create guard (MCP-only; toggle with SHIPEASY_MCP_LIST_GUARD):
      // a guarded create must carry a fresh `listToken` minted by its sibling
      // `*_list` — proof the caller checked for an existing match. The token is
      // never read by the generated dispatch (which picks only the named
      // body/query args), so it can't reach the wire.
      const createFamily = guardEnabled() ? guardedCreateFamily(toolName) : null;
      if (createFamily) {
        const verdict = verifyToken(createFamily, args[LIST_TOKEN_PARAM], Date.now());
        if (verdict !== "ok") return listGuardError(createFamily, verdict);
      }

      try {
        const data = await genDispatch(handle.client, args);
        // A token-minting list appends the fresh `listToken` for its family so
        // the model can spend it on the matching create.
        if (guardEnabled() && listMintsToken(toolName)) {
          const family = listFamily(toolName) as string;
          const base = ok(data);
          return { content: [...base.content, listTokenBlock(family, mintListToken(family, Date.now()))] };
        }
        return ok(data);
      } catch (e) {
        return apiErr(e);
      }
    }

    // Custom (non-endpoint) tools — `metrics_grammar`, `docs_*`. Auth-free
    // (pure / outbound fetch over GitHub Pages); no client, no binding.
    const customDispatch = CUSTOM_DISPATCH[toolName];
    if (customDispatch) {
      try {
        const result = await customDispatch(params.arguments ?? {});
        // `metrics_grammar` is a reference document meant to be read as-is —
        // return the raw text, not a JSON-escaped `{ "grammar": "...\n..." }`.
        if (toolName === "metrics_grammar") {
          return { content: [{ type: "text" as const, text: (result as { grammar: string }).grammar }] };
        }
        return ok(result);
      } catch (e) {
        return apiErr(e);
      }
    }

    // Real handlers for the auth-surface tools — everything else is still a stub
    // pointing at packages/mcp/README.md § "Tool catalog".
    if (toolName === "projects_upsert") {
      const args = params.arguments ?? {};
      return handleUpsertProject(args as Parameters<typeof handleUpsertProject>[0]);
    }
    if (toolName === "auth_check") return handleAuthCheck();
    if (toolName === "auth_logout") return handleAuthLogout();
    // Everything else — every CRUD/read/docs surface incl. the i18n admin API
    // (`i18n_profiles_*`/`i18n_keys_*`/`i18n_drafts_list`), alert rules, the
    // unified queue (`ops_create`/`ops_notify`), metrics, events — is handled by
    // the registry dispatch above.
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
