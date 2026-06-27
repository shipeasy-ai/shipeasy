import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

// The CLI ships bundled assets (skills/, plugin/) at the package root, beside
// `dist/` and `bin/`. In dev (tsx) `__dirname` is `src/util/`; from `dist/`
// it's the package root. Resolve both, plus a deeper fallback for tests.
export function resolveAsset(...segments: string[]): string {
  const candidates = [
    resolve(__dirname, "..", ...segments),
    resolve(__dirname, "..", "..", ...segments),
    resolve(__dirname, "..", "..", "..", ...segments),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(`Asset not found: ${segments.join("/")} — looked in ${candidates.join(", ")}`);
}

export function listDirs(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).filter((name) => {
    try {
      return statSync(resolve(path, name)).isDirectory();
    } catch {
      return false;
    }
  });
}
