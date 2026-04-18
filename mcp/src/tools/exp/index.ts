import { getApiClient, notAuthenticated, apiErr, ok } from "../../util/api-client.js";

interface Experiment {
  id: string;
  name: string;
  status: string;
  significance_threshold: number;
  min_runtime_days: number;
  started_at?: string;
}

interface ExperimentResult {
  group: string;
  p_value: number;
  [key: string]: unknown;
}

async function findExperimentByName(
  client: NonNullable<Awaited<ReturnType<typeof getApiClient>>>,
  name: string,
): Promise<Experiment | null> {
  const list = await client.get<Experiment[]>("/api/admin/experiments");
  return list.find((e) => e.name === name) ?? null;
}

export async function handleCreateGate(input: {
  name: string;
  description?: string;
  rollout?: number;
  rules?: string;
  killswitch?: boolean;
}) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();
  try {
    const result = await client.post("/api/admin/gates", {
      name: input.name,
      rollout_pct: Math.round((input.rollout ?? 0) * 100),
      rules: JSON.parse(input.rules ?? "[]"),
      killswitch: input.killswitch ?? false,
    });
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleCreateConfig(input: { name: string; value: string }) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();
  try {
    const result = await client.post("/api/admin/configs", {
      name: input.name,
      value: JSON.parse(input.value),
    });
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleCreateExperiment(input: {
  name: string;
  description?: string;
  universe: string;
  allocation?: number;
  groups?: string;
  params_schema?: object;
  targeting_gate?: string;
  success_event?: string;
  success_aggregation?: string;
}) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();

  const defaultGroups = [
    { name: "control", weight: 5000, params: {} },
    { name: "treatment", weight: 5000, params: {} },
  ];
  const groups = input.groups ? JSON.parse(input.groups) : defaultGroups;

  try {
    const result = await client.post("/api/admin/experiments", {
      name: input.name,
      universe: input.universe,
      allocation_pct: Math.round((input.allocation ?? 10) * 100),
      groups,
      params: input.params_schema ?? {},
      targeting_gate: input.targeting_gate ?? null,
      significance_threshold: 0.05,
      min_runtime_days: 0,
      min_sample_size: 100,
      sequential_testing: false,
    });
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleStartExperiment(input: { name: string }) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();
  try {
    const experiment = await findExperimentByName(client, input.name);
    if (!experiment) return apiErr(`Experiment '${input.name}' not found.`);
    const result = await client.post(`/api/admin/experiments/${experiment.id}/status`, {
      status: "running",
    });
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleStopExperiment(input: { name: string; promote_group?: string }) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();
  try {
    const experiment = await findExperimentByName(client, input.name);
    if (!experiment) return apiErr(`Experiment '${input.name}' not found.`);
    const result = await client.post(`/api/admin/experiments/${experiment.id}/status`, {
      status: "stopped",
    });
    return ok({
      ...(result as object),
      ...(input.promote_group
        ? {
            promote_group_note: `Manual promotion needed: promote group '${input.promote_group}' in the dashboard or via PATCH /api/admin/experiments/${experiment.id}.`,
          }
        : {}),
    });
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleExperimentStatus(input: { name: string }) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();
  try {
    const experiment = await findExperimentByName(client, input.name);
    if (!experiment) return apiErr(`Experiment '${input.name}' not found.`);

    const [detail, results] = await Promise.all([
      client.get<Experiment>(`/api/admin/experiments/${experiment.id}`),
      client.get<ExperimentResult[]>(`/api/admin/experiments/${experiment.id}/results`),
    ]);

    if (detail.status !== "running") {
      return ok({ verdict: "not_running", status: detail.status, experiment: detail });
    }

    if (!results || results.length === 0) {
      return ok({ verdict: "wait", reason: "no data yet", experiment: detail });
    }

    // Find the result with the lowest p_value
    const best = results.reduce((a, b) => (a.p_value < b.p_value ? a : b));

    let verdict: string;
    if (best.p_value < detail.significance_threshold) {
      verdict = "ship";
    } else {
      // Calculate days running
      const daysRunning = detail.started_at
        ? (Date.now() - new Date(detail.started_at).getTime()) / (1000 * 60 * 60 * 24)
        : 0;
      verdict = daysRunning < detail.min_runtime_days ? "wait" : "hold";
    }

    return ok({ verdict, best_result: best, all_results: results, experiment: detail });
  } catch (err) {
    return apiErr(err);
  }
}
