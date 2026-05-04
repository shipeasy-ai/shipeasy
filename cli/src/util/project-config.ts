import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

export function readProjectConfig(dir: string): ProjectConfig {
  const p = configPath(dir);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as ProjectConfig;
  } catch {
    return {};
  }
}

export function writeProjectConfig(dir: string, cfg: ProjectConfig): void {
  writeFileSync(configPath(dir), JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

export function getI18nClientKey(dir: string): string | undefined {
  return readProjectConfig(dir).i18n?.client_key;
}

export function saveI18nClientKey(dir: string, key: string): void {
  const cfg = readProjectConfig(dir);
  writeProjectConfig(dir, { ...cfg, i18n: { ...cfg.i18n, client_key: key } });
  ensureGitignored(dir, FILENAME);
}

function ensureGitignored(dir: string, entry: string): void {
  const path = join(dir, ".gitignore");
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  if (lines.some((l) => l.trim() === entry || l.trim() === `/${entry}`)) return;
  const trailing = lines[lines.length - 1] === "" ? "" : "\n";
  writeFileSync(path, readFileSync(path, "utf8") + trailing + entry + "\n", "utf8");
}
