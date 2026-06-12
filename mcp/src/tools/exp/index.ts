import {
  getAdminClient,
  getApiClient,
  notAuthenticated,
  notBound,
  apiErr,
  ok,
} from "../../util/api-client.js";

export async function handleCreateGate(input: {
  name: string;
  description?: string;
  rollout?: number;
  rules?: string;
}) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const result = await handle.client.gates.create({
      name: input.name,
      rollout_pct: Math.round((input.rollout ?? 0) * 100),
      rules: input.rules ? JSON.parse(input.rules) : [],
    });
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleUpdateGate(input: {
  name: string;
  rollout?: number;
  rules?: string;
  enabled?: boolean;
}) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const gate = await handle.client.gates.resolve(input.name);
    const patch: Record<string, unknown> = {};
    if (input.rollout !== undefined) patch.rollout_pct = Math.round(input.rollout * 100);
    if (input.rules !== undefined) patch.rules = JSON.parse(input.rules);
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    const result = await handle.client.gates.update(gate.id, patch);
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleCreateKillswitch(input: {
  name: string;
  description?: string;
  value?: boolean;
  switches?: string;
}) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const switches = input.switches
      ? (JSON.parse(input.switches) as Record<string, boolean>)
      : undefined;
    const result = await handle.client.killswitches.create({
      name: input.name,
      description: input.description,
      value: input.value ?? false,
      switches,
    });
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleUpdateKillswitch(input: {
  name: string;
  value?: boolean;
  switches?: string;
  description?: string | null;
}) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const k = await handle.client.killswitches.resolve(input.name);
    const patch: Record<string, unknown> = {};
    if (input.value !== undefined) patch.value = input.value;
    if (input.switches !== undefined) patch.switches = JSON.parse(input.switches);
    if (input.description !== undefined) patch.description = input.description;
    const result = await handle.client.killswitches.update(k.id, patch);
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleDeleteKillswitch(input: { name: string }) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const k = await handle.client.killswitches.resolve(input.name);
    await handle.client.killswitches.delete(k.id);
    return ok({ ok: true, deleted: input.name });
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleSetKillswitchSwitch(input: {
  name: string;
  env: "dev" | "staging" | "prod";
  switch_key: string;
  value: boolean;
}) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const k = await handle.client.killswitches.resolve(input.name);
    const result = await handle.client.killswitches.setSwitch(k.id, {
      env: input.env,
      switchKey: input.switch_key,
      value: input.value,
    });
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleUnsetKillswitchSwitch(input: {
  name: string;
  env: "dev" | "staging" | "prod";
  switch_key: string;
}) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const k = await handle.client.killswitches.resolve(input.name);
    const result = await handle.client.killswitches.unsetSwitch(k.id, {
      env: input.env,
      switchKey: input.switch_key,
    });
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleDeleteGate(input: { name: string }) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const gate = await handle.client.gates.resolve(input.name);
    await handle.client.gates.delete(gate.id);
    return ok({ ok: true, deleted: input.name });
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleCreateConfig(input: {
  name: string;
  value?: string;
  schema?: string;
  description?: string;
}) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const schema = input.schema
      ? JSON.parse(input.schema)
      : { type: "object", properties: {}, additionalProperties: true };
    const value = input.value ? JSON.parse(input.value) : {};
    const result = await handle.client.configs.create({
      name: input.name,
      schema,
      value,
      ...(input.description ? { description: input.description } : {}),
    });
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleUpdateConfig(input: { name: string; value: string }) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const cfg = await handle.client.configs.resolve(input.name);
    const result = await handle.client.configs.update(cfg.id, {
      value: JSON.parse(input.value),
    });
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleDeleteConfig(input: { name: string }) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const cfg = await handle.client.configs.resolve(input.name);
    await handle.client.configs.delete(cfg.id);
    return ok({ ok: true, deleted: input.name });
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleCreateUniverse(input: {
  name: string;
  unit_type?: string;
  holdout_range?: string;
}) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const result = await handle.client.universes.create({
      name: input.name,
      unit_type: input.unit_type ?? "user_id",
      holdout_range: parseHoldoutRange(input.holdout_range),
    });
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleUpdateUniverse(input: { name: string; holdout_range?: string }) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const u = await handle.client.universes.resolve(input.name);
    const patch: Record<string, unknown> = {};
    if (input.holdout_range !== undefined) {
      patch.holdout_range = parseHoldoutRange(input.holdout_range);
    }
    const result = await handle.client.universes.update(u.id, patch);
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleDeleteUniverse(input: { name: string }) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const u = await handle.client.universes.resolve(input.name);
    await handle.client.universes.delete(u.id);
    return ok({ ok: true, deleted: input.name });
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
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);

  const defaultGroups = [
    { name: "control", weight: 5000, params: {} },
    { name: "treatment", weight: 5000, params: {} },
  ];
  const groups = input.groups ? JSON.parse(input.groups) : defaultGroups;

  try {
    const result = await handle.client.experiments.create({
      name: input.name,
      universe: input.universe,
      allocation_pct: Math.round((input.allocation ?? 10) * 100),
      groups,
      params: (input.params_schema ?? {}) as Record<string, "string" | "bool" | "number">,
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

export async function handleUpdateExperiment(input: {
  name: string;
  allocation?: number;
  groups?: string;
  targeting_gate?: string | null;
  significance_threshold?: number;
  min_runtime_days?: number;
  min_sample_size?: number;
}) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const e = await handle.client.experiments.resolve(input.name);
    const patch: Record<string, unknown> = {};
    if (input.allocation !== undefined) patch.allocation_pct = Math.round(input.allocation * 100);
    if (input.groups) patch.groups = JSON.parse(input.groups);
    // "" / omit = leave unchanged; the literal "none" clears the gate — the
    // only way to remove targeting via the API (QA R2-10).
    if (input.targeting_gate !== undefined && input.targeting_gate !== "") {
      patch.targeting_gate = input.targeting_gate === "none" ? null : input.targeting_gate;
    }
    if (input.significance_threshold !== undefined)
      patch.significance_threshold = input.significance_threshold;
    if (input.min_runtime_days !== undefined) patch.min_runtime_days = input.min_runtime_days;
    if (input.min_sample_size !== undefined) patch.min_sample_size = input.min_sample_size;
    const result = await handle.client.experiments.update(e.id, patch);
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleDeleteExperiment(input: { name: string }) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const e = await handle.client.experiments.resolve(input.name);
    await handle.client.experiments.delete(e.id);
    return ok({ ok: true, deleted: input.name });
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleStartExperiment(input: { name: string }) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const e = await handle.client.experiments.resolve(input.name);
    const result = await handle.client.experiments.start(e.id);
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleStopExperiment(input: { name: string; promote_group?: string }) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const e = await handle.client.experiments.resolve(input.name);
    const result = await handle.client.experiments.stop(e.id);
    return ok({
      ...(result as object),
      ...(input.promote_group
        ? {
            promote_group_note: `Manual promotion needed: promote group '${input.promote_group}' in the dashboard or via PATCH /api/admin/experiments/${e.id}.`,
          }
        : {}),
    });
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleExperimentStatus(input: { name: string }) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  try {
    const exp = await handle.client.experiments.resolve(input.name);
    const [detail, results] = await Promise.all([
      handle.client.experiments.get(exp.id),
      handle.client.experiments.results(exp.id),
    ]);

    if (detail.status !== "running") {
      return ok({ verdict: "not_running", status: detail.status, experiment: detail });
    }

    if (!results || results.length === 0) {
      return ok({ verdict: "wait", reason: "no data yet", experiment: detail });
    }

    const withP = results.filter((r) => r.p_value !== null) as ((typeof results)[number] & {
      p_value: number;
    })[];
    if (withP.length === 0) {
      return ok({ verdict: "wait", reason: "no p-values yet", experiment: detail });
    }
    const best = withP.reduce((a, b) => (a.p_value < b.p_value ? a : b));

    let verdict: string;
    const threshold = detail.significance_threshold ?? 0.05;
    if (best.p_value < threshold) {
      verdict = "ship";
    } else {
      const startedAt = detail.startedAt ?? detail.started_at;
      const daysRunning = startedAt
        ? (Date.now() - new Date(startedAt).getTime()) / (1000 * 60 * 60 * 24)
        : 0;
      verdict = daysRunning < (detail.min_runtime_days ?? 0) ? "wait" : "hold";
    }

    return ok({ verdict, best_result: best, all_results: results, experiment: detail });
  } catch (err) {
    return apiErr(err);
  }
}

function parseHoldoutRange(raw: string | undefined): [number, number] | null {
  if (raw === undefined || raw === "" || raw === "null") return null;
  const [loRaw, hiRaw] = raw.split(",").map((s) => s.trim());
  const lo = Number(loRaw);
  const hi = Number(hiRaw);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    throw new Error("holdout_range must be 'lo,hi' integers in [0,9999]");
  }
  return [lo, hi];
}

// ────────────────────────────── alert rules ──────────────────────────────

interface MetricRow {
  id: string;
  name: string;
}

/** Resolve a metric by exact id, unique id-prefix, or exact (unique) name. */
async function resolveMetricId(idOrName: string): Promise<string> {
  const client = await getApiClient();
  if (!client) throw new Error("Not authenticated");
  const rows = await client.get<MetricRow[]>("/api/admin/metrics");
  const byId = rows.find((m) => m.id === idOrName);
  if (byId) return byId.id;
  const byPrefix = rows.filter((m) => m.id.startsWith(idOrName));
  if (byPrefix.length === 1) return byPrefix[0].id;
  if (byPrefix.length > 1) throw new Error(`Metric id prefix '${idOrName}' is ambiguous`);
  const byName = rows.filter((m) => m.name === idOrName);
  if (byName.length === 1) return byName[0].id;
  if (byName.length > 1) throw new Error(`Metric name '${idOrName}' is ambiguous — pass a metric id`);
  throw new Error(`Metric '${idOrName}' not found`);
}

export async function handleCreateAlertRule(input: {
  name: string;
  metric: string;
  comparator: "gt" | "gte" | "lt" | "lte";
  threshold: number;
  window_hours?: number;
  severity?: "danger" | "warn" | "info";
  enabled?: boolean;
}) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const metricId = await resolveMetricId(input.metric);
    const result = await handle.client.alertRules.create({
      name: input.name,
      metricId,
      comparator: input.comparator,
      threshold: input.threshold,
      windowHours: input.window_hours ?? 24,
      severity: input.severity ?? "warn",
      enabled: input.enabled ?? true,
    });
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleUpdateAlertRule(input: {
  id: string;
  name?: string;
  comparator?: "gt" | "gte" | "lt" | "lte";
  threshold?: number;
  window_hours?: number;
  severity?: "danger" | "warn" | "info";
  enabled?: boolean;
}) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const rule = await handle.client.alertRules.resolve(input.id);
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.comparator !== undefined) patch.comparator = input.comparator;
    if (input.threshold !== undefined) patch.threshold = input.threshold;
    if (input.window_hours !== undefined) patch.windowHours = input.window_hours;
    if (input.severity !== undefined) patch.severity = input.severity;
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (Object.keys(patch).length === 0) {
      return apiErr("Nothing to update — pass at least one field to change.");
    }
    const result = await handle.client.alertRules.update(rule.id, patch);
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleDeleteAlertRule(input: { id: string }) {
  const handle = await getAdminClient();
  if (!handle) return notAuthenticated();
  if (!handle.bound) return notBound(handle);
  try {
    const rule = await handle.client.alertRules.resolve(input.id);
    await handle.client.alertRules.delete(rule.id);
    return ok({ ok: true, deleted: rule.id });
  } catch (err) {
    return apiErr(err);
  }
}
