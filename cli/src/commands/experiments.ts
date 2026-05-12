import { Command } from "commander";
import type { ExperimentResult } from "@shipeasy/openapi";
import { ApiError, getAdminClient } from "../api/client";
import { printTable, printJson, statusColor } from "../util/output";

function verdict(results: ExperimentResult[]): string {
  const treatment = results.filter((r) => r.group_name !== "control");
  if (!treatment.length) return "—";
  const last = treatment[treatment.length - 1];
  if (last.srm_detected === 1) return "Invalid (SRM)";
  if (last.p_value === null) return "Wait";
  return last.p_value < 0.05 ? "Ship" : "Hold";
}

export function experimentsCommand(parent: Command): void {
  const exp = parent.command("experiments").description("Manage experiments");

  exp
    .command("list")
    .description("List experiments")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        const api = getAdminClient(opts.project);
        const experiments = await api.experiments.listAll();
        if (opts.json) return printJson(experiments);
        if (!experiments.length) {
          console.log("No experiments found.");
          return;
        }
        printTable(
          ["Name", "Status", "Universe", "Allocation"],
          experiments.map((e) => [
            e.name,
            statusColor(e.status),
            e.universe,
            `${((e.allocationPct ?? 10000) / 100).toFixed(0)}%`,
          ]),
        );
      } catch (e) {
        handleError(e);
      }
    });

  exp
    .command("create <name>")
    .description("Create a new experiment")
    .option("--universe <name>", "Universe name", "default")
    .option("--allocation <pct>", "Allocation percentage (0-100)", "100")
    .option("--groups <json>", "Groups as JSON [{name,weight,params}]")
    .option("--params <json>", "Parameter schema {name: type}")
    .option("--targeting-gate <name>", "Targeting gate name")
    .option("--salt <s>", "Override hash salt")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const defaultGroups = [
          { name: "control", weight: 5000, params: {} },
          { name: "test", weight: 5000, params: {} },
        ];
        const data = await api.experiments.create({
          name,
          universe: opts.universe,
          allocation_pct: Math.round(Number(opts.allocation) * 100),
          groups: opts.groups ? JSON.parse(opts.groups) : defaultGroups,
          params: opts.params ? JSON.parse(opts.params) : {},
          targeting_gate: opts.targetingGate ?? null,
          ...(opts.salt ? { salt: opts.salt } : {}),
        });
        if (opts.json) return printJson(data);
        console.log(`Created experiment: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  exp
    .command("update <name>")
    .description("Update an experiment by name")
    .option("--allocation <pct>", "Allocation percentage (0-100)")
    .option("--groups <json>", "Groups as JSON [{name,weight,params}]")
    .option("--params <json>", "Parameter schema {name: type}")
    .option("--targeting-gate <name>", "Targeting gate name (use 'null' to clear)")
    .option("--significance <p>", "Significance threshold (0.0001-0.5)")
    .option("--min-runtime-days <n>", "Minimum runtime in days")
    .option("--min-sample-size <n>", "Minimum sample size")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const e = await api.experiments.resolve(name);
        const patch: Record<string, unknown> = {};
        if (opts.allocation !== undefined)
          patch.allocation_pct = Math.round(Number(opts.allocation) * 100);
        if (opts.groups) patch.groups = JSON.parse(opts.groups);
        if (opts.params) patch.params = JSON.parse(opts.params);
        if (opts.targetingGate !== undefined)
          patch.targeting_gate = opts.targetingGate === "null" ? null : opts.targetingGate;
        if (opts.significance !== undefined)
          patch.significance_threshold = Number(opts.significance);
        if (opts.minRuntimeDays !== undefined) patch.min_runtime_days = Number(opts.minRuntimeDays);
        if (opts.minSampleSize !== undefined) patch.min_sample_size = Number(opts.minSampleSize);
        const data = await api.experiments.update(e.id, patch);
        if (opts.json) return printJson(data);
        console.log(`Updated experiment: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  exp
    .command("delete <name>")
    .description("Delete an experiment by name")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const e = await api.experiments.resolve(name);
        await api.experiments.delete(e.id);
        console.log(`Deleted: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  exp
    .command("start <name>")
    .description("Start an experiment")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const e = await api.experiments.resolve(name);
        await api.experiments.start(e.id);
        console.log(`Started: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  exp
    .command("stop <name>")
    .description("Stop a running experiment")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const e = await api.experiments.resolve(name);
        await api.experiments.stop(e.id);
        console.log(`Stopped: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  exp
    .command("archive <name>")
    .description("Archive a stopped experiment")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const e = await api.experiments.resolve(name);
        await api.experiments.archive(e.id);
        console.log(`Archived: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  exp
    .command("reanalyze <name>")
    .description("Re-run analysis pass for an experiment")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const e = await api.experiments.resolve(name);
        await api.experiments.reanalyze(e.id);
        console.log(`Reanalyzed: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  exp
    .command("status <name>")
    .description("Show experiment status and latest results")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project);
        const e = await api.experiments.resolve(name);

        const results = await api.experiments.results(e.id).catch(() => [] as ExperimentResult[]);

        if (opts.json) return printJson({ experiment: e, results });

        console.log(`\nExperiment: ${name}`);
        console.log(`Status:     ${statusColor(e.status)}`);
        console.log(`Universe:   ${e.universe}`);
        console.log(`Allocation: ${((e.allocationPct ?? 10000) / 100).toFixed(0)}%`);
        console.log(`Verdict:    ${verdict(results)}`);

        if (results.length) {
          console.log("\nLatest results:");
          printTable(
            ["Metric", "Group", "N", "Mean", "Delta %", "p-value"],
            results.map((r) => [
              r.metric,
              r.group_name,
              r.n ?? "—",
              r.mean?.toFixed(4) ?? "—",
              r.delta_pct !== null ? `${(r.delta_pct * 100).toFixed(2)}%` : "—",
              r.p_value?.toFixed(4) ?? "—",
            ]),
          );
        } else {
          console.log("\nNo results yet. Start the experiment and wait for the daily cron.");
        }
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
