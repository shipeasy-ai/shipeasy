import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PENDING_TTL_MS,
  clearPendingKeys,
  findPendingKey,
  pendingKeysPath,
  recordPendingKey,
  type PendingKey,
} from "../setup/pending-keys";

/**
 * Mint-to-persist is not atomic (shipeasy #276): the key value exists only in
 * the minting process until step 5 writes it to the repo. The ledger is what a
 * retry recovers it from instead of minting a second live pair.
 */
describe("pending-keys ledger", () => {
  let xdg: string;
  let prev: string | undefined;
  const entry = (over: Partial<PendingKey> = {}): PendingKey => ({
    id: "k1",
    type: "server",
    env: "prod",
    key: "sdk_server_abc",
    project_id: "p1",
    root: "/repo",
    name: "label",
    minted_at: new Date().toISOString(),
    ...over,
  });
  const q = { project_id: "p1", env: "prod", type: "server" as const, root: "/repo" };

  beforeEach(() => {
    xdg = mkdtempSync(join(tmpdir(), "se-pending-"));
    prev = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = xdg;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
    rmSync(xdg, { recursive: true, force: true });
  });

  it("a retry after an interrupted run finds the key it already minted", () => {
    recordPendingKey(entry());
    expect(findPendingKey(q)?.key).toBe("sdk_server_abc");
  });

  it("is written 0600 beside the CLI session", () => {
    recordPendingKey(entry());
    expect(statSync(pendingKeysPath()).mode & 0o777).toBe(0o600);
  });

  it("never hands a key to another repo, project, env or key type", () => {
    recordPendingKey(entry());
    expect(findPendingKey({ ...q, root: "/other" })).toBeNull();
    expect(findPendingKey({ ...q, project_id: "p2" })).toBeNull();
    expect(findPendingKey({ ...q, env: "dev" })).toBeNull();
    expect(findPendingKey({ ...q, type: "client" })).toBeNull();
  });

  it("ignores entries older than the TTL", () => {
    recordPendingKey(
      entry({ minted_at: new Date(Date.now() - PENDING_TTL_MS - 1000).toISOString() }),
    );
    expect(findPendingKey(q)).toBeNull();
  });

  it("clears this repo's entries once persisted, leaving others, and removes the empty file", () => {
    recordPendingKey(entry());
    recordPendingKey(entry({ id: "k2", root: "/other" }));
    clearPendingKeys({ project_id: "p1", root: "/repo" });
    expect(findPendingKey(q)).toBeNull();
    expect(findPendingKey({ ...q, root: "/other" })).not.toBeNull();
    clearPendingKeys({ project_id: "p1", root: "/other" });
    expect(existsSync(pendingKeysPath())).toBe(false);
  });
});
