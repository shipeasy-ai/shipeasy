import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FILENAME = ".shipeasy";

interface ProjectConfig {
  i18n?: {
    client_key?: string;
  };
}

function configPath(dir: string): string {
  return join(dir, FILENAME);
}

export async function readProjectConfig(dir: string): Promise<ProjectConfig> {
  try {
    return JSON.parse(await readFile(configPath(dir), "utf8")) as ProjectConfig;
  } catch {
    return {};
  }
}

export async function saveI18nClientKey(dir: string, key: string): Promise<void> {
  const cfg = await readProjectConfig(dir);
  await writeFile(
    configPath(dir),
    JSON.stringify({ ...cfg, i18n: { ...cfg.i18n, client_key: key } }, null, 2) + "\n",
    "utf8",
  );
}

export async function getI18nClientKey(dir: string): Promise<string | undefined> {
  return (await readProjectConfig(dir)).i18n?.client_key;
}
