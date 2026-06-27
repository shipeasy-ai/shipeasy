import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

const FILENAME = ".shipeasy";

export interface ProjectConfig {
  /**
   * The Shipeasy project this directory pushes to. Required for any mutating
   * MCP/CLI operation. Stops a session that's logged into project A from
   * silently writing to project B because someone's cwd is wrong.
   */
  project_id?: string;
  project_name?: string;
  i18n?: {
    client_key?: string;
  };
}

function configPath(dir: string): string {
  return join(dir, FILENAME);
}

/** Walk up like git does for `.git`. Returns the dir or null. */
export function findProjectConfigDir(dir: string): string | null {
  let current = resolve(dir);
  while (true) {
    if (existsSync(join(current, FILENAME))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function readProjectConfig(dir: string): Promise<ProjectConfig> {
  const found = findProjectConfigDir(dir);
  if (!found) return {};
  try {
    return JSON.parse(await readFile(join(found, FILENAME), "utf8")) as ProjectConfig;
  } catch {
    return {};
  }
}

export function getBoundProjectIdSync(dir: string): string | undefined {
  const found = findProjectConfigDir(dir);
  if (!found) return undefined;
  try {
    const cfg = JSON.parse(readFileSync(join(found, FILENAME), "utf8")) as ProjectConfig;
    return cfg.project_id;
  } catch {
    return undefined;
  }
}

export async function saveI18nClientKey(dir: string, key: string): Promise<void> {
  const target = findProjectConfigDir(dir) ?? dir;
  const cfg = await readProjectConfig(target);
  await writeFile(
    configPath(target),
    JSON.stringify({ ...cfg, i18n: { ...cfg.i18n, client_key: key } }, null, 2) + "\n",
    "utf8",
  );
}

export async function getI18nClientKey(dir: string): Promise<string | undefined> {
  return (await readProjectConfig(dir)).i18n?.client_key;
}

export function bindProjectSync(
  dir: string,
  projectId: string,
  projectName?: string,
): { path: string; created: boolean } {
  const existingDir = findProjectConfigDir(dir);
  const target = existingDir ?? dir;
  let cfg: ProjectConfig = {};
  if (existingDir) {
    try {
      cfg = JSON.parse(readFileSync(configPath(target), "utf8")) as ProjectConfig;
    } catch {}
  }
  writeFileSync(
    configPath(target),
    JSON.stringify(
      { ...cfg, project_id: projectId, ...(projectName ? { project_name: projectName } : {}) },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return { path: configPath(target), created: !existingDir };
}
