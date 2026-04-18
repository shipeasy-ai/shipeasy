import { loadCredentials } from "../auth/storage";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getApiClient(projectOverride?: string) {
  const creds = loadCredentials();
  if (!creds) {
    console.error("Not logged in. Run: shipeasy login");
    process.exit(1);
  }
  const projectId = projectOverride ?? creds.project_id;
  const baseUrl = creds.app_base_url.replace(/\/$/, "");

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "X-SDK-Key": creds!.cli_token,
        "Content-Type": "application/json",
        "X-Project-Id": projectId,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 204 || res.status === 202) return undefined as T;
    const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) {
      const msg = (json as { error?: string }).error ?? `HTTP ${res.status}`;
      throw new ApiError(msg, res.status);
    }
    return json as T;
  }

  return { request, projectId, baseUrl };
}
