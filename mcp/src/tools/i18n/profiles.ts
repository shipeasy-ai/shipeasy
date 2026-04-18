import { getApiClient, notAuthenticated, apiErr, ok } from "../../util/api-client.js";

interface Profile {
  id: string;
  name: string;
  createdAt: string;
}

export async function handleCreateProfile(input: { name: string }) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();
  try {
    const result = await client.post<Profile>("/api/admin/i18n/profiles", { name: input.name });
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function listProfiles(): Promise<Profile[]> {
  const client = await getApiClient();
  if (!client) return [];
  return client.get<Profile[]>("/api/admin/i18n/profiles");
}

export async function resolveProfileId(nameOrId: string): Promise<string | null> {
  if (nameOrId.match(/^[0-9a-f-]{36}$/i)) return nameOrId;
  const profiles = await listProfiles();
  return profiles.find((p) => p.name === nameOrId)?.id ?? null;
}
