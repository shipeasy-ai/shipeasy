import { Command } from "commander";
import { getApiClient, ApiError } from "../api/client";
import { printTable, printJson, statusColor } from "../util/output";

interface Gate {
  id: string;
  name: string;
  enabled: number;
  killswitch: number;
  rollout_pct: number;
  created_at: string;
}

export function flagsCommand(parent: Command): void {
  const flags = parent.command("flags").description("Manage feature flags (gates)");

  flags
    .command("list")
    .description("List all feature flags")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        const client = getApiClient(opts.project);
        const data = await client.request<{ gates: Gate[] }>("GET", "/api/admin/gates");
        if (opts.json) return printJson(data);
        if (!data.gates?.length) {
          console.log("No flags found.");
          return;
        }
        printTable(
          ["Name", "Enabled", "Killswitch", "Rollout %"],
          data.gates.map((g) => [
            g.name,
            g.enabled ? "yes" : "no",
            g.killswitch ? "yes" : "no",
            `${(g.rollout_pct / 100).toFixed(0)}%`,
          ]),
        );
      } catch (e) {
        handleError(e);
      }
    });

  flags
    .command("create <name>")
    .description("Create a new feature flag")
    .option("--rollout <pct>", "Rollout percentage (0-100)", "0")
    .option("--rules <json>", "Targeting rules as JSON array")
    .option("--salt <s>", "Override hash salt")
    .option("--killswitch", "Enable killswitch immediately")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const client = getApiClient(opts.project);
        const body: Record<string, unknown> = {
          name,
          rollout_pct: Math.round(Number(opts.rollout) * 100),
          rules: opts.rules ? JSON.parse(opts.rules) : [],
          killswitch: Boolean(opts.killswitch),
        };
        if (opts.salt) body.salt = opts.salt;
        const data = await client.request("POST", "/api/admin/gates", body);
        if (opts.json) return printJson(data);
        console.log(`Created flag: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  flags
    .command("enable <name>")
    .description("Enable a feature flag")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const client = getApiClient(opts.project);
        const data = await client.request<{ gates: Gate[] }>("GET", "/api/admin/gates");
        const gate = data.gates?.find((g) => g.name === name);
        if (!gate) throw new ApiError(`Flag '${name}' not found`, 404);
        await client.request("POST", `/api/admin/gates/${gate.id}/enable`);
        console.log(`Enabled: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  flags
    .command("disable <name>")
    .description("Disable a feature flag")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const client = getApiClient(opts.project);
        const data = await client.request<{ gates: Gate[] }>("GET", "/api/admin/gates");
        const gate = data.gates?.find((g) => g.name === name);
        if (!gate) throw new ApiError(`Flag '${name}' not found`, 404);
        await client.request("POST", `/api/admin/gates/${gate.id}/disable`);
        console.log(`Disabled: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  flags
    .command("delete <name>")
    .description("Delete a feature flag")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const client = getApiClient(opts.project);
        const data = await client.request<{ gates: Gate[] }>("GET", "/api/admin/gates");
        const gate = data.gates?.find((g) => g.name === name);
        if (!gate) throw new ApiError(`Flag '${name}' not found`, 404);
        await client.request("DELETE", `/api/admin/gates/${gate.id}`);
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
