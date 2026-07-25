import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const spawnSyncMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

const { ensureSkillsCli, resetSkillsCliCache, runSkillsAdd } = await import(
  "../setup/skills-registry"
);

/** A PATH dir containing exactly the given (fake) binaries — `onPath` only stats. */
function pathWith(...bins: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "se-path-"));
  for (const b of bins) writeFileSync(join(dir, b), "#!/bin/sh\n", { mode: 0o755 });
  return dir;
}

const realPath = process.env.PATH;
let dirs: string[] = [];

beforeEach(() => {
  resetSkillsCliCache();
  spawnSyncMock.mockReset();
  spawnSyncMock.mockReturnValue({ status: 0 });
});

afterEach(() => {
  process.env.PATH = realPath;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function usePath(...bins: string[]): void {
  const dir = pathWith(...bins);
  dirs.push(dir);
  process.env.PATH = dir;
}

describe("ensureSkillsCli — the skills CLI must exist before we depend on it", () => {
  it("prefers an installed `skills` binary on PATH", () => {
    usePath("skills", "npx", "npm");
    const cli = ensureSkillsCli();
    expect(cli).toMatchObject({ argv0: "skills", prefix: [], source: "path" });
    expect(spawnSyncMock).toHaveBeenCalledWith("skills", ["--version"], expect.anything());
    // No global install when the binary is already there.
    expect(spawnSyncMock.mock.calls.some((c) => c[0] === "npm")).toBe(false);
  });

  it("falls back to `npx -y skills` when the binary isn't installed", () => {
    usePath("npx", "npm");
    const cli = ensureSkillsCli();
    expect(cli).toMatchObject({ argv0: "npx", prefix: ["-y", "skills"], source: "npx" });
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "npx",
      ["-y", "skills", "--version"],
      expect.anything(),
    );
    expect(spawnSyncMock.mock.calls.some((c) => c[0] === "npm")).toBe(false);
  });

  it("installs the package globally when neither can run", () => {
    usePath("npm"); // no `skills`, no `npx`
    const cli = ensureSkillsCli();
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "skills"],
      expect.anything(),
    );
    // The fake PATH still has no `skills` afterwards, so we report it missing
    // rather than pretending — the caller then writes .claude/skills directly.
    expect(cli.source).toBe("missing");
  });

  it("memoizes the probe so setup doesn't re-spawn it per skill batch", () => {
    usePath("skills", "npx");
    ensureSkillsCli();
    const calls = spawnSyncMock.mock.calls.length;
    ensureSkillsCli();
    expect(spawnSyncMock.mock.calls.length).toBe(calls);
  });
});

describe("runSkillsAdd — never asks the user anything setup already resolved", () => {
  function argvFor(opts: Parameters<typeof runSkillsAdd>[1]): string[] {
    spawnSyncMock.mockReset();
    spawnSyncMock.mockReturnValue({ status: 0 });
    runSkillsAdd("/tmp/src", opts);
    const addCall = spawnSyncMock.mock.calls.find((c) => (c[1] as string[]).includes("add"));
    return addCall?.[1] as string[];
  }

  beforeEach(() => usePath("skills"));

  it("passes the resolved scope through: -g for user-global, nothing for project", () => {
    expect(argvFor({ global: true, agents: ["cursor"] })).toContain("-g");
    expect(argvFor({ global: false, agents: ["cursor"] })).not.toContain("-g");
  });

  it("always passes -y so the scope/confirmation prompts never appear", () => {
    expect(argvFor({ agents: ["cursor"] })).toContain("-y");
    expect(argvFor({ global: true })).toContain("-y");
  });

  it("keeps the variadic --skill list last so it can't swallow the flags", () => {
    const argv = argvFor({ global: true, agents: ["codex"], skills: ["shipeasy-flags", "shipeasy-ops"] });
    expect(argv.slice(-3)).toEqual(["--skill", "shipeasy-flags", "shipeasy-ops"]);
    expect(argv).toEqual(["add", "/tmp/src", "-g", "-y", "-a", "codex", "--skill", "shipeasy-flags", "shipeasy-ops"]);
  });

  it("runs once per named agent and reports per-agent success", () => {
    const results = runSkillsAdd("/tmp/src", { agents: ["cursor", "codex"] });
    expect(results.map((r) => r.agent)).toEqual(["cursor", "codex"]);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("reports failure (no spawn) when the CLI could not be made available", () => {
    resetSkillsCliCache();
    usePath(); // nothing on PATH at all
    spawnSyncMock.mockReturnValue({ status: 1 });
    const results = runSkillsAdd("/tmp/src", { agents: ["cursor"] });
    expect(results).toEqual([{ source: "/tmp/src", agent: "cursor", ok: false }]);
  });
});
