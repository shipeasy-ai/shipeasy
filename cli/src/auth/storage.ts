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

export function loadCredentials(): ShipeasyConfig | null {
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
