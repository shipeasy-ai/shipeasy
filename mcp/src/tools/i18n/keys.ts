import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getApiClient, notAuthenticated, notBound, apiErr, ok } from "../../util/api-client.js";
import { resolveProfileId } from "./profiles.js";
import { scanFiles } from "./scan.js";

interface KeyItem {
  key: string;
  value: string;
  description?: string;
}

interface PushResult {
  added: string[];
  skipped: string[];
  pushed_count: number;
  skipped_count: number;
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
  if (!client.bound) return notBound(client);

  const profileId = await resolveProfileId(input.profile).catch(() => null);
  if (!profileId)
    return apiErr(
      `Profile '${input.profile}' not found. Create it first with i18n_create_profile.`,
    );

  // chunkedKeys holds one batch per chunk. When the caller pushes a flat file
  // or overrides `chunk`, we funnel everything into a single entry.
  let chunkedKeys: Array<{ chunk: string; keys: KeyItem[] }>;
  try {
    if (input.source === "codemod") {
      const reviewPath = join(input.path ?? process.cwd(), "i18n-codemod-review.json");
      if (!existsSync(reviewPath)) {
        return apiErr(
          `i18n-codemod-review.json not found at ${reviewPath}. Run i18n_codemod_apply first.`,
        );
      }
      const raw = JSON.parse(await readFile(reviewPath, "utf8")) as
        | Record<string, string>
        | { version?: number; chunks?: Record<string, Record<string, string>> };

      if (raw && typeof raw === "object" && "chunks" in raw && raw.chunks) {
        // v2: pre-grouped chunks from the chunk-aware codemod.
        const chunksMap = raw.chunks as Record<string, Record<string, string>>;
        chunkedKeys = Object.entries(chunksMap).map(([chunk, kv]) => ({
          chunk: input.chunk ?? chunk,
          keys: Object.entries(kv).map(([k, v]) => ({ key: k, value: v as string })),
        }));
      } else {
        // Legacy flat format.
        const flat = raw as Record<string, string>;
        chunkedKeys = [
          {
            chunk: input.chunk ?? "default",
            keys: Object.entries(flat).map(([k, v]) => ({ key: k, value: v })),
          },
        ];
      }
    } else if (input.file) {
      const raw = JSON.parse(await readFile(input.file, "utf8")) as Record<string, string>;
      chunkedKeys = [
        {
          chunk: input.chunk ?? "default",
          keys: Object.entries(raw).map(([k, v]) => ({ key: k, value: v })),
        },
      ];
    } else {
      return apiErr("Provide either 'source: \"codemod\"' or a 'file' path.");
    }
  } catch (err) {
    return apiErr(`Failed to read keys: ${String(err)}`);
  }

  try {
    // Insert-only push: the server adds keys that don't exist yet and returns
    // them under `added`; keys that already exist are returned under `skipped`
    // and left untouched (push never overwrites a live value).
    const added: string[] = [];
    const skipped: string[] = [];
    const chunkSummary: Record<string, number> = {};

    for (const group of chunkedKeys) {
      if (group.keys.length === 0) continue;
      const result = await pushBatch(client, profileId, group.chunk, group.keys);
      if (Array.isArray(result.added)) added.push(...result.added);
      if (Array.isArray(result.skipped)) skipped.push(...result.skipped);
      chunkSummary[group.chunk] = (chunkSummary[group.chunk] ?? 0) + group.keys.length;
    }

    return ok({
      added,
      skipped,
      pushed_count: added.length,
      skipped_count: skipped.length,
      chunks: chunkSummary,
      note:
        skipped.length > 0
          ? "Existing keys were left unchanged — push only adds new keys. To change a value, " +
            "update one key at a time via the dashboard or `shipeasy i18n update <key> <value>`."
          : undefined,
    });
  } catch (err) {
    return apiErr(err);
  }
}

// One-shot "set a string and ship it". Upserts one key's value into a profile
// and immediately publishes the whole profile (KV rebuild + CDN purge), so the
// new value is live in a single call. Unlike i18n_create_key/i18n_push_keys
// (insert-only — existing keys come back as `skipped`), this overwrites; and
// unlike them, it auto-publishes. The server resolves the profile by name, or —
// when `profile` is omitted — targets the project's default-marked profile, so
// no client-side profile lookup is needed here.
export async function handleSetLabel(input: {
  key: string;
  value: string;
  profile?: string;
  description?: string;
}) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();
  if (!client.bound) return notBound(client);

  try {
    const result = await client.post("/api/admin/i18n/set", {
      key: input.key,
      value: input.value,
      ...(input.profile !== undefined ? { profile: input.profile } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    });
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
  if (!client.bound) return notBound(client);

  const profileId = await resolveProfileId(input.profile).catch(() => null);
  if (!profileId) return apiErr(`Profile '${input.profile}' not found.`);

  try {
    const result = await pushBatch(client, profileId, input.chunk ?? "default", [
      { key: input.key, value: input.value, description: input.description },
    ]);
    // Insert-only: a key that already exists comes back under `skipped`.
    const created = Array.isArray(result.added) && result.added.includes(input.key);
    return ok({
      ...result,
      created,
      note: created
        ? undefined
        : `Key '${input.key}' already exists and was left unchanged — create/push never ` +
          "overwrites. Change its value one key at a time via the dashboard or " +
          "`shipeasy i18n update <key> <value>`.",
    });
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
