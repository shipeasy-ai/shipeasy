import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface ShipeasyConfig {
  project_id: string;
  cli_token: string;
  /** Worker base URL — used for /sdk/* and /auth/device/* calls. */
  api_base_url: string;
  /** Next.js UI base URL — used for /cli-auth page redirects. */
  app_base_url: string;
  user_email?: string;
  created_at: string;
}

/**
 * Config path. Shared with @shipeasy/cli so `shipeasy login` and
 * `shipeasy-mcp install` both read/write the same file.
 */
export function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const root = xdg ? xdg : join(homedir(), ".config");
  return join(root, "shipeasy", "config.json");
}

export async function readConfig(): Promise<ShipeasyConfig | null> {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as ShipeasyConfig;
    if (!parsed.project_id || !parsed.cli_token) return null;
    return parsed;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw err;
  }
}

export async function writeConfig(cfg: ShipeasyConfig): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}

export async function clearConfig(): Promise<boolean> {
  try {
    await unlink(configPath());
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Production domains are static and not configurable — the edge worker and the
 * admin UI are served from fixed custom domains. Do not reintroduce env-var
 * overrides here.
 */
export const API_BASE_URL = "https://api.shipeasy.ai";
export const APP_BASE_URL = "https://shipeasy.ai";

export function defaultApiBaseUrl(): string {
  return API_BASE_URL;
}

export function defaultAppBaseUrl(): string {
  return APP_BASE_URL;
}
