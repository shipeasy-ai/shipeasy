import { createClient, createClientConfig, type Client } from "@shipeasy/openapi/client";
import { readConfig, type ShipeasyConfig } from "../auth/config.js";
import { getBoundProjectIdSync } from "../util/project-config.js";

/**
 * Runtime the generated tool tree (`src/generated/tools.gen.ts`) is wired
 * against — the MCP twin of the CLI's `src/commands/_gen-runtime.ts`. The
 * generated file is pure projection from the spec; all behaviour (client
 * construction, unwrapping the hey-api result, the binding guard) lives here so
 * it is hand-written and testable.
 *
 * The admin API authenticates the CLI/MCP token via the `X-SDK-Key` header (not
 * bearer) and scopes every request with `X-Project-Id`, exactly like the CLI.
 */

/** Uniform admin-API error thrown by `unwrap` and the custom ops. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** hey-api's result envelope (`response` is absent on a network failure). */
export type SdkResult = { data?: unknown; error?: unknown; response?: Response };

/** Throw `ApiError` on a non-2xx / network failure; otherwise return `data`. */
export function unwrap(result: SdkResult): unknown {
  const { data, error, response } = result;
  if (error || !response || !response.ok) {
    const body = error as { error?: string; code?: string } | undefined;
    const status = response?.status ?? 0;
    throw new ApiError(body?.error ?? `HTTP ${status}`, status, body?.code);
  }
  return data;
}

/**
 * Drop undefined keys (so omitted args don't send `undefined`) and erase the
 * static type: the body/query is assembled from runtime tool arguments, which
 * can't be statically reconciled with the strict generated request types — the
 * server (and the generated zod) validate it. Returns `never` so it satisfies
 * any sdk-fn body/query parameter.
 */
export function clean(obj: Record<string, unknown>): never {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as unknown as never;
}

export interface ClientHandle {
  client: Client;
  cfg: ShipeasyConfig;
  /** Effective project_id used for `X-Project-Id` (binding-resolved). */
  projectId: string;
  /** True if a `.shipeasy` file in cwd (or an ancestor) supplied project_id. */
  bound: boolean;
}

/**
 * Resolve credentials + project scope and return a configured generated client
 * (`@shipeasy/openapi/client`). Returns `null` when not authenticated; the
 * server then returns `notAuthenticated()`. Mutating tools additionally require
 * a `.shipeasy` binding — the server enforces that with `GENERATED_MUTATES`.
 */
export async function getGeneratedClient(): Promise<ClientHandle | null> {
  const cfg = await readConfig();
  if (!cfg) return null;
  const bound = getBoundProjectIdSync(process.cwd());
  const projectId = bound ?? cfg.project_id;
  const client = createClient(
    createClientConfig({
      baseUrl: cfg.app_base_url.replace(/\/$/, ""),
      headers: { "X-SDK-Key": cfg.cli_token, "X-Project-Id": projectId },
    }),
  );
  return { client, cfg, projectId, bound: !!bound };
}
