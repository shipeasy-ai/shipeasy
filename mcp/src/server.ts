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

    // Real handlers for the auth-surface tools — everything else is still a stub
    // pointing at packages/mcp/README.md § "Tool catalog".
    if (toolName === "auth_check") return handleAuthCheck();
    if (toolName === "auth_logout") return handleAuthLogout();
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
