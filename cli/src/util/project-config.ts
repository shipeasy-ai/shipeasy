import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const FILENAME = ".shipeasy";

export interface ProjectConfig {
  /**
   * The Shipeasy project this directory pushes to. Required for any mutating
   * CLI/MCP operation. Stops a CLI session that's logged into project A from
   * silently pushing to project B because someone's cwd is wrong.
   */
  project_id?: string;
  /** Human-readable project name — display only, not authoritative. */
  project_name?: string;
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

export function readProjectConfig(dir: string): ProjectConfig {
  const found = findProjectConfigDir(dir);
  if (!found) return {};
  try {
    return JSON.parse(readFileSync(join(found, FILENAME), "utf8")) as ProjectConfig;
  } catch {
    return {};
  }
}

export function writeProjectConfig(dir: string, cfg: ProjectConfig): void {
  writeFileSync(configPath(dir), JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

export function getBoundProjectId(dir: string): string | undefined {
  return readProjectConfig(dir).project_id;
}

export function getI18nClientKey(dir: string): string | undefined {
  return readProjectConfig(dir).i18n?.client_key;
}

export function saveI18nClientKey(dir: string, key: string): void {
  // Write into the bound dir if one exists; otherwise create in cwd.
  const target = findProjectConfigDir(dir) ?? dir;
  const cfg = readProjectConfig(target);
  writeProjectConfig(target, { ...cfg, i18n: { ...cfg.i18n, client_key: key } });
}

export function bindProject(
  dir: string,
  projectId: string,
  projectName?: string,
): { path: string; created: boolean } {
  const existingDir = findProjectConfigDir(dir);
  const target = existingDir ?? dir;
  const cfg = existingDir ? readProjectConfig(target) : {};
  writeProjectConfig(target, {
    ...cfg,
    project_id: projectId,
    ...(projectName ? { project_name: projectName } : {}),
  });
  return { path: join(target, FILENAME), created: !existingDir };
}
