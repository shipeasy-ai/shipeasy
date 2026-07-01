import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * The shared `.shipeasy` project-binding file — the single source of truth for
 * both `@shipeasy/cli` and `@shipeasy/mcp`. Lives under `./node-context` because
 * it touches `node:fs`: **never import it from the worker-bundled graph** (the
 * openapi root/`./custom` entries stay fs-free and worker-safe).
 *
 * Model: **one `.shipeasy` per project**. The folder that holds the file IS the
 * project root. Reads walk up from the cwd to the *nearest* file (like git and
 * `.git`), so a subproject's own `.shipeasy` shadows any ancestor and the walk
 * stops there. Writes (`bindProject`, `mergeDetected`) target the LOCAL dir they
 * are given — they never reach up to reuse an ancestor — so each onboarded
 * subproject gets its own file.
 */
export const FILENAME = ".shipeasy";

/** Current `.shipeasy` schema version. Absent in a file → treat as legacy (1). */
export const SCHEMA_VERSION = 1;

export interface ProjectConfig {
  /** Shape version; lets future changes stay backward-compatible. */
  schema_version?: number;
  /**
   * The Shipeasy project this directory pushes to. Required for any mutating
   * CLI/MCP operation. Stops a session logged into project A from silently
   * writing to project B because someone's cwd is wrong.
   */
  project_id?: string;
  /** Human-readable project name — display only, not authoritative. */
  project_name?: string;
  /** Detected language (e.g. `typescript`, `python`) — written by `detect`. */
  language?: string;
  /** Docs SDK handle — the value `shipeasy docs` defaults to when `--sdk` is omitted. */
  sdk?: string;
  /** Detected frameworks (e.g. `["nextjs", "react"]`) — written by `detect`. */
  frameworks?: string[];
  i18n?: {
    client_key?: string;
  };
}

function configPath(dir: string): string {
  return join(dir, FILENAME);
}

/**
 * Walk up from `dir` until a `.shipeasy` file is found, like git does for
 * `.git`. Returns the directory containing the file, or `null` if the search
 * hits the filesystem root without finding one.
 */
export function findProjectConfigDir(dir: string): string | null {
  let current = resolve(dir);
  while (true) {
    if (existsSync(join(current, FILENAME))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function parse(raw: string): ProjectConfig {
  try {
    return JSON.parse(raw) as ProjectConfig;
  } catch {
    return {};
  }
}

/** Sync read of the nearest `.shipeasy` (walking up). Empty object if none. */
export function readProjectConfigSync(dir: string): ProjectConfig {
  const found = findProjectConfigDir(dir);
  if (!found) return {};
  try {
    return parse(readFileSync(join(found, FILENAME), "utf8"));
  } catch {
    return {};
  }
}

/** Async read of the nearest `.shipeasy` (walking up). Empty object if none. */
export async function readProjectConfig(dir: string): Promise<ProjectConfig> {
  const found = findProjectConfigDir(dir);
  if (!found) return {};
  try {
    return parse(await readFile(join(found, FILENAME), "utf8"));
  } catch {
    return {};
  }
}

/** Write `cfg` to `dir/.shipeasy` verbatim (stamping schema_version if absent). */
export function writeProjectConfig(dir: string, cfg: ProjectConfig): void {
  const withVersion: ProjectConfig = { schema_version: SCHEMA_VERSION, ...cfg };
  writeFileSync(configPath(dir), JSON.stringify(withVersion, null, 2) + "\n", "utf8");
}

/** Read the LOCAL `.shipeasy` at exactly `dir` (no walk-up). Empty if absent. */
function readLocalConfig(dir: string): ProjectConfig {
  const p = configPath(dir);
  if (!existsSync(p)) return {};
  try {
    return parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

/** Project id from the nearest `.shipeasy` (sync). */
export function getBoundProjectId(dir: string): string | undefined {
  return readProjectConfigSync(dir).project_id;
}
/** Alias kept for the MCP call sites. */
export const getBoundProjectIdSync = getBoundProjectId;

/** Docs SDK handle from the nearest `.shipeasy` (sync) — the `docs` default. */
export function getBoundSdk(dir: string): string | undefined {
  return readProjectConfigSync(dir).sdk;
}

export function getI18nClientKey(dir: string): string | undefined {
  return readProjectConfigSync(dir).i18n?.client_key;
}

export function saveI18nClientKey(dir: string, key: string): void {
  // Write into the nearest bound dir if one exists; otherwise create in `dir`.
  const target = findProjectConfigDir(dir) ?? dir;
  const cfg = readLocalConfig(target);
  writeProjectConfig(target, { ...cfg, i18n: { ...cfg.i18n, client_key: key } });
}

/**
 * Bind the LOCAL directory `dir` to `projectId` — writes `dir/.shipeasy`
 * directly (create, or merge over an existing LOCAL file to preserve `sdk` /
 * `i18n` / detection fields). It does NOT walk up to reuse an ancestor file:
 * one project per folder, so binding a subproject never mutates the repo root.
 */
export function bindProject(
  dir: string,
  projectId: string,
  projectName?: string,
): { path: string; created: boolean } {
  const existed = existsSync(configPath(dir));
  const cfg = readLocalConfig(dir);
  writeProjectConfig(dir, {
    ...cfg,
    project_id: projectId,
    ...(projectName ? { project_name: projectName } : {}),
  });
  return { path: configPath(dir), created: !existed };
}
/** Alias kept for the MCP call sites. */
export const bindProjectSync = bindProject;

/**
 * Non-destructively merge detected language/sdk/frameworks into the LOCAL
 * `dir/.shipeasy` (create it if absent). Never touches `project_id` or any
 * other field — this is what `shipeasy detect` calls per install target so the
 * `docs` default-sdk works even before the project is bound.
 */
export function mergeDetected(
  dir: string,
  detected: { language?: string; sdk?: string; frameworks?: string[] },
): { path: string; created: boolean } {
  const existed = existsSync(configPath(dir));
  const cfg = readLocalConfig(dir);
  writeProjectConfig(dir, {
    ...cfg,
    ...(detected.language ? { language: detected.language } : {}),
    ...(detected.sdk ? { sdk: detected.sdk } : {}),
    ...(detected.frameworks ? { frameworks: detected.frameworks } : {}),
  });
  return { path: configPath(dir), created: !existed };
}
