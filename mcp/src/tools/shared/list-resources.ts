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
  | "sdk_keys"
  | "all";

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

export async function handleListResources(input: { kind: Kind; search?: string; limit?: number }) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();

  if (input.kind === "all") {
    return apiErr("kind 'all' is not yet supported — specify a single kind.");
  }

  const path = KIND_PATH[input.kind];
  if (!path) return apiErr(`Unknown kind: ${input.kind}`);

  try {
    let rows = await client.get<unknown[]>(path);
    if (input.search) {
      const q = input.search.toLowerCase();
      rows = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
    }
    if (input.limit) rows = rows.slice(0, input.limit);
    return ok({ kind: input.kind, count: rows.length, items: rows });
  } catch (err) {
    return apiErr(err);
  }
}
