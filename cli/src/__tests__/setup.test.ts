import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeMcpServer } from "../util/json-config";
import {
  type AgentId,
  type InstallCtx,
  MCP_AUTH_INSTRUCTIONS,
  codexTomlSnippet,
  detectAgents,
  detectHarness,
  existingMcpProjectPin,
  homePathExists,
  onPath,
  registerMcp,
} from "../setup/agents";
import {
  upsertMarkedBlock,
  writeAgentsMd,
  writeCopilotInstructions,
  writeCursorRule,
} from "../setup/instructions";
import { applyAgent, agentDirective, mcpAuthHandoff } from "../commands/setup";
import { buildWiringDoc, type WiringTarget } from "../setup/wiring-doc";

function wiringTarget(over: Partial<WiringTarget> = {}): WiringTarget {
  return {
    relPath: "apps/web",
    language: "typescript",
    sdk: "typescript",
    frameworks: ["next"],
    packageManager: "pnpm",
    entryPoints: ["apps/web/app/layout.tsx"],
    sdkInstalled: true,
    installCmd: null,
    installationDoc: null,
    envFile: ".env.local",
    envVars: ["SHIPEASY_SERVER_KEY"],
    secretStoreMove: null,
    browser: false,
    ...over,
  };
}

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
  it("returns all five agents; jules detects the local Antigravity (agy) signal", () => {
    const agents = detectAgents(process.cwd());
    expect(agents.map((a) => a.id)).toEqual(["claude", "cursor", "codex", "copilot", "jules"]);
    // Jules is now locally powered by Antigravity — detected iff `agy` is on
    // PATH or ~/.antigravity exists (no longer hard-coded to false).
    expect(agents.find((a) => a.id === "jules")!.detected).toBe(
      onPath("agy") || homePathExists(".antigravity"),
    );
    for (const a of agents) expect(typeof a.reason).toBe("string");
  });
});

describe("detectHarness", () => {
  it("is human (not inside) in a clean env", () => {
    expect(detectHarness({})).toEqual({ inside: false, label: null });
  });

  it("detects known coding-agent env markers", () => {
    expect(detectHarness({ CLAUDECODE: "1" })).toEqual({ inside: true, label: "Claude Code" });
    expect(detectHarness({ CURSOR_AGENT: "1" }).inside).toBe(true);
    expect(detectHarness({ CODEX_SANDBOX: "seatbelt" }).label).toBe("OpenAI Codex");
  });

  it("honours the SHIPEASY_AGENT override both ways", () => {
    expect(detectHarness({ SHIPEASY_AGENT: "1" }).inside).toBe(true);
    // override wins even when a real marker is present
    expect(detectHarness({ SHIPEASY_AGENT: "0", CLAUDECODE: "1" }).inside).toBe(false);
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
  it("emits an [mcp_servers.shipeasy] block pointing at the hosted URL", () => {
    const s = codexTomlSnippet();
    expect(s).toContain("[mcp_servers.shipeasy]");
    expect(s).toContain('url = "https://mcp.shipeasy.ai/mcp"');
    expect(s).not.toContain("npx");
  });

  it("pins a bound project via the project-scoped URL (Codex has no header support)", () => {
    const s = codexTomlSnippet("proj_42");
    expect(s).toContain('url = "https://mcp.shipeasy.ai/p/proj_42/mcp"');
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
      expect(cfg.mcpServers.shipeasy.type).toBe("http");
      expect(cfg.mcpServers.shipeasy.url).toBe("https://mcp.shipeasy.ai/mcp");
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
      expect(cfg.servers.shipeasy.url).toBe("https://mcp.shipeasy.ai/mcp");
      expect(cfg.mcpServers).toBeUndefined();
      const r2 = registerMcp("copilot", ctx(dir));
      expect(r2.action).toBe("skipped");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("pins the bound project via the scoped URL AND an X-Project-Id header", () => {
    const dir = tmp();
    try {
      registerMcp("cursor", ctx(dir, { projectId: "proj_42" }));
      const cfg = JSON.parse(readFileSync(join(dir, ".cursor", "mcp.json"), "utf8"));
      expect(cfg.mcpServers.shipeasy.headers["X-Project-Id"]).toBe("proj_42");
      // The scoped path pins tool calls and pre-selects the project at OAuth
      // consent (it rides the RFC 8707 `resource` parameter).
      expect(cfg.mcpServers.shipeasy.url).toBe("https://mcp.shipeasy.ai/p/proj_42/mcp");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("omits X-Project-Id when no project is bound (chosen at OAuth consent)", () => {
    const dir = tmp();
    try {
      registerMcp("copilot", ctx(dir));
      const cfg = JSON.parse(readFileSync(join(dir, ".vscode", "mcp.json"), "utf8"));
      expect(cfg.servers.shipeasy.headers["X-Project-Id"]).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("upgrade migration: a legacy header-pinned entry is force-rewritten to the scoped URL", () => {
    const dir = tmp();
    try {
      // A pre-scoped-URL entry: bare /mcp + X-Project-Id header (what older
      // setups wrote).
      mkdirSync(join(dir, ".cursor"), { recursive: true });
      const path = join(dir, ".cursor", "mcp.json");
      writeFileSync(
        path,
        JSON.stringify({
          mcpServers: {
            shipeasy: {
              type: "http",
              url: "https://mcp.shipeasy.ai/mcp",
              headers: { "X-Project-Id": "proj_legacy" },
            },
          },
        }),
      );

      // `shipeasy upgrade` recovers the pin from the old entry…
      const pin = existingMcpProjectPin("cursor", ctx(dir));
      expect(pin).toBe("proj_legacy");

      // …and re-registers with force, upgrading the URL while keeping the pin.
      registerMcp("cursor", ctx(dir, { projectId: pin!, force: true }));
      const cfg = JSON.parse(readFileSync(path, "utf8"));
      expect(cfg.mcpServers.shipeasy.url).toBe("https://mcp.shipeasy.ai/p/proj_legacy/mcp");
      expect(cfg.mcpServers.shipeasy.headers["X-Project-Id"]).toBe("proj_legacy");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("existingMcpProjectPin reads a pin from an already-scoped URL (no header)", () => {
    const dir = tmp();
    try {
      mkdirSync(join(dir, ".vscode"), { recursive: true });
      writeFileSync(
        join(dir, ".vscode", "mcp.json"),
        JSON.stringify({
          servers: {
            shipeasy: { type: "http", url: "https://mcp.shipeasy.ai/p/proj_url/mcp", headers: {} },
          },
        }),
      );
      expect(existingMcpProjectPin("copilot", ctx(dir))).toBe("proj_url");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("existingMcpProjectPin is null when there is no entry or no pin", () => {
    const dir = tmp();
    try {
      expect(existingMcpProjectPin("cursor", ctx(dir))).toBeNull();
      registerMcp("cursor", ctx(dir)); // unpinned entry
      expect(existingMcpProjectPin("cursor", ctx(dir))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("auto-adds the list-guard disabled + annotated (X-Shipeasy-List-Guard: off + //list-guard)", () => {
    const dir = tmp();
    try {
      registerMcp("cursor", ctx(dir, { projectId: "proj_42" }));
      const entry = JSON.parse(readFileSync(join(dir, ".cursor", "mcp.json"), "utf8")).mcpServers
        .shipeasy;
      expect(entry.headers["X-Shipeasy-List-Guard"]).toBe("off");
      expect(entry["//list-guard"]).toMatch(/X-Shipeasy-List-Guard/);
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

describe("agentDirective", () => {
  it("is an actionable directive naming the wiring file + its key rules", () => {
    const d = agentDirective("/repo");
    expect(d).toContain("CODING AGENT");
    expect(d).toContain("/repo/shipeasy-wiring.md");
    expect(d).toContain("Never print, log, or commit a key value");
    expect(d).toContain("don't commit");
    expect(d).toContain("Delete shipeasy-wiring.md");
  });
});

describe("buildWiringDoc", () => {
  const base = {
    projectId: "proj_1",
    devtools: null,
    enabledFeatures: [] as string[],
    buildTargets: ["apps/web"],
  };

  it("only wires the targets it is handed — de-selected folders never appear", () => {
    // The caller filters out folders the user unchecked; the doc must not
    // resurrect them (no section, no `cd`-into-it verification line).
    const doc = buildWiringDoc({
      ...base,
      targets: [wiringTarget({ relPath: "apps/web" })],
      agents: ["claude"],
    });
    expect(doc).toContain("apps/web");
    expect(doc).not.toContain("apps/admin");
  });

  it("emits a harness-specific reload notice for the wired agents", () => {
    const doc = buildWiringDoc({
      ...base,
      targets: [wiringTarget()],
      agents: ["claude", "cursor"],
    });
    expect(doc).toContain("reload so the Shipeasy MCP tools load");
    expect(doc).toContain("Claude Code");
    expect(doc).toContain("Cursor");
    // The reload gate comes before the per-target wiring.
    expect(doc.indexOf("reload so the Shipeasy MCP tools load")).toBeLessThan(
      doc.indexOf("Per-target SDK wiring"),
    );
  });

  it("omits the reload notice when no agent was wired", () => {
    const doc = buildWiringDoc({ ...base, targets: [wiringTarget()], agents: [] });
    expect(doc).not.toContain("reload so the Shipeasy MCP tools load");
  });

  it("falls back to a generic reload line for an unknown harness", () => {
    const doc = buildWiringDoc({ ...base, targets: [wiringTarget()], agents: ["acme-ai"] });
    expect(doc).toContain("reload so the Shipeasy MCP tools load");
    expect(doc).toContain("Restart your coding agent");
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

describe("mcpAuthHandoff — the one-time MCP OAuth authorization step", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SHIPEASY_AGENT;
  });

  it("has a browser-authorize instruction for every agent", () => {
    const agents: AgentId[] = ["claude", "cursor", "codex", "copilot", "jules"];
    for (const a of agents) {
      expect(MCP_AUTH_INSTRUCTIONS[a]).toBeTruthy();
      expect(MCP_AUTH_INSTRUCTIONS[a]).toMatch(/browser/i);
    }
  });

  it("prints each selected agent's instruction and the agent directive under a harness", async () => {
    process.env.SHIPEASY_AGENT = "1"; // force the coding-agent path (detectHarness)
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));

    await mcpAuthHandoff(["cursor", "codex"], false);

    const out = logs.join("\n");
    expect(out).toContain(MCP_AUTH_INSTRUCTIONS.cursor);
    expect(out).toContain(MCP_AUTH_INSTRUCTIONS.codex);
    // The driving agent is told to authorize its own connection before wiring.
    expect(out).toMatch(/CODING AGENT: authorize your OWN shipeasy MCP connection/i);
  });

  it("is a no-op when no agents were wired", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await mcpAuthHandoff([], false);
    expect(spy).not.toHaveBeenCalled();
  });
});
