import { Command } from "commander";
import { getApiClient, ApiError } from "../api/client";
import { printTable, printJson, statusColor } from "../util/output";

interface Experiment {
  id: string;
  name: string;
  status: string;
  universe: string;
  allocationPct: number;
  updatedAt?: string;
}

async function listExperiments(client: ReturnType<typeof getApiClient>): Promise<Experiment[]> {
  return client.request<Experiment[]>("GET", "/api/admin/experiments");
}

async function findExperiment(
  client: ReturnType<typeof getApiClient>,
  name: string,
): Promise<Experiment> {
  const all = await listExperiments(client);
  const e = all.find((x) => x.name === name);
  if (!e) throw new ApiError(`Experiment '${name}' not found`, 404);
  return e;
}

interface ExperimentResult {
  metric: string;
  group_name: string;
  ds: string;
  n: number | null;
  mean: number | null;
  delta_pct: number | null;
  p_value: number | null;
  srm_detected: number | null;
}

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
        const client = getApiClient(opts.project);
        const experiments = await listExperiments(client);
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
        const client = getApiClient(opts.project);
        const defaultGroups = [
          { name: "control", weight: 5000, params: {} },
          { name: "test", weight: 5000, params: {} },
        ];
        const body: Record<string, unknown> = {
          name,
          universe: opts.universe,
          allocation_pct: Math.round(Number(opts.allocation) * 100),
          groups: opts.groups ? JSON.parse(opts.groups) : defaultGroups,
          params: opts.params ? JSON.parse(opts.params) : {},
          status: "draft",
        };
        if (opts.targetingGate) body.targeting_gate = opts.targetingGate;
        if (opts.salt) body.salt = opts.salt;
        const data = await client.request("POST", "/api/admin/experiments", body);
        if (opts.json) return printJson(data);
        console.log(`Created experiment: ${name}`);
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
        const client = getApiClient(opts.project);
        const e = await findExperiment(client, name);
        await client.request("POST", `/api/admin/experiments/${e.id}/status`, {
          status: "running",
        });
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
        const client = getApiClient(opts.project);
        const e = await findExperiment(client, name);
        await client.request("POST", `/api/admin/experiments/${e.id}/status`, {
          status: "stopped",
        });
        console.log(`Stopped: ${name}`);
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
        const client = getApiClient(opts.project);
        const e = await findExperiment(client, name);

        const resultsData = await client
          .request<{ results: ExperimentResult[] }>("GET", `/api/admin/experiments/${e.id}/results`)
          .catch(() => ({ results: [] as ExperimentResult[] }));

        if (opts.json) return printJson({ experiment: e, results: resultsData.results });

        console.log(`\nExperiment: ${name}`);
        console.log(`Status:     ${statusColor(e.status)}`);
        console.log(`Universe:   ${e.universe}`);
        console.log(`Allocation: ${((e.allocationPct ?? 10000) / 100).toFixed(0)}%`);
        console.log(`Verdict:    ${verdict(resultsData.results)}`);

        if (resultsData.results.length) {
          console.log("\nLatest results:");
          printTable(
            ["Metric", "Group", "N", "Mean", "Delta %", "p-value"],
            resultsData.results.map((r) => [
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
