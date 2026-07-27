import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const spawnSyncMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

const { runMcpAuth, probeMcpReady, parseCursorToolList, parseCodexAuthStatus } = await import(
  "../setup/agents"
);

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
      detail: "already authorized — server connected",
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

describe("probeMcpReady — proving the connection instead of assuming it", () => {
  const TOOLS = "Tools for shipeasy (111):\n- whoami ()\n- ops_list (status)\n";

  it("reads Cursor's tool listing as proof the whole chain works", () => {
    usePath("cursor-agent");
    spawnSyncMock.mockReturnValue({ status: 0, stdout: TOOLS, stderr: "" });
    expect(probeMcpReady("cursor")).toEqual({
      state: "ready",
      detail: "111 tools resolve",
      toolCount: 111,
    });
    expect(calls()).toEqual(["cursor-agent mcp list-tools shipeasy"]);
  });

  it("reports not-ready with the client's own first line when the listing fails", () => {
    usePath("cursor-agent");
    spawnSyncMock.mockReturnValue({ status: 1, stdout: "", stderr: "MCP server not found\n" });
    expect(probeMcpReady("cursor")).toEqual({
      state: "not-ready",
      detail: "MCP server not found",
    });
  });

  it("maps Claude's server state onto the same three answers", () => {
    spawnSyncMock.mockReturnValue({ status: 0, stdout: CONNECTED, stderr: "" });
    expect(probeMcpReady("claude").state).toBe("ready");
    spawnSyncMock.mockReturnValue({ status: 0, stdout: PENDING, stderr: "" });
    // `pending-trust` is the code `runMcpAuth` acts on to skip a login that
    // cannot succeed against an untrusted folder.
    expect(probeMcpReady("claude")).toEqual({
      state: "not-ready",
      detail: "awaiting folder trust",
      code: "pending-trust",
    });
  });

  it("reads Codex's per-server auth_status", () => {
    usePath("codex");
    const list = (status: string) =>
      JSON.stringify([
        { name: "figma", auth_status: "not_logged_in" },
        { name: "shipeasy", auth_status: status },
      ]);

    spawnSyncMock.mockReturnValue({ status: 0, stdout: list("o_auth"), stderr: "" });
    expect(probeMcpReady("codex")).toEqual({ state: "ready", detail: "signed in (OAuth)" });
    expect(calls()).toEqual(["codex mcp list --json"]);

    spawnSyncMock.mockReturnValue({ status: 0, stdout: list("not_logged_in"), stderr: "" });
    expect(probeMcpReady("codex")).toEqual({ state: "not-ready", detail: "not logged in" });
  });

  it("treats a Codex too old for --json as unknown, not as a broken connection", () => {
    usePath("codex");
    spawnSyncMock.mockReturnValue({ status: 2, stdout: "", stderr: "error: unexpected argument\n" });
    expect(probeMcpReady("codex").state).toBe("unknown");
  });

  it("says unknown — never not-ready — when nothing here can check", () => {
    // A missing binary or a client with no scriptable probe must not be reported
    // as a broken connection: setup would print a fix for a problem it invented.
    usePath(); // empty PATH
    expect(probeMcpReady("cursor").state).toBe("unknown");
    expect(probeMcpReady("codex").state).toBe("unknown");
    expect(probeMcpReady("copilot").state).toBe("unknown"); // no scriptable probe
    expect(probeMcpReady("cursor", { dryRun: true }).state).toBe("unknown");
  });

  it("parses the tool-count header and nothing else", () => {
    expect(parseCursorToolList(TOOLS)).toBe(111);
    expect(parseCursorToolList("Error: not authenticated")).toBeNull();
    expect(parseCursorToolList("")).toBeNull();
  });

  it("finds the named server's auth_status past any preamble", () => {
    const json = '[{"name":"shipeasy","auth_status":"o_auth"}]';
    expect(parseCodexAuthStatus(`warning: update available\n${json}`)).toBe("o_auth");
    expect(parseCodexAuthStatus(JSON.stringify({ servers: JSON.parse(json) }))).toBe("o_auth");
    expect(parseCodexAuthStatus(json, "other")).toBeNull(); // different server
    expect(parseCodexAuthStatus("not json at all")).toBeNull();
  });
});
