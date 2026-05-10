import { Command } from "commander";
import { ApiError, getAdminClient } from "../api/client";
import { printTable, printJson } from "../util/output";

export function flagsCommand(parent: Command): void {
  const flags = parent.command("flags").description("Manage feature flags (gates)");

  flags
    .command("list")
    .description("List all feature flags")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        const api = getAdminClient(opts.project);
        const gates = await api.gates.listAll();
        if (opts.json) return printJson(gates);
        if (!gates.length) {
          console.log("No flags found.");
          return;
        }
        printTable(
          ["Name", "Enabled", "Rollout %"],
          gates.map((g) => [
            g.name,
            g.enabled ? "yes" : "no",
            `${(g.rolloutPct / 100).toFixed(0)}%`,
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
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const data = await api.gates.create({
          name,
          rollout_pct: Math.round(Number(opts.rollout) * 100),
          rules: opts.rules ? JSON.parse(opts.rules) : [],
          ...(opts.salt ? { salt: opts.salt } : {}),
        });
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
        const api = getAdminClient(opts.project, { requireBinding: true });
        const gate = await api.gates.resolve(name);
        await api.gates.enable(gate.id);
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
        const api = getAdminClient(opts.project, { requireBinding: true });
        const gate = await api.gates.resolve(name);
        await api.gates.disable(gate.id);
        console.log(`Disabled: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  flags
    .command("rollout <name> <pct>")
    .description("Set rollout percentage (0-100) for a feature flag")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, pct: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const data = await api.gates.setRollout(name, Number(pct));
        if (opts.json) return printJson(data);
        console.log(`Set rollout for ${name}: ${pct}%`);
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
        const api = getAdminClient(opts.project, { requireBinding: true });
        const gate = await api.gates.resolve(name);
        await api.gates.delete(gate.id);
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
