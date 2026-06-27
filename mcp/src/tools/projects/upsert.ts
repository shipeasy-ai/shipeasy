import { getApiClient, notAuthenticated, apiErr, ok } from "../../util/api-client.js";
import { bindProjectSync } from "../../util/project-config.js";

interface UpsertResult {
  id: string;
  name: string;
  domain: string | null;
  owner_email: string;
  created: boolean;
}

/**
 * Find-or-create a project keyed by `(owner_email, domain)`. Domain is the
 * primary identity of a project for install purposes — running this tool
 * twice with the same domain is a no-op.
 *
 * Unlike every other write tool, this one does NOT require a `.shipeasy`
 * binding — the whole point is to bootstrap a binding in a fresh repo
 * before any other tool can run. After upserting, it writes `.shipeasy` at
 * the supplied `path` (or cwd) unless `bind: false` is passed.
 */
export async function handleUpsertProject(input: {
  domain: string;
  name?: string;
  path?: string;
  bind?: boolean;
}) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();

  try {
    const result = await client.post<UpsertResult>("/api/admin/projects/upsert", {
      domain: input.domain,
      ...(input.name ? { name: input.name } : {}),
    });

    let bindResult: { path: string; created: boolean } | null = null;
    if (input.bind !== false) {
      const dir = input.path ?? process.cwd();
      bindResult = bindProjectSync(dir, result.id, result.name);
    }

    return ok({
      ...result,
      ...(bindResult
        ? {
            bind: {
              wrote: bindResult.path,
              created_file: bindResult.created,
              note: "Commit .shipeasy to your repo so teammates and CI agree on the project.",
            },
          }
        : {}),
    });
  } catch (err) {
    return apiErr(err);
  }
}
