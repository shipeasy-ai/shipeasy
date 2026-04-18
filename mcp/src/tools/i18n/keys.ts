import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getApiClient, notAuthenticated, apiErr, ok } from "../../util/api-client.js";
import { resolveProfileId } from "./profiles.js";
import { scanFiles } from "./scan.js";

interface KeyItem {
  key: string;
  value: string;
  description?: string;
}

interface PushResult {
  pushed_count: number;
  skipped_count: number;
  failed_keys: string[];
}

async function pushBatch(
  client: Awaited<ReturnType<typeof getApiClient>>,
  profileId: string,
  chunk: string,
  keys: KeyItem[],
) {
  if (!client) throw new Error("not authenticated");
  return client.post<PushResult>("/api/admin/i18n/keys", { profile_id: profileId, chunk, keys });
}

export async function handlePushKeys(input: {
  profile: string;
  chunk?: string;
  file?: string;
  source?: string;
  path?: string;
}) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();

  const profileId = await resolveProfileId(input.profile).catch(() => null);
  if (!profileId)
    return apiErr(
      `Profile '${input.profile}' not found. Create it first with i18n_create_profile.`,
    );

  const chunk = input.chunk ?? "default";

  let keys: KeyItem[];
  try {
    if (input.source === "codemod") {
      const reviewPath = join(input.path ?? process.cwd(), "i18n-codemod-review.json");
      if (!existsSync(reviewPath)) {
        return apiErr(
          `i18n-codemod-review.json not found at ${reviewPath}. Run i18n_codemod_apply first.`,
        );
      }
      const raw = JSON.parse(await readFile(reviewPath, "utf8")) as Record<string, string>;
      keys = Object.entries(raw).map(([k, v]) => ({ key: k, value: v }));
    } else if (input.file) {
      const raw = JSON.parse(await readFile(input.file, "utf8")) as Record<string, string>;
      keys = Object.entries(raw).map(([k, v]) => ({ key: k, value: v }));
    } else {
      return apiErr("Provide either 'source: \"codemod\"' or a 'file' path.");
    }
  } catch (err) {
    return apiErr(`Failed to read keys: ${String(err)}`);
  }

  try {
    const result = await pushBatch(client, profileId, chunk, keys);
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleCreateKey(input: {
  profile: string;
  key: string;
  value: string;
  description?: string;
  chunk?: string;
}) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();

  const profileId = await resolveProfileId(input.profile).catch(() => null);
  if (!profileId) return apiErr(`Profile '${input.profile}' not found.`);

  try {
    const result = await pushBatch(client, profileId, input.chunk ?? "default", [
      { key: input.key, value: input.value, description: input.description },
    ]);
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleValidateKeys(input: { paths?: string[]; profile?: string }) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();

  const scanPaths = input.paths ?? [process.cwd()];

  // Collect keys referenced in code
  const candidates = await scanFiles(scanPaths, { keysOnly: true });
  const referencedKeys = new Set(
    candidates.flatMap((c) => (c.suggested_key ? [c.suggested_key] : [])),
  );

  if (referencedKeys.size === 0) {
    return ok({ status: "ok", message: "No i18n key references found in code.", missing_keys: [] });
  }

  // Fetch keys from API
  let remoteKeys: Set<string>;
  try {
    const profileId = input.profile
      ? await resolveProfileId(input.profile).catch(() => null)
      : null;
    const query = profileId ? { profile_id: profileId } : {};
    const rows = await client.get<{ key: string }[]>(
      "/api/admin/i18n/keys",
      query as Record<string, string>,
    );
    remoteKeys = new Set(rows.map((r) => r.key));
  } catch (err) {
    return apiErr(`Failed to fetch remote keys: ${String(err)}`);
  }

  const missing = [...referencedKeys].filter((k) => !remoteKeys.has(k));

  return ok({
    status: missing.length === 0 ? "ok" : "fail",
    checked: referencedKeys.size,
    missing_keys: missing,
    message:
      missing.length === 0
        ? `All ${referencedKeys.size} referenced keys exist in the profile.`
        : `${missing.length} key(s) referenced in code are missing from the profile.`,
  });
}
