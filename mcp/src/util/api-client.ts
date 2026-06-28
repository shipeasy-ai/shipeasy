import { ApiError } from "../tools/_gen-runtime.js";
import { readConfig, type ShipeasyConfig } from "../auth/config.js";
import { getBoundProjectIdSync } from "./project-config.js";

export { ApiError };

export interface ApiClient {
  get<T>(path: string, query?: Record<string, string>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
  cfg: ShipeasyConfig;
  /** Effective project_id used for `X-Project-Id` (binding-resolved). */
  projectId: string;
  /** True if a `.shipeasy` file in cwd (or an ancestor) supplied project_id. */
  bound: boolean;
}

export async function getApiClient(): Promise<ApiClient | null> {
  const cfg = await readConfig();
  if (!cfg) return null;
  const _cfg = cfg;

  const bound = getBoundProjectIdSync(process.cwd());
  const projectId = bound ?? _cfg.project_id;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<T> {
    const url = new URL(`${_cfg.app_base_url.replace(/\/$/, "")}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), {
      method,
      headers: {
        "X-SDK-Key": _cfg.cli_token,
        "Content-Type": "application/json",
        "X-Project-Id": projectId,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(json.error ?? `HTTP ${res.status} from ${path}`, res.status);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  return {
    cfg: _cfg,
    projectId,
    bound: !!bound,
    get: <T>(path: string, query?: Record<string, string>) =>
      request<T>("GET", path, undefined, query),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    del: <T>(path: string) => request<T>("DELETE", path),
  };
}

export function notAuthenticated() {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: "Not authenticated. Run `shipeasy auth login` in the terminal first.",
      },
    ],
  };
}

/**
 * Returned by mutating tools when the cwd has no `.shipeasy` binding. MCP
 * tools have no `--project` flag and run from the user's editor cwd, so the
 * only safe thing to do is refuse and tell the user how to bind. Mirrors
 * the CLI's `requireBinding` enforcement in `packages/cli/src/api/client.ts`.
 */
export function notBound(client: { cfg: ShipeasyConfig }) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text:
          `This MCP tool writes to a Shipeasy project, but the working directory ` +
          `is not bound to one. Run \`shipeasy bind ${client.cfg.project_id}\` ` +
          `in the project root to bind it (writes a .shipeasy file). ` +
          `Reads continue to work without binding.`,
      },
    ],
  };
}

export function apiErr(err: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: String(err) }],
  };
}

export function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
