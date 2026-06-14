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

type McpConfig = Record<string, unknown>;

/**
 * Merge a single MCP server entry into an assistant config object.
 *
 * Most assistants nest servers under `mcpServers` (Claude, Cursor, Windsurf),
 * but a few use a different wrapper key — VS Code / GitHub Copilot's
 * `.vscode/mcp.json` uses `servers`. `key` selects which wrapper to write so
 * the same helper covers both conventions.
 */
export function mergeMcpServer(
  existing: McpConfig | null,
  name: string,
  spec: unknown,
  force: boolean,
  key: "mcpServers" | "servers" = "mcpServers",
): { config: McpConfig; replaced: boolean } {
  const config: McpConfig = existing ?? {};
  const servers = (config[key] ?? {}) as Record<string, unknown>;
  const replaced = name in servers;
  if (replaced && !force) return { config: { ...config, [key]: servers }, replaced: true };
  servers[name] = spec;
  return { config: { ...config, [key]: servers }, replaced };
}
