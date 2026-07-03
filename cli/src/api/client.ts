import { createClient, createClientConfig, type Client } from "@shipeasy/openapi/client";
import { formatAuthFailure } from "@shipeasy/openapi";
import { loadCredentials, diagnoseMissingCredentials } from "../auth/storage";
import { getBoundProjectId } from "../util/project-config";

/**
 * Uniform admin-API error. (The generated client returns errors as data; the
 * generator runtime + custom commands throw this to get consistent CLI output.)
 */
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

/**
 * The one place every CLI command (generated + hand-written) should print a
 * caught error. Auth failures (401/403) get structured, actionable
 * remediation via `formatAuthFailure`; everything else falls back to the
 * plain `Error (<status>): <message>` form. Callers still own `process.exit`.
 */
export function printApiError(e: unknown): void {
  if (e instanceof ApiError) {
    console.error(formatAuthFailure("cli", e.status, e.message) ?? `Error (${e.status}): ${e.message}`);
  } else {
    console.error(String(e));
  }
}

export interface ApiClientOptions {
  /**
   * When true (default for any mutating subcommand), refuse to run unless the
   * cwd is bound to a project via `.shipeasy` or the caller passed `--project`.
   */
  requireBinding?: boolean;
}

/** Resolve credentials + project scope, enforcing the binding guard for writes. */
function resolveContext(projectOverride: string | undefined, opts: ApiClientOptions) {
  const creds = loadCredentials();
  if (!creds) {
    console.error(
      [
        `AUTH_REQUIRED: no valid Shipeasy credentials found for this CLI.`,
        ``,
        `Cause: ${diagnoseMissingCredentials()}`,
        `Fix:`,
        `  1. Run: shipeasy login`,
        `     (or set both SHIPEASY_CLI_TOKEN and SHIPEASY_PROJECT_ID)`,
        `  2. Retry the command that failed.`,
      ].join("\n"),
    );
    process.exit(1);
  }
  const bound = getBoundProjectId(process.cwd());
  if (opts.requireBinding && !projectOverride && !bound) {
    console.error(
      [
        `PROJECT_NOT_BOUND: this command writes to a Shipeasy project, but no`,
        `project is bound to this directory.`,
        ``,
        `Cause: no .shipeasy file found walking up from the working directory.`,
        `Fix:`,
        `  1. Run: shipeasy bind ${creds.project_id}`,
        `     Or pass: --project <project_id>`,
        `  2. Retry the command that failed.`,
        ``,
        `(.shipeasy is searched up the directory tree, like .git.)`,
      ].join("\n"),
    );
    process.exit(1);
  }
  const projectId = projectOverride ?? bound ?? creds.project_id;
  if (bound && bound !== creds.project_id && !projectOverride) {
    console.error(`→ using project from .shipeasy: ${bound} (CLI session is on ${creds.project_id})`);
  }
  return { token: creds.cli_token, baseUrl: creds.app_base_url.replace(/\/$/, ""), projectId };
}

/**
 * The configured generated client (`@shipeasy/openapi/client`). All generated
 * commands call sdk fns with `{ client }` from here, so auth (`X-SDK-Key`) and
 * project scope (`X-Project-Id`) are applied once. The admin API authenticates
 * the CLI token via the `X-SDK-Key` header, not bearer.
 */
export function getGeneratedClient(opts: ApiClientOptions = {}, projectOverride?: string): Client {
  const { token, baseUrl, projectId } = resolveContext(projectOverride, opts);
  return createClient(
    createClientConfig({
      baseUrl,
      headers: { "X-SDK-Key": token, "X-Project-Id": projectId },
    }),
  );
}

/**
 * Low-level fetch helper for the hand-written custom commands (i18n batch, key
 * minting, setup, auth) that talk to endpoints not in the generated surface.
 */
export function getApiClient(projectOverride?: string, opts: ApiClientOptions = {}) {
  const { token, baseUrl, projectId } = resolveContext(projectOverride, opts);

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "X-SDK-Key": token,
        "Content-Type": "application/json",
        "X-Project-Id": projectId,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 204 || res.status === 202) return undefined as T;
    const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) {
      const j = json as { error?: string; code?: string };
      throw new ApiError(j.error ?? `HTTP ${res.status}`, res.status, j.code);
    }
    return json as T;
  }

  async function requestRaw(method: string, path: string): Promise<Response> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "X-SDK-Key": token, "X-Project-Id": projectId },
    });
    if (!res.ok) throw new ApiError(`HTTP ${res.status} on ${path}`, res.status);
    return res;
  }

  return { request, requestRaw, projectId, baseUrl };
}
