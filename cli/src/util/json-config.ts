import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

/** True when the serialized config carries a credential (bearer token / auth header). */
function carriesCredential(body: string): boolean {
  return /Bearer\s|"Authorization"|"authorization"|"X-Shipeasy-Key"/i.test(body);
}

/**
 * Tighten an ALREADY-WRITTEN config that carries a credential to 0600, without
 * rewriting it. For the paths where we leave an existing entry as is (skip path
 * of `mcp install`, `shipeasy upgrade`) but an earlier CLI version created the
 * file 0644. Returns true when the mode was changed; false when the file is
 * absent, unreadable, carries no credential, or is already private.
 */
export function tightenCredentialFile(path: string, dryRun = false): boolean {
  try {
    if (!existsSync(path)) return false;
    if (!carriesCredential(readFileSync(path, "utf8"))) return false;
    if ((statSync(path).mode & 0o077) === 0) return false;
    if (!dryRun) chmodSync(path, 0o600);
    return true;
  } catch {
    return false; // best effort (e.g. Windows, EPERM on a file we don't own)
  }
}

/**
 * Write a JSON config. A file that carries a credential (the MCP bearer) is
 * created 0600 and chmod'd to 0600 if it already existed with looser bits;
 * parent dirs this call creates are 0700 in that case. Credential-free
 * configs keep the default (umask-derived) mode.
 */
export function writeJsonConfig(path: string, data: unknown): void {
  const body = JSON.stringify(data, null, 2) + "\n";
  const secret = carriesCredential(body);
  mkdirSync(dirname(path), { recursive: true, ...(secret ? { mode: 0o700 } : {}) });
  if (secret) {
    writeFileSync(path, body, { encoding: "utf8", mode: 0o600 });
    try {
      chmodSync(path, 0o600); // writeFileSync's mode only applies to new files
    } catch {
      /* best effort (e.g. Windows) */
    }
  } else {
    writeFileSync(path, body, "utf8");
  }
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
