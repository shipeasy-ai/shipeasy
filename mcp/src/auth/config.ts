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

/**
 * Synthesize a config from `SHIPEASY_CLI_TOKEN` + `SHIPEASY_PROJECT_ID` env vars.
 * This is how the server authenticates when there's no `~/.config/shipeasy`
 * config file — e.g. the local stdio server a GitHub Copilot custom agent spawns,
 * which injects those vars from the repo's `COPILOT_MCP_*` secrets. Returns null
 * unless BOTH are present. Base URLs fall back to the fixed production domains.
 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ShipeasyConfig | null {
  const cli_token = env.SHIPEASY_CLI_TOKEN?.trim();
  const project_id = env.SHIPEASY_PROJECT_ID?.trim();
  if (!cli_token || !project_id) return null;
  return {
    project_id,
    cli_token,
    api_base_url: API_BASE_URL,
    app_base_url: APP_BASE_URL,
    created_at: "",
  };
}

export async function readConfig(): Promise<ShipeasyConfig | null> {
  try {
    const raw = await readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as ShipeasyConfig;
    if (!parsed.project_id || !parsed.cli_token) return null;
    return parsed;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      // No config file — fall back to env creds (Copilot coding-agent path).
      return configFromEnv();
    }
    throw err;
  }
}

/**
 * Explain *why* `readConfig()` returned `null` — distinguishes "no config
 * file at all" from "config file exists but is missing project_id or
 * cli_token" (e.g. a corrupt or old-format file), since the latter needs
 * different remediation than "run the installer".
 */
export async function diagnoseMissingConfig(): Promise<string> {
  const p = configPath();
  try {
    const raw = await readFile(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<ShipeasyConfig>;
    if (parsed.cli_token && !parsed.project_id) {
      return `${p} has a cli_token but no project_id — the config file is corrupt or from an old format.`;
    }
    if (!parsed.cli_token && parsed.project_id) {
      return `${p} has a project_id but no cli_token — the config file is corrupt or from an old format.`;
    }
  } catch {
    // missing/unreadable — the generic message below covers this
  }
  return `no ${p}`;
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
