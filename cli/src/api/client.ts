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

function checkExpiry(expiresAt: string | undefined): void {
  if (!expiresAt) return;
  const daysLeft = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
  if (daysLeft <= 0) {
    console.error("Session expired. Run: shipeasy login");
    process.exit(1);
  }
  if (daysLeft <= 7) {
    process.stderr.write(
      `Warning: session expires in ${Math.ceil(daysLeft)} day(s). Run: shipeasy login\n`,
    );
  }
}

export function getApiClient(projectOverride?: string) {
  const creds = loadCredentials();
  if (!creds) {
    console.error("Not logged in. Run: shipeasy login");
    process.exit(1);
  }
  checkExpiry(creds.expires_at);
  const projectId = projectOverride ?? creds.project_id;
  const baseUrl = creds.api_url.replace(/\/$/, "");

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "X-SDK-Key": creds!.token,
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
