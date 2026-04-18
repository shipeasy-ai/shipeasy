import { readConfig, type ShipeasyConfig } from "../auth/config.js";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClient {
  get<T>(path: string, query?: Record<string, string>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
  cfg: ShipeasyConfig;
}

export async function getApiClient(): Promise<ApiClient | null> {
  const cfg = await readConfig();
  if (!cfg) return null;
  const _cfg = cfg;

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
        "X-Project-Id": _cfg.project_id,
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

export function apiErr(err: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: String(err) }],
  };
}

export function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
