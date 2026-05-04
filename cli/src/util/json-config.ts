import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function readJsonConfig<T = Record<string, unknown>>(path: string): T | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8").trim();
  if (raw.length === 0) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`Refusing to overwrite malformed JSON at ${path}: ${String(err)}`);
  }
}

export function writeJsonConfig(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

interface MaybeMcp {
  mcpServers?: Record<string, unknown>;
}

export function mergeMcpServer(
  existing: MaybeMcp | null,
  name: string,
  spec: unknown,
  force: boolean,
): { config: MaybeMcp; replaced: boolean } {
  const config: MaybeMcp = existing ?? {};
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  const replaced = name in servers;
  if (replaced && !force) return { config: { ...config, mcpServers: servers }, replaced: true };
  servers[name] = spec;
  return { config: { ...config, mcpServers: servers }, replaced };
}
