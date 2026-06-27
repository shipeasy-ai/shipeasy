import {
  getAdminClient,
  getApiClient,
  notAuthenticated,
  notBound,
  apiErr,
  ok,
} from "../../util/api-client.js";

// Build the inline goal-metric query (metric DSL) the admin API auto-upserts on
// create/update. `success_aggregation` names the reducer; the API derives the
// event + metric from the DSL string and attaches it with role=goal — which is
// what makes the experiment startable. `count`/`count_users`/`retention_Nd`
// need only the event; `sum`/`avg` also need `success_value` (the numeric event
// property to reduce over). Mirrors the metric DSL grammar in @shipeasy/query-dsl
// (note: count_events renders as `count(...)`).
// ────────────────────────────── alert rules ──────────────────────────────

interface MetricRow {
  id: string;
  name: string;
}

/** snake_case MCP notify input (`slack_channel`) → API `notify` (`slackChannel`). */
type NotifyInput = {
  slack_channel?: { id: string; name: string } | null;
  email?: string | null;
};
function mapNotify(notify: NotifyInput | undefined) {
  if (!notify) return undefined;
  return {
    slackChannel: notify.slack_channel ?? null,
    email: notify.email ?? null,
  };
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
  notify?: NotifyInput;
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
      notify: mapNotify(input.notify),
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
  notify?: NotifyInput;
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
    if (input.notify !== undefined) patch.notify = mapNotify(input.notify);
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
