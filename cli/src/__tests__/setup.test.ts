import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeMcpServer } from "../util/json-config";
import {
  type InstallCtx,
  codexTomlSnippet,
  detectAgents,
  onPath,
  registerMcp,
} from "../setup/agents";
import {
  upsertMarkedBlock,
  writeAgentsMd,
  writeCopilotInstructions,
  writeCursorRule,
} from "../setup/instructions";
import { applyAgent } from "../commands/setup";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "se-setup-"));
}
function ctx(cwd: string, over: Partial<InstallCtx> = {}): InstallCtx {
  return { cwd, scope: "project", force: false, dryRun: false, ...over };
}

describe("mergeMcpServer wrapper key", () => {
  it("nests under mcpServers by default", () => {
    const { config } = mergeMcpServer(null, "shipeasy", { command: "x" }, false);
    expect((config as any).mcpServers.shipeasy).toEqual({ command: "x" });
  });

  it("nests under servers for the Copilot variant", () => {
    const { config } = mergeMcpServer(null, "shipeasy", { command: "x" }, false, "servers");
    expect((config as any).servers.shipeasy).toEqual({ command: "x" });
    expect((config as any).mcpServers).toBeUndefined();
  });

  it("does not replace an existing entry without force", () => {
    const existing = { servers: { shipeasy: { command: "old" } } };
    const { replaced, config } = mergeMcpServer(
      existing,
      "shipeasy",
      { command: "new" },
      false,
      "servers",
    );
    expect(replaced).toBe(true);
    expect((config as any).servers.shipeasy).toEqual({ command: "old" });
  });

  it("replaces with force", () => {
    const existing = { servers: { shipeasy: { command: "old" } } };
    const { config } = mergeMcpServer(existing, "shipeasy", { command: "new" }, true, "servers");
    expect((config as any).servers.shipeasy).toEqual({ command: "new" });
  });
});

describe("detectAgents", () => {
  it("returns all five agents with jules never auto-detected", () => {
    const agents = detectAgents(process.cwd());
    expect(agents.map((a) => a.id)).toEqual(["claude", "cursor", "codex", "copilot", "jules"]);
    expect(agents.find((a) => a.id === "jules")!.detected).toBe(false);
    for (const a of agents) expect(typeof a.reason).toBe("string");
  });
});

describe("onPath", () => {
  it("finds node (the test runner)", () => {
    expect(onPath("node")).toBe(true);
  });
  it("does not find a nonsense binary", () => {
    expect(onPath("definitely-not-a-real-binary-xyz123")).toBe(false);
  });
});

describe("codexTomlSnippet", () => {
  it("emits an [mcp_servers.shipeasy] block with npx args", () => {
    const s = codexTomlSnippet();
    expect(s).toContain("[mcp_servers.shipeasy]");
    expect(s).toContain('command = "npx"');
    expect(s).toContain('"@shipeasy/mcp@latest"');
  });
});

describe("upsertMarkedBlock", () => {
  it("creates a fenced block from empty", () => {
    const out = upsertMarkedBlock(null, "BODY");
    expect(out).toContain("<!-- shipeasy:start -->");
    expect(out).toContain("BODY");
    expect(out).toContain("<!-- shipeasy:end -->");
  });

  it("appends to existing unrelated content", () => {
    const out = upsertMarkedBlock("# My repo\n\nstuff", "BODY");
    expect(out.startsWith("# My repo")).toBe(true);
    expect(out).toContain("<!-- shipeasy:start -->");
  });

  it("is idempotent — replaces in place, never duplicates", () => {
    const once = upsertMarkedBlock("# My repo\n", "BODY-V1");
    const twice = upsertMarkedBlock(once, "BODY-V2");
    expect(twice.match(/shipeasy:start/g)!.length).toBe(1);
    expect(twice).toContain("BODY-V2");
    expect(twice).not.toContain("BODY-V1");
    // re-running with same body yields a stable string
    expect(upsertMarkedBlock(twice, "BODY-V2")).toBe(twice);
  });
});

describe("instruction writers", () => {
  it("writes AGENTS.md and is idempotent on re-run", () => {
    const dir = tmp();
    try {
      const r1 = writeAgentsMd(ctx(dir));
      expect(r1.action).toBe("wrote");
      expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain("## Shipeasy");
      const r2 = writeAgentsMd(ctx(dir));
      expect(r2.action).toBe("skipped");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes a Cursor .mdc rule with frontmatter", () => {
    const dir = tmp();
    try {
      writeCursorRule(ctx(dir));
      const f = readFileSync(join(dir, ".cursor", "rules", "shipeasy.mdc"), "utf8");
      expect(f.startsWith("---")).toBe(true);
      expect(f).toContain("alwaysApply: false");
      expect(f).toContain("## Shipeasy");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes Copilot instructions and honors dryRun", () => {
    const dir = tmp();
    try {
      const r = writeCopilotInstructions(ctx(dir, { dryRun: true }));
      expect(r.action).toBe("wrote");
      expect(existsSync(join(dir, ".github", "copilot-instructions.md"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("registerMcp", () => {
  it("writes Cursor mcp.json under mcpServers", () => {
    const dir = tmp();
    try {
      const r = registerMcp("cursor", ctx(dir));
      expect(r.action).toBe("wrote");
      const cfg = JSON.parse(readFileSync(join(dir, ".cursor", "mcp.json"), "utf8"));
      expect(cfg.mcpServers.shipeasy.command).toBe("npx");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes Copilot .vscode/mcp.json under servers and skips on re-run", () => {
    const dir = tmp();
    try {
      const r1 = registerMcp("copilot", ctx(dir));
      expect(r1.action).toBe("wrote");
      const cfg = JSON.parse(readFileSync(join(dir, ".vscode", "mcp.json"), "utf8"));
      expect(cfg.servers.shipeasy.command).toBe("npx");
      expect(cfg.mcpServers).toBeUndefined();
      const r2 = registerMcp("copilot", ctx(dir));
      expect(r2.action).toBe("skipped");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dryRun does not write a file", () => {
    const dir = tmp();
    try {
      registerMcp("cursor", ctx(dir, { dryRun: true }));
      expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("jules is a manual step", () => {
    expect(registerMcp("jules", ctx(tmp())).action).toBe("manual");
  });
});

describe("applyAgent", () => {
  it("wires cursor mcp + rule in one call", () => {
    const dir = tmp();
    try {
      const lines = applyAgent("cursor", ctx(dir));
      expect(lines.join("\n")).toMatch(/MCP/);
      expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(true);
      expect(existsSync(join(dir, ".cursor", "rules", "shipeasy.mdc"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
