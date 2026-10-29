import fs from "node:fs";
import path from "node:path";
import { credentialsPath } from "../auth/storage";

/**
 * Crash-safe ledger for SDK keys that `shipeasy setup` has minted but not yet
 * written into the repo (shipeasy #276).
 *
 * The API returns a key's value exactly once, at mint time. Step 4 mints and
 * step 5 persists to `.env`, so a crash/kill/VM restart between the two used to
 * orphan a live server+client pair (the value existed only in that process's
 * memory) and the retry minted a SECOND pair. Now every mint is written here
 * the moment it returns, and the next run reuses it instead of minting again.
 * Step 5 clears the entries once the keys are in the repo.
 *
 * Lives beside the CLI session file (same dir, same 0600 mode - that file
 * already holds a bearer token, so this adds no new exposure). Entries are
 * scoped to project + env + type + repo root, so a key persisted for one repo is
 * never handed to another, and they expire after {@link PENDING_TTL_MS}.
 */
export interface PendingKey {
  id: string;
  type: "server" | "client";
  env: string;
  key: string;
  project_id: string;
  /** Absolute repo root the setup run was started in. */
  root: string;
  name: string;
  minted_at: string;
}

export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export function pendingKeysPath(): string {
  return path.join(path.dirname(credentialsPath()), "pending-keys.json");
}

function readAll(): PendingKey[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(pendingKeysPath(), "utf-8")) as unknown;
    return Array.isArray(parsed) ? (parsed as PendingKey[]) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: PendingKey[]): void {
  const file = pendingKeysPath();
  if (entries.length === 0) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Write-then-rename so a crash mid-write can't leave a truncated ledger
  // (which would be read as empty and re-orphan the key it was meant to save).
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function fresh(e: PendingKey, now: number): boolean {
  const at = Date.parse(e.minted_at);
  return Number.isFinite(at) && now - at < PENDING_TTL_MS;
}

/** Record a freshly minted key. Must be called before anything else can fail. */
export function recordPendingKey(entry: PendingKey): void {
  const now = Date.now();
  writeAll([...readAll().filter((e) => fresh(e, now)), entry]);
}

/** A not-yet-persisted key from an interrupted run of this same repo, if any. */
export function findPendingKey(
  q: Pick<PendingKey, "project_id" | "env" | "type" | "root">,
): PendingKey | null {
  const now = Date.now();
  return (
    readAll().find(
      (e) =>
        fresh(e, now) &&
        e.project_id === q.project_id &&
        e.env === q.env &&
        e.type === q.type &&
        e.root === q.root,
    ) ?? null
  );
}

/** Drop this repo's entries once their keys are safely in the repo. */
export function clearPendingKeys(q: Pick<PendingKey, "project_id" | "root">): void {
  const now = Date.now();
  writeAll(
    readAll().filter(
      (e) => fresh(e, now) && !(e.project_id === q.project_id && e.root === q.root),
    ),
  );
}
