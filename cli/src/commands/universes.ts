import { Command } from "commander";
import { ApiError, getAdminClient } from "../api/client";
import { printTable, printJson } from "../util/output";
import { withExamples } from "../util/examples";

export function universesCommand(parent: Command): void {
  const u = parent
    .command("universes")
    .description("Manage experiment universes (containers + holdouts)");

  const listUniverses = u
    .command("list")
    .description("List universes")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        const api = getAdminClient(opts.project);
        const items = await api.universes.listAll();
        if (opts.json) return printJson(items);
        if (!items.length) return void console.log("No universes found.");
        printTable(
          ["Name", "Allocation %", "Holdout %"],
          items.map((x) => [
            x.name,
            `${((x.allocationPct ?? 10000) / 100).toFixed(0)}%`,
            `${((x.holdoutPct ?? 0) / 100).toFixed(0)}%`,
          ]),
        );
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(listUniverses, [{ run: "shipeasy universes list" }]);

  const createUniverse = u
    .command("create <name>")
    .description("Create a universe")
    .option("--unit-type <t>", "Unit type (e.g. user_id, account_id)", "user_id")
    .option("--holdout <range>", "Holdout range as 'lo,hi' (0-9999); omit for no holdout")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const holdout_range = parseHoldout(opts.holdout);
        const data = await api.universes.create({
          name,
          unit_type: opts.unitType,
          holdout_range,
        });
        if (opts.json) return printJson(data);
        console.log(`Created universe: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(createUniverse, [
    { note: "Default user_id unit, no holdout", run: "shipeasy universes create web" },
    {
      note: "10% holdout, keyed on account_id",
      run: "shipeasy universes create web --unit-type account_id --holdout 0,999",
    },
  ]);

  const updateUniverse = u
    .command("update <name>")
    .description("Update a universe's holdout range")
    .option("--holdout <range>", "Holdout range as 'lo,hi' (0-9999), or 'null' to clear")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const x = await api.universes.resolve(name);
        const holdout_range = opts.holdout === undefined ? undefined : parseHoldout(opts.holdout);
        const data = await api.universes.update(x.id, {
          ...(holdout_range !== undefined ? { holdout_range } : {}),
        });
        if (opts.json) return printJson(data);
        console.log(`Updated universe: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(updateUniverse, [
    { note: "Set a 5% holdout", run: "shipeasy universes update web --holdout 0,499" },
    { note: "Clear the holdout", run: "shipeasy universes update web --holdout null" },
  ]);

  const deleteUniverse = u
    .command("delete <name>")
    .description("Delete a universe by name")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const x = await api.universes.resolve(name);
        await api.universes.delete(x.id);
        console.log(`Deleted: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(deleteUniverse, [{ run: "shipeasy universes delete web" }]);
}

function parseHoldout(raw: string | undefined): [number, number] | null {
  if (raw === undefined || raw === "" || raw === "null") return null;
  const [loRaw, hiRaw] = raw.split(",").map((s) => s.trim());
  const lo = Number(loRaw);
  const hi = Number(hiRaw);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    throw new ApiError("--holdout must be 'lo,hi' integers in [0,9999]", 400);
  }
  return [lo, hi];
}

function handleError(e: unknown): void {
  if (e instanceof ApiError) {
    console.error(`Error (${e.status}): ${e.message}`);
  } else {
    console.error(String(e));
  }
  process.exit(1);
}
