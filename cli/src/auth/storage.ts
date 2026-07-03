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

function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const root = xdg ? xdg : path.join(os.homedir(), ".config");
  return path.join(root, "shipeasy", "config.json");
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

export function saveCredentials(creds: ShipeasyConfig): void {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(creds, null, 2) + "\n", { mode: 0o600 });
}

export function clearCredentials(): void {
  try {
    fs.unlinkSync(configPath());
  } catch {
    // already gone
  }
}
