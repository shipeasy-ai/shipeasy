import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Best-effort "a newer version is available" notice, printed once per
 * invocation to stderr so it never pollutes `--json` stdout output. Checks
 * npm at most once every 24h (cached alongside the credentials file) so a
 * warm cache costs zero network calls; a cold cache is bounded by a short
 * timeout so a slow/offline registry never meaningfully delays a command.
 */

const PACKAGE_NAME = "@shipeasy/cli";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 800;

interface UpdateCache {
  last_checked: number;
  latest?: string;
}

function cachePath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const root = xdg ? xdg : path.join(os.homedir(), ".config");
  return path.join(root, "shipeasy", "update-check.json");
}

function readCache(): UpdateCache {
  try {
    return JSON.parse(fs.readFileSync(cachePath(), "utf-8")) as UpdateCache;
  } catch {
    return { last_checked: 0 };
  }
}

function writeCache(cache: UpdateCache): void {
  try {
    const p = cachePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(cache));
  } catch {
    // best-effort — a failed write just means we re-check next time
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { version?: string };
      return json.version ?? null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/** True if `latest` is a newer `x.y.z` version than `current`. */
function isNewer(latest: string, current: string): boolean {
  const a = latest.split(".").map((n) => Number.parseInt(n, 10));
  const b = current.split(".").map((n) => Number.parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

/** Print a one-line upgrade notice to stderr if a newer `@shipeasy/cli` is out. Never throws. */
export async function checkForUpdate(currentVersion: string): Promise<void> {
  try {
    const cache = readCache();
    let latest = cache.latest;
    if (Date.now() - cache.last_checked > CHECK_INTERVAL_MS) {
      const fetched = await fetchLatestVersion();
      if (fetched) latest = fetched;
      writeCache({ last_checked: Date.now(), latest });
    }
    if (latest && isNewer(latest, currentVersion)) {
      console.error(
        `UPDATE_AVAILABLE: shipeasy CLI ${currentVersion} -> ${latest}. Upgrade: npm install -g ${PACKAGE_NAME}@latest`,
      );
    }
  } catch {
    // never let the update check break a command
  }
}
