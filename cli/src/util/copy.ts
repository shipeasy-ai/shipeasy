import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface CopyResult {
  copied: string[];
  skipped: string[];
  overwritten: string[];
}

export function copyTree(src: string, dest: string, force: boolean): CopyResult {
  const result: CopyResult = { copied: [], skipped: [], overwritten: [] };
  if (!existsSync(src)) return result;
  mkdirSync(dest, { recursive: true });
  walk(src, (file) => {
    const rel = relative(src, file);
    const target = join(dest, rel);
    mkdirSync(join(target, ".."), { recursive: true });
    if (existsSync(target)) {
      if (!force) {
        result.skipped.push(rel);
        return;
      }
      cpSync(file, target);
      result.overwritten.push(rel);
      return;
    }
    cpSync(file, target);
    result.copied.push(rel);
  });
  return result;
}

function walk(dir: string, visit: (file: string) => void): void {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, visit);
    else if (s.isFile()) visit(p);
  }
}
