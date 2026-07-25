import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const spawnSyncMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

const { runMcpAuth } = await import("../setup/agents");

const PENDING = "  Status: ⏸ Pending approval (run `claude` to approve)\n";
const CONNECTED = "  Status: ✔ Connected\n";

/** A PATH dir containing exactly the given (fake) binaries — `onPath` only stats. */
function usePath(...bins: string[]): void {
  const dir = mkdtempSync(join(tmpdir(), "se-path-"));
  for (const b of bins) writeFileSync(join(dir, b), "#!/bin/sh\n", { mode: 0o755 });
  dirs.push(dir);
  process.env.PATH = dir;
}

const realPath = process.env.PATH;
let dirs: string[] = [];

beforeEach(() => {
  spawnSyncMock.mockReset();
  usePath("claude");
});

afterEach(() => {
  process.env.PATH = realPath;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** Which argv the mock was called with, flattened to a comparable string. */
function calls(): string[] {
  return spawnSyncMock.mock.calls.map((c) => [c[0], ...((c[1] as string[]) ?? [])].join(" "));
}

describe("runMcpAuth(claude) — the pending-approval trap", () => {
  it("skips the login entirely when the server is already connected", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: CONNECTED, stderr: "" });
    expect(runMcpAuth("claude")).toEqual({
      action: "authorized",
      detail: "already connected — no sign-in needed",
    });
    expect(calls()).toEqual(["claude mcp get shipeasy"]);
  });

  it("reports the fixable cause instead of driving a login that must fail", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: PENDING, stderr: "" });
    const r = runMcpAuth("claude");
    expect(r.action).toBe("manual");
    expect(r.detail).toMatch(/hasn't trusted this folder/);
    expect(calls()).toEqual(["claude mcp get shipeasy"]); // never attempted the login
  });

  it("re-probes a failed login and surfaces pending rather than a bare exit code", () => {
    // The pre-probe can't see it (e.g. `mcp get` gave us nothing), so the login
    // is what discovers the pending server — exiting 1 with "awaiting approval".
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" }) // pre-probe: unknown
      .mockReturnValueOnce({ status: 1 }) // mcp login
      .mockReturnValueOnce({ status: 0, stdout: PENDING, stderr: "" }); // re-probe
    const r = runMcpAuth("claude");
    expect(r.action).toBe("manual");
    expect(r.detail).toMatch(/hasn't trusted this folder/);
    expect(calls()).toEqual([
      "claude mcp get shipeasy",
      "claude mcp login shipeasy",
      "claude mcp get shipeasy",
    ]);
  });

  it("still reports a genuine login failure as failed", () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: "", stderr: "" })
      .mockReturnValueOnce({ status: 1 })
      .mockReturnValueOnce({ status: 0, stdout: "  Status: ✗ Failed to connect\n", stderr: "" });
    expect(runMcpAuth("claude")).toEqual({
      action: "failed",
      detail: "claude mcp login shipeasy exited 1",
    });
  });

  it("does nothing but describe itself on a dry run", () => {
    expect(runMcpAuth("claude", { dryRun: true })).toEqual({
      action: "authorized",
      detail: "would run: claude mcp login shipeasy",
    });
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });
});
