import { Command } from "commander";
import { getApiClient, ApiError } from "../api/client";
import { printTable, printJson } from "../util/output";

interface Config {
  id: string;
  name: string;
  schema: unknown;
  updatedAt: string;
}

async function listConfigs(client: ReturnType<typeof getApiClient>): Promise<Config[]> {
  return client.request<Config[]>("GET", "/api/admin/configs");
}

async function findConfig(client: ReturnType<typeof getApiClient>, name: string): Promise<Config> {
  const items = await listConfigs(client);
  const c = items.find((x) => x.name === name);
  if (!c) throw new ApiError(`Config '${name}' not found`, 404);
  return c;
}

export function configsCommand(parent: Command): void {
  const configs = parent.command("configs").description("Manage remote-config values");

  configs
    .command("list")
    .description("List all configs")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        const client = getApiClient(opts.project);
        const items = await listConfigs(client);
        if (opts.json) return printJson(items);
        if (!items.length) return void console.log("No configs found.");
        printTable(
          ["Name", "Schema", "Updated"],
          items.map((c) => [c.name, JSON.stringify(c.schema), c.updatedAt]),
        );
      } catch (e) {
        handleError(e);
      }
    });

  configs
    .command("create <name>")
    .description("Create a new config. Value is parsed as JSON.")
    .requiredOption("--value <json>", "Initial value (JSON-encoded)")
    .option("--schema <json>", "Schema as JSON", '{"type":"string"}')
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const client = getApiClient(opts.project, { requireBinding: true });
        const body = {
          name,
          value: JSON.parse(opts.value),
          schema: JSON.parse(opts.schema),
        };
        const data = await client.request("POST", "/api/admin/configs", body);
        if (opts.json) return printJson(data);
        console.log(`Created config: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  configs
    .command("delete <name>")
    .description("Delete a config by name")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const client = getApiClient(opts.project, { requireBinding: true });
        const c = await findConfig(client, name);
        await client.request("DELETE", `/api/admin/configs/${c.id}`);
        console.log(`Deleted: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });
}

function handleError(e: unknown): void {
  if (e instanceof ApiError) {
    console.error(`Error (${e.status}): ${e.message}`);
  } else {
    console.error(String(e));
  }
  process.exit(1);
}
