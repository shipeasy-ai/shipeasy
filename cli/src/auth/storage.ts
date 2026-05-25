import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
    api_base_url:
      process.env.SHIPEASY_API_BASE_URL?.trim() || "https://cdn.shipeasy.ai",
    app_base_url:
      process.env.SHIPEASY_APP_BASE_URL?.trim() || "https://shipeasy.ai",
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
