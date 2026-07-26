import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Production domains are static and not configurable — the edge worker is
 * served at api.shipeasy.ai and the admin UI at shipeasy.ai. These match the
 * UI's WORKER_URL and the @shipeasy/mcp defaults. Do not reintroduce env-var
 * or flag overrides.
 */
export const API_BASE_URL = "https://api.shipeasy.ai";
export const APP_BASE_URL = "https://shipeasy.ai";

export interface ShipeasyConfig {
  project_id: string;
  cli_token: string;
  api_base_url: string;
  app_base_url: string;
  user_email?: string;
  created_at: string;
}

/** Where the CLI session lives on disk. Exported so `setup` can name the file
 *  it just wrote — "you are logged in" is a lot more convincing with a path. */
export function credentialsPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const root = xdg ? xdg : path.join(os.homedir(), ".config");
  return path.join(root, "shipeasy", "config.json");
}

function configPath(): string {
  return credentialsPath();
}

function envCredentials(): ShipeasyConfig | null {
  const cli_token = process.env.SHIPEASY_CLI_TOKEN?.trim();
  const project_id = process.env.SHIPEASY_PROJECT_ID?.trim();
  if (!cli_token || !project_id) return null;
  return {
    project_id,
    cli_token,
    api_base_url: API_BASE_URL,
    app_base_url: APP_BASE_URL,
    created_at: new Date(0).toISOString(),
  };
}

export function loadCredentials(): ShipeasyConfig | null {
  const fromEnv = envCredentials();
  if (fromEnv) return fromEnv;
  try {
    const raw = fs.readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(raw) as ShipeasyConfig;
    if (!parsed.project_id || !parsed.cli_token) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Which of the two credential sources answered — `"env"` when
 * `SHIPEASY_CLI_TOKEN` + `SHIPEASY_PROJECT_ID` are set (they win), `"file"` for
 * a stored session, `null` when there is neither.
 *
 * The distinction matters to `shipeasy setup`: an env-only session is authed for
 * *this* process and gone from the next shell, so a run that short-circuits on
 * one would hand off to a coding agent whose `shipeasy whoami` fails. Setup
 * persists it instead of assuming the env travels.
 */
export function credentialsSource(): "env" | "file" | null {
  if (envCredentials()) return "env";
  return loadCredentials() ? "file" : null;
}

/**
 * Explain *why* `loadCredentials()` returned `null`, so the auth-failure
 * message can point at the actual gap (e.g. one of the two env vars is set
 * but not the other, or the config file is missing just `project_id`)
 * instead of a blanket "not logged in" that's wrong advice for those cases.
 */
export function diagnoseMissingCredentials(): string {
  const token = process.env.SHIPEASY_CLI_TOKEN?.trim();
  const projectId = process.env.SHIPEASY_PROJECT_ID?.trim();
  if (token && !projectId) {
    return "SHIPEASY_CLI_TOKEN is set but SHIPEASY_PROJECT_ID is missing — both env vars are required together.";
  }
  if (!token && projectId) {
    return "SHIPEASY_PROJECT_ID is set but SHIPEASY_CLI_TOKEN is missing — both env vars are required together.";
  }
  const p = configPath();
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ShipeasyConfig>;
    if (parsed.cli_token && !parsed.project_id) {
      return `${p} has a cli_token but no project_id — the config file is corrupt or from an old format.`;
    }
    if (!parsed.cli_token && parsed.project_id) {
      return `${p} has a project_id but no cli_token — the config file is corrupt or from an old format.`;
    }
  } catch {
    // file missing/unreadable — the generic message below covers this
  }
  return `no ${p} and no SHIPEASY_CLI_TOKEN / SHIPEASY_PROJECT_ID env vars.`;
}

/**
 * Write the session ATOMICALLY — temp file in the same directory, then rename.
 *
 * A plain `writeFileSync` truncates before it writes, so anything that
 * interrupts it (a second `shipeasy` process writing concurrently, a Ctrl-C, a
 * harness killing the run) leaves a zero-byte or half-written config. Every
 * later read then fails `JSON.parse` and reports "no credentials" — which looks
 * exactly like a vanished session, and is unrecoverable without a browser.
 * `rename(2)` within one filesystem is atomic: readers see the old file or the
 * new one, never a torn one.
 */
export function saveCredentials(creds: ShipeasyConfig): void {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  // Same directory, so the rename can't cross a filesystem boundary; pid-suffixed
  // so two concurrent writers can't collide on the temp file itself.
  const tmp = `${p}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, p);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // nothing to clean up
    }
    throw err;
  }
}

export function clearCredentials(): void {
  try {
    fs.unlinkSync(configPath());
  } catch {
    // already gone
  }
}
