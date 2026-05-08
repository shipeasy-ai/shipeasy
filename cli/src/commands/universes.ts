import { Command } from "commander";
import { getApiClient, ApiError } from "../api/client";
import { printTable, printJson } from "../util/output";

interface Universe {
  id: string;
  name: string;
  allocationPct: number;
  holdoutPct: number;
}

async function listUniverses(client: ReturnType<typeof getApiClient>): Promise<Universe[]> {
  return client.request<Universe[]>("GET", "/api/admin/universes");
}

async function findUniverse(
  client: ReturnType<typeof getApiClient>,
  name: string,
): Promise<Universe> {
  const items = await listUniverses(client);
  const u = items.find((x) => x.name === name);
  if (!u) throw new ApiError(`Universe '${name}' not found`, 404);
  return u;
}

export function universesCommand(parent: Command): void {
  const u = parent
    .command("universes")
    .description("Manage experiment universes (containers + holdouts)");

  u.command("list")
    .description("List universes")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        const client = getApiClient(opts.project);
        const items = await listUniverses(client);
        if (opts.json) return printJson(items);
        if (!items.length) return void console.log("No universes found.");
        printTable(
          ["Name", "Allocation %", "Holdout %"],
          items.map((x) => [
            x.name,
            `${(x.allocationPct / 100).toFixed(0)}%`,
            `${(x.holdoutPct / 100).toFixed(0)}%`,
          ]),
        );
      } catch (e) {
        handleError(e);
      }
    });

  u.command("create <name>")
    .description("Create a universe")
    .option("--allocation <pct>", "Allocation percentage (0-100)", "100")
    .option("--holdout <pct>", "Holdout percentage (0-100)", "0")
    .option("--salt <s>", "Hash salt (default: random)")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const client = getApiClient(opts.project, { requireBinding: true });
        const body: Record<string, unknown> = {
          name,
          allocation: Number(opts.allocation),
          holdoutPct: Number(opts.holdout),
        };
        if (opts.salt) body.salt = opts.salt;
        else body.salt = `${name}-${Date.now()}`;
        const data = await client.request("POST", "/api/admin/universes", body);
        if (opts.json) return printJson(data);
        console.log(`Created universe: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  u.command("delete <name>")
    .description("Delete a universe by name")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const client = getApiClient(opts.project, { requireBinding: true });
        const x = await findUniverse(client, name);
        await client.request("DELETE", `/api/admin/universes/${x.id}`);
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
