import { loadCredentials } from "../auth/storage";
import { getBoundProjectId } from "../util/project-config";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  /**
   * When true (default for any mutating subcommand), refuse to run unless
   * the cwd is bound to a project via `.shipeasy` or the caller passed
   * `--project`. Stops a CLI session that's logged into project A from
   * silently writing to project B because someone's cwd is wrong.
   */
  requireBinding?: boolean;
}

export function getApiClient(projectOverride?: string, opts: ApiClientOptions = {}) {
  const creds = loadCredentials();
  if (!creds) {
    console.error("Not logged in. Run: shipeasy login");
    process.exit(1);
  }

  const bound = getBoundProjectId(process.cwd());

  // Resolution order: --project flag (explicit, highest precedence) →
  // .shipeasy in cwd / ancestor → CLI session default. Mutating commands
  // require one of the first two so a stale CLI session can't silently
  // push to the wrong project.
  if (opts.requireBinding && !projectOverride && !bound) {
    console.error(
      [
        `This command writes to a Shipeasy project, but no project is bound to`,
        `this directory.`,
        ``,
        `Bind it with:   shipeasy bind ${creds.project_id}`,
        `Or pass:        --project <project_id>`,
        ``,
        `(.shipeasy is searched up the directory tree, like .git.)`,
      ].join("\n"),
    );
    process.exit(1);
  }

  const projectId = projectOverride ?? bound ?? creds.project_id;
  const baseUrl = creds.app_base_url.replace(/\/$/, "");

  // If the bound project differs from the CLI session, surface a one-line
  // notice so the user notices when their session token is wrong for the
  // bound project (the API will still reject with 401/403; this just
  // explains why up-front).
  if (bound && bound !== creds.project_id && !projectOverride) {
    console.error(
      `→ using project from .shipeasy: ${bound} (CLI session is on ${creds.project_id})`,
    );
  }

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
