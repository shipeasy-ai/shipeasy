import { getApiClient, notAuthenticated, apiErr, ok } from "../../util/api-client.js";

type Kind =
  | "gates"
  | "configs"
  | "experiments"
  | "events"
  | "metrics"
  | "universes"
  | "attributes"
  | "profiles"
  | "chunks"
  | "keys"
  | "drafts"
  | "sdk_keys";

const KIND_PATH: Partial<Record<Kind, string>> = {
  gates: "/api/admin/gates",
  configs: "/api/admin/configs",
  experiments: "/api/admin/experiments",
  events: "/api/admin/events",
  metrics: "/api/admin/metrics",
  universes: "/api/admin/universes",
  attributes: "/api/admin/attributes",
  profiles: "/api/admin/i18n/profiles",
  keys: "/api/admin/i18n/keys",
  drafts: "/api/admin/i18n/drafts",
  sdk_keys: "/api/admin/keys",
};

export async function handleGetResource(input: { kind: string; name_or_id: string }) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();

  const path = KIND_PATH[input.kind as Kind];
  if (!path) return apiErr(`Unknown kind: ${input.kind}`);

  try {
    const list =
      await client.get<Array<{ id?: string; name?: string } & Record<string, unknown>>>(path);
    const item = list.find((r) => r.id === input.name_or_id || r.name === input.name_or_id);
    if (!item) return apiErr(`Not found: ${input.kind} '${input.name_or_id}'`);
    return ok(item);
  } catch (err) {
    return apiErr(err);
  }
}
