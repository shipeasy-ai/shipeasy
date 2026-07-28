import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mergeMcpServer } from "../util/json-config";
import {
  type AgentId,
  type InstallCtx,
  ALL_AGENT_IDS,
  MCP_AUTH_COMMANDS,
  addClaudeMcpNative,
  antigravityServerSpec,
  geminiMcpAddArgv,
  normalizeAgentId,
  parseGeminiMcpList,
  specForAgent,
  approveProjectMcpServer,
  claudeMcpAddArgv,
  claudePluginArgv,
  copilotMcpAddArgv,
  bearerForPath,
  mcpBearer,
  serverSpec,
  parseClaudeServerState,
  MCP_AUTH_INSTRUCTIONS,
  codexTomlSnippet,
  detectAgents,
  detectHarness,
  existingMcpProjectPin,
  homePathExists,
  onPath,
  registerMcp,
  runMcpAuth,
  vscodeUserMcpPath,
} from "../setup/agents";
import {
  upsertMarkedBlock,
  writeAgentsMd,
  writeCopilotInstructions,
  writeCursorRule,
} from "../setup/instructions";
import {
  appBaseUrl,
  applyAgent,
  agentDirective,
  bootstrapPrompt,
  bootstrapTasks,
  mcpAuthHandoff,
  wiringPlanLines,
  TRUST_SESSION_PROMPT,
  WIRING_FILENAME,
} from "../commands/setup";
import {
  buildWiringDoc,
  type DevtoolsSurface,
  type WiringTarget,
} from "../setup/wiring-doc";

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
  it("returns every agent, Google's two split apart", () => {
    const agents = detectAgents(process.cwd());
    expect(agents.map((a) => a.id)).toEqual([
      "claude",
      "cursor",
      "codex",
      "copilot",
      "antigravity",
      "gemini",
    ]);
    for (const a of agents) expect(typeof a.reason).toBe("string");
  });

  // Antigravity keeps its state in `~/.gemini/antigravity*`; the old probe
  // looked for `~/.antigravity`, which no install writes, so detection fell
  // back to PATH alone.
  it("detects Antigravity from `agy` or its real home under ~/.gemini", () => {
    const antigravity = detectAgents().find((a) => a.id === "antigravity")!;
    expect(antigravity.detected).toBe(
      onPath("agy") ||
        homePathExists(".gemini", "antigravity-cli") ||
        homePathExists(".gemini", "antigravity"),
    );
  });

  // `~/.gemini` alone can't tell them apart — Antigravity lives there too — so
  // Gemini CLI is keyed on its own `settings.json`.
  it("detects Gemini CLI from `gemini` or its own settings.json", () => {
    const gemini = detectAgents().find((a) => a.id === "gemini")!;
    expect(gemini.detected).toBe(onPath("gemini") || homePathExists(".gemini", "settings.json"));
  });
});

describe("normalizeAgentId", () => {
  it("resolves `jules` onto antigravity — the agent that entry always detected", () => {
    expect(normalizeAgentId("jules")).toBe("antigravity");
    expect(normalizeAgentId("JULES")).toBe("antigravity");
    expect(normalizeAgentId("agy")).toBe("antigravity");
  });

  it("passes canonical ids through and rejects unknown ones", () => {
    for (const id of ALL_AGENT_IDS) expect(normalizeAgentId(id)).toBe(id);
    expect(normalizeAgentId("windsurf")).toBeNull();
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
  // These assert what lands ON DISK, so no real agent binary may be reachable:
  // `registerMcp` shells out to `claude mcp add` / `copilot mcp add` whenever
  // one is on PATH, and `copilot mcp add` writes the DEVELOPER'S OWN
  // `~/.copilot/mcp-config.json`. An empty PATH makes `onPath` false for every
  // agent, so each test exercises the file-merge path deterministically —
  // whether or not the machine running the suite has the agents installed.
  //
  // HOME is redirected for the same reason: Copilot's entry now lands in VS
  // Code's user-profile `mcp.json`, so an un-stubbed run would rewrite the
  // developer's real editor config.
  const realPath = process.env.PATH;
  const realHome = process.env.HOME;
  let fakeHome: string;
  beforeEach(() => {
    process.env.PATH = "";
    fakeHome = tmp();
    process.env.HOME = fakeHome;
  });
  afterEach(() => {
    process.env.PATH = realPath;
    process.env.HOME = realHome;
    rmSync(fakeHome, { recursive: true, force: true });
  });

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

  it("writes Copilot's VS Code user-profile mcp.json under servers, not the repo", () => {
    const dir = tmp();
    try {
      const r1 = registerMcp("copilot", ctx(dir));
      expect(r1.action).toBe("wrote");
      const cfg = JSON.parse(readFileSync(vscodeUserMcpPath(), "utf8"));
      expect(cfg.servers.shipeasy.url).toBe("https://mcp.shipeasy.ai/mcp");
      expect(cfg.mcpServers).toBeUndefined();
      // The repo file is deliberately NOT written: it can't hold the bearer, so
      // an entry there would only shadow the pre-authenticated profile one.
      expect(existsSync(join(dir, ".vscode", "mcp.json"))).toBe(false);
      const r2 = registerMcp("copilot", ctx(dir));
      expect(r2.action).toBe("skipped");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prunes a stale repo .vscode/mcp.json entry that would shadow the profile one", () => {
    const dir = tmp();
    try {
      mkdirSync(join(dir, ".vscode"), { recursive: true });
      const repoFile = join(dir, ".vscode", "mcp.json");
      writeFileSync(
        repoFile,
        JSON.stringify({
          servers: {
            shipeasy: { type: "http", url: "https://mcp.shipeasy.ai/mcp" },
            other: { type: "http", url: "https://example.test/mcp" },
          },
        }),
      );
      registerMcp("copilot", ctx(dir));
      const cfg = JSON.parse(readFileSync(repoFile, "utf8"));
      expect(cfg.servers.shipeasy).toBeUndefined();
      expect(cfg.servers.other).toBeDefined(); // someone else's server is left alone
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("removes the repo .vscode/mcp.json outright when shipeasy was its only server", () => {
    const dir = tmp();
    try {
      mkdirSync(join(dir, ".vscode"), { recursive: true });
      const repoFile = join(dir, ".vscode", "mcp.json");
      writeFileSync(repoFile, JSON.stringify({ servers: { shipeasy: { type: "http" } } }));
      registerMcp("copilot", ctx(dir));
      expect(existsSync(repoFile)).toBe(false);
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
      const cfg = JSON.parse(readFileSync(vscodeUserMcpPath(), "utf8"));
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
      const profile = vscodeUserMcpPath();
      mkdirSync(dirname(profile), { recursive: true });
      writeFileSync(
        profile,
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

  // The whole point of splitting `jules` apart: this used to be a printed
  // sentence that wrote nothing at all.
  it("writes Antigravity's global mcp_config.json with its own serverUrl shape", () => {
    const dir = tmp();
    try {
      const res = registerMcp("antigravity", ctx(dir, { dryRun: true }));
      expect(res.action).toBe("wrote");
      expect(res.detail).toContain(join(".gemini", "config", "mcp_config.json"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("registers Gemini through `gemini mcp add` when the binary is there", () => {
    const dir = tmp();
    try {
      const res = registerMcp("gemini", ctx(dir, { dryRun: true }));
      // Native when `gemini` is on PATH, JSON merge otherwise — both are a real
      // write, neither is a manual hand-off.
      expect(onPath("gemini") ? res.action : "shell").toBe("shell");
      expect(res.action).not.toBe("manual");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("antigravityServerSpec", () => {
  it("uses `serverUrl` (not `url`) and carries the pin + bearer in headers", () => {
    const spec = antigravityServerSpec("p-1", "sdk_admin_x");
    expect(spec.serverUrl).toBe("https://mcp.shipeasy.ai/p/p-1/mcp");
    expect(spec).not.toHaveProperty("url");
    expect(spec.headers["X-Project-Id"]).toBe("p-1");
    expect(spec.headers.Authorization).toBe("Bearer sdk_admin_x");
  });

  // `agy` uses a strict JSON decoder somewhere; a comment key could take the
  // whole config down with it, so this is the one entry written without one.
  it("carries no `//` comment key, unlike every other agent's entry", () => {
    expect(antigravityServerSpec("p-1")).not.toHaveProperty("//list-guard");
    expect(serverSpec("p-1")).toHaveProperty("//list-guard");
  });

  it("is what specForAgent hands Antigravity, and only Antigravity", () => {
    expect(specForAgent("antigravity", "p-1")).toHaveProperty("serverUrl");
    expect(specForAgent("gemini", "p-1")).toHaveProperty("url");
  });
});

describe("geminiMcpAddArgv", () => {
  it("passes the http transport, the project pin, and the scope", () => {
    const argv = geminiMcpAddArgv(ctx(tmp(), { projectId: "p-1", scope: "user" }));
    expect(argv.slice(0, 4)).toEqual([
      "mcp",
      "add",
      "shipeasy",
      "https://mcp.shipeasy.ai/p/p-1/mcp",
    ]);
    expect(argv).toContain("-t");
    expect(argv).toContain("http");
    expect(argv.join(" ")).toContain("X-Project-Id: p-1");
    expect(argv.join(" ")).toContain("-s user");
  });

  // Same rule as every other agent: a repo file is committable, so no key.
  it("withholds the bearer at project scope but sends it at user scope", () => {
    const dir = tmp();
    const at = (scope: "user" | "project") =>
      geminiMcpAddArgv(ctx(dir, { scope, mcpToken: "sdk_admin_x" })).join(" ");
    expect(at("project")).not.toContain("Authorization");
    expect(at("user")).toContain("Authorization: Bearer sdk_admin_x");
  });
});

describe("parseGeminiMcpList", () => {
  it("reads a listed server as reachable", () => {
    const out = "Configured MCP servers:\n\n● shipeasy: https://mcp.shipeasy.ai/mcp (http) - Connected";
    expect(parseGeminiMcpList(out)?.state).toBe("reachable");
  });

  // The trap this exists for: the entry is present and correct, and Gemini
  // silently ignores it — including user-scope entries — until the folder is
  // trusted. Without this the probe would report a healthy install.
  it("reports an untrusted folder rather than calling it healthy", () => {
    const out =
      "Warning: MCP servers are configured but disabled because this folder is untrusted.\n\n" +
      "Configured MCP servers:\n\n○ shipeasy: https://mcp.shipeasy.ai/mcp (http) - Disabled";
    const res = parseGeminiMcpList(out)!;
    expect(res.state).toBe("not-ready");
    expect(res.detail).toMatch(/untrusted/i);
  });

  it("reports a missing entry, and gives no verdict on unrelated output", () => {
    expect(parseGeminiMcpList("No MCP servers configured.")?.state).toBe("not-ready");
    expect(parseGeminiMcpList("gemini: command not found")).toBeNull();
  });
});

describe("agentDirective", () => {
  it("is an actionable directive naming the wiring file + its key rules", () => {
    const d = agentDirective("/repo");
    expect(d).toContain("CODING AGENT");
    expect(d).toContain("/repo/shipeasy-wiring.md");
    expect(d).toContain("Never print, log, or commit a key value");
    // Push is never on; the commit is deferred to the Cleanup step's question.
    expect(d).toContain("Never push.");
    expect(d).toContain("Finish at Cleanup: ask whether to delete shipeasy-wiring.md");
    // The pulled docs go out with the wiring file, so name them in the directive.
    expect(d).toContain("shipeasy-wiring-docs/");
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
    expect(doc).toContain("check whether the Shipeasy MCP tools are live here");
    expect(doc).toContain("Claude Code");
    expect(doc).toContain("Cursor");
    // The gate comes before the per-target wiring.
    expect(doc.indexOf("check whether the Shipeasy MCP tools are live here")).toBeLessThan(
      doc.indexOf("Per-target SDK wiring"),
    );
  });

  it("has the agent probe for the tools instead of assuming they are missing", () => {
    // A session setup launched itself (step 11) starts AFTER the MCP wiring, so
    // its tools ARE live. Asserting otherwise talked those sessions into a CLI
    // fallback they never needed — the doc must make it a check, and keep the
    // CLI as the last resort behind a declined restart.
    const doc = buildWiringDoc({ ...base, targets: [wiringTarget()], agents: ["cursor"] });
    expect(doc).toMatch(/check, don't assume/i);
    expect(doc).toMatch(/Call the `whoami` MCP tool/);
    expect(doc).not.toMatch(/while this session was\s+already running/);
    // The CLI fallback comes last, after both remedies have been offered.
    expect(doc.indexOf("Only once the step above is done or declined")).toBeGreaterThan(
      doc.indexOf("Call the `whoami` MCP tool"),
    );
    // The Cursor CLI has no window to reload — it needs a new session.
    expect(doc).toMatch(/`cursor-agent`\): exit and start a new session/);
  });

  it("names the clients whose authorization setup verified before the hand-off", () => {
    // Step 10 probes while a user is still there to fix it, so the doc can rule
    // a missing sign-in out as the cause — but only for a client that reports
    // auth state at all (Codex), never one that merely connected.
    const doc = buildWiringDoc({
      ...base,
      targets: [wiringTarget()],
      agents: ["codex"],
      mcpVerified: ["codex"],
    });
    expect(doc).toMatch(/verified authorization\*{2} for codex/);
    expect(doc).toMatch(/a failure there is a stale session, not a\s+missing sign-in/);
  });

  it("omits the verification claim when nothing was verified", () => {
    const doc = buildWiringDoc({ ...base, targets: [wiringTarget()], agents: ["cursor"] });
    expect(doc).not.toMatch(/verified authorization/);
    expect(doc).toMatch(/Call the `whoami` MCP tool/); // the probe gate still stands
  });

  it("separates a 401 from a stale session, and gives Cursor BOTH surfaces", () => {
    // The failure that sent a Cursor session to the CLI: tools present, call
    // Unauthorized. Restarting cannot fix that — the client never signed in.
    const doc = buildWiringDoc({ ...base, targets: [wiringTarget()], agents: ["cursor"] });
    expect(doc).toMatch(/tools ARE there but the call returns/);
    expect(doc).toMatch(/NOT a stale session/);
    // `mcp_auth` exists in the IDE only. Naming it unconditionally sent a
    // `cursor-agent` session hunting for a tool that isn't there (its `mcp`
    // subcommands are login/list/list-tools/enable/disable), and from there
    // straight to the CLI fallback — so the CLI branch must be spelled out,
    // including that `cursor-agent mcp login` is not a fix.
    expect(doc).toMatch(/in the IDE: call the `mcp_auth` tool/);
    expect(doc).toMatch(/`cursor-agent mcp login` reports success without storing a token/);
    expect(doc).toMatch(/ask the user to log in from Cursor/);
    // ...and the restart branch stays, for the genuinely stale case.
    expect(doc).toMatch(/tools aren't there at all/);
  });

  it("omits the reload notice when no agent was wired", () => {
    const doc = buildWiringDoc({ ...base, targets: [wiringTarget()], agents: [] });
    expect(doc).not.toContain("check whether the Shipeasy MCP tools are live here");
  });

  it("falls back to a generic reload line for an unknown harness", () => {
    const doc = buildWiringDoc({ ...base, targets: [wiringTarget()], agents: ["acme-ai"] });
    expect(doc).toContain("check whether the Shipeasy MCP tools are live here");
    expect(doc).toContain("Restart your coding agent");
  });

  it("points the Cleanup question at the harness's own question tool", () => {
    // The Cleanup question gates two irreversible actions behind an explicit
    // "no clear answer → change nothing" branch, so a structured Yes/No beats a
    // reply that has to be interpreted.
    const claude = buildWiringDoc({ ...base, targets: [wiringTarget()], agents: ["claude"] });
    expect(claude).toMatch(/Ask with the `AskUserQuestion` tool/);
    // Cursor reaches its Q&A tool by being told this exact phrase.
    const cursor = buildWiringDoc({ ...base, targets: [wiringTarget()], agents: ["cursor"] });
    expect(cursor).toMatch(/Use the ask question tool/);
    // VS Code addresses a tool by `#tool:<id>`, and the id is namespaced.
    const copilot = buildWiringDoc({ ...base, targets: [wiringTarget()], agents: ["copilot"] });
    expect(copilot).toMatch(/`#tool:vscode\/askQuestions`/);
    // Either way the plain-text ask stays as the fallback — never a skipped question.
    expect(claude).toMatch(/If that tool is not available in this session, ask in plain text/);
    expect(claude).toContain("Want me to clean up the installation artifacts");
  });

  it("leaves the Cleanup question plain-text where no question tool is reachable", () => {
    // Codex has `request_user_input`, but it is Plan-mode only (openai/codex#11536)
    // and a session reading this file is normally in Default mode — naming a tool
    // it cannot call is worse than not naming one.
    for (const agent of ["codex", "antigravity", "acme-ai"]) {
      const doc = buildWiringDoc({ ...base, targets: [wiringTarget()], agents: [agent] });
      expect(doc).toContain("Want me to clean up the installation artifacts");
      expect(doc).not.toMatch(/AskUserQuestion|ask question tool|askQuestions|request_user_input/);
    }
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

  it("pre-approves the .mcp.json server for Claude at project scope", () => {
    const dir = tmp();
    const PATH = process.env.PATH;
    try {
      // Hermetic: with no PATH there is no `claude` to shell out to, so this
      // exercises the JSON-merge fallback instead of really installing a plugin
      // and running `claude mcp add` against the developer's machine.
      process.env.PATH = "";
      applyAgent("claude", ctx(dir));
      expect(existsSync(join(dir, ".mcp.json"))).toBe(true);
      const settings = JSON.parse(
        readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"),
      );
      // Without this Claude reports "⏸ Pending approval" and `claude mcp login` exits 1.
      expect(settings.enabledMcpjsonServers).toEqual(["shipeasy"]);
    } finally {
      process.env.PATH = PATH;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Claude native install commands", () => {
  it("installs the plugin at BOTH scopes, declaring project scope in-repo", () => {
    for (const scope of ["user", "project"] as const) {
      const { marketplace, install } = claudePluginArgv(scope);
      // Without an explicit --scope both default to user, which is what made
      // project scope skip the plugin (and its slash commands) entirely.
      expect(marketplace).toEqual([
        "plugin",
        "marketplace",
        "add",
        "shipeasy-ai/shipeasy",
        "--scope",
        scope,
      ]);
      expect(install).toEqual(["plugin", "install", "shipeasy@shipeasy", "--scope", scope]);
    }
  });

  it("pins the project on the `claude mcp add` entry, both ways", () => {
    const argv = claudeMcpAddArgv({ cwd: "/tmp/x", scope: "project", force: false, dryRun: false, projectId: "p-1" });
    // The plugin bundles the UNPINNED mcp.shipeasy.ai/mcp, so this entry is the
    // only thing making tool calls land on the bound project.
    expect(argv).toContain("https://mcp.shipeasy.ai/p/p-1/mcp");
    expect(argv).toContain("X-Project-Id: p-1");
    expect(argv.slice(0, 4)).toEqual(["mcp", "add", "--transport", "http"]);
    // `--scope project` is what writes `.mcp.json`; user scope would write
    // ~/.claude.json, which nothing else in this file reads.
    expect(argv.join(" ")).toContain("--scope project");
  });

  it("carries no Authorization header into the committable project entry", () => {
    // `.mcp.json` is committed. A bearer written there would be a live 90-day
    // admin key in git, shared with every teammate — so project scope stays on
    // OAuth no matter what token setup is holding.
    const argv = claudeMcpAddArgv({
      cwd: "/tmp/x",
      scope: "project",
      force: false,
      dryRun: false,
      projectId: "p-1",
      mcpToken: "sdk_admin_secret",
    });
    expect(argv.join(" ")).not.toContain("Authorization");
    expect(argv.join(" ")).not.toContain("sdk_admin_secret");
  });

  it("skips the native MCP path at user scope and off-PATH", () => {
    const PATH = process.env.PATH;
    try {
      expect(addClaudeMcpNative({ cwd: "/tmp/x", scope: "user", force: false, dryRun: false })).toBeNull();
      process.env.PATH = "";
      expect(addClaudeMcpNative({ cwd: "/tmp/x", scope: "project", force: false, dryRun: false })).toBeNull();
    } finally {
      process.env.PATH = PATH;
    }
  });
});

describe("bearerForPath — where a pre-authenticating header may be written", () => {
  const base = { cwd: "/repo", force: false, dryRun: false, projectId: "p-1" };
  // Same reason as the registerMcp block: the real-write test below must not
  // reach `copilot mcp add` and mutate the developer's own user config, nor
  // land in their real VS Code profile.
  const realPath = process.env.PATH;
  const realHome = process.env.HOME;
  let fakeHome: string;
  beforeEach(() => {
    process.env.PATH = "";
    fakeHome = tmp();
    process.env.HOME = fakeHome;
  });
  afterEach(() => {
    process.env.PATH = realPath;
    process.env.HOME = realHome;
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("is undefined without a token", () => {
    expect(bearerForPath("/home/me/.cursor/mcp.json", { ...base, scope: "user" })).toBeUndefined();
  });

  it("refuses any path inside the repo — those files get committed", () => {
    const ctx = { ...base, scope: "project" as const, mcpToken: "sdk_admin_x" };
    for (const p of ["/repo/.mcp.json", "/repo/.cursor/mcp.json", "/repo/.vscode/mcp.json"]) {
      expect(bearerForPath(p, ctx)).toBeUndefined();
    }
  });

  it("allows a path outside the repo, private to this machine's user", () => {
    const ctx = { ...base, scope: "user" as const, mcpToken: "sdk_admin_x" };
    expect(bearerForPath("/home/me/.claude/settings.json", ctx)).toBe("sdk_admin_x");
    expect(bearerForPath("/home/me/.copilot/mcp-config.json", ctx)).toBe("sdk_admin_x");
  });

  it("is decided by the PATH, not the agent — the bug this replaced", () => {
    // Copilot writes TWO configs. Keying the decision off the agent handed the
    // token to both, putting a live admin key in the repo's `.vscode/mcp.json`.
    const ctx = { ...base, scope: "user" as const, mcpToken: "sdk_admin_x" };
    expect(bearerForPath("/home/me/.copilot/mcp-config.json", ctx)).toBe("sdk_admin_x");
    expect(bearerForPath("/repo/.vscode/mcp.json", ctx)).toBeUndefined();
  });

  it("never leaks the token into a repo config even when it is written for real", () => {
    const dir = tmp();
    try {
      const written = registerMcp("copilot", {
        cwd: dir,
        scope: "user",
        force: false,
        dryRun: false,
        projectId: "p-1",
        mcpToken: "sdk_admin_LEAKCANARY",
      });
      expect(written.action).not.toBe("error");
      // Nothing committable is written at all — the entry lives in the VS Code
      // user profile, which is where the bearer is allowed to go…
      expect(existsSync(join(dir, ".vscode", "mcp.json"))).toBe(false);
      const profile = readFileSync(vscodeUserMcpPath(), "utf8");
      expect(profile).toContain("sdk_admin_LEAKCANARY");
      // …and carrying it is the whole point: VS Code authenticates on the
      // header, so it never gets a 401 and never opens an OAuth browser flow.
      expect(JSON.parse(profile).servers.shipeasy.headers.Authorization).toBe(
        "Bearer sdk_admin_LEAKCANARY",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("puts the token in an Authorization header on the server spec", () => {
    const spec = serverSpec("p-1", "sdk_admin_x");
    expect(spec.headers.Authorization).toBe("Bearer sdk_admin_x");
    // …and leaves it off entirely when there's no bearer, rather than writing
    // an empty or placeholder value the server would reject in-band.
    expect(serverSpec("p-1").headers.Authorization).toBeUndefined();
  });
});

describe("copilotMcpAddArgv — the Copilot CLI's own `mcp add`", () => {
  it("uses the documented remote-server form", () => {
    // Verified against `copilot mcp add --help`: `--transport http <name> <url>`
    // plus repeatable `--header "K: V"` — same shape as `claude mcp add`, with
    // no scope flag (it always writes the CLI's user config).
    const argv = copilotMcpAddArgv({
      cwd: "/tmp/x",
      scope: "project",
      force: false,
      dryRun: false,
      projectId: "p-1",
    });
    expect(argv.slice(0, 6)).toEqual([
      "mcp",
      "add",
      "--transport",
      "http",
      "shipeasy",
      "https://mcp.shipeasy.ai/p/p-1/mcp",
    ]);
    expect(argv).not.toContain("--scope");
    expect(argv).toContain("X-Project-Id: p-1");
  });

  // The header rides along only when the Copilot CLI is actually installed —
  // `mcpBearer` gates on it, because the credential belongs in that CLI's own
  // private user config and never in the committable `.vscode/mcp.json`. So
  // PATH is an INPUT here: stub the binary rather than inherit the dev machine's
  // (which is why this passed locally and failed in CI, where copilot is absent).
  const withCopilotOnPath = <T>(present: boolean, fn: () => T): T => {
    const prev = process.env.PATH;
    const dir = mkdtempSync(join(tmpdir(), "se-path-"));
    try {
      if (present) writeFileSync(join(dir, "copilot"), "#!/bin/sh\n", { mode: 0o755 });
      process.env.PATH = dir;
      return fn();
    } finally {
      process.env.PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  };

  const ctxWithToken = {
    cwd: "/tmp/x",
    scope: "project" as const,
    force: false,
    dryRun: false,
    projectId: "p-1",
    mcpToken: "sdk_admin_x",
  };

  it("carries the bearer when setup has a session key", () => {
    const argv = withCopilotOnPath(true, () => copilotMcpAddArgv(ctxWithToken));
    expect(argv).toContain("Authorization: Bearer sdk_admin_x");
  });

  // The bearer no longer hangs off "is the CLI on PATH". `copilot mcp add`
  // writes `~/.copilot/mcp-config.json`, which is private whether or not the
  // binary happens to be reachable from this process — and the argv is only
  // ever SPAWNED behind an `onPath` guard, so gating the header as well only
  // ever produced a credential-free entry on a machine that was about to get a
  // credentialled one.
  it("carries the bearer regardless of PATH — the file it writes is always private", () => {
    const argv = withCopilotOnPath(false, () => copilotMcpAddArgv(ctxWithToken));
    expect(argv).toContain("Authorization: Bearer sdk_admin_x");
    expect(argv).toContain("X-Project-Id: p-1");
  });
});

describe("bootstrapTasks — what the instrumentation session is offered for", () => {
  it("gates each task on the module that gives it a backend", () => {
    // Offering see() wiring with no ops module would produce reports with
    // nowhere to land; offering metrics with no release module would produce
    // events nothing reads.
    expect(bootstrapTasks(["ops"]).map((t) => t.key)).toEqual(["errors"]);
    expect(bootstrapTasks(["flags"]).map((t) => t.key)).toEqual(["metrics"]);
    expect(bootstrapTasks(["ops", "flags"]).map((t) => t.key)).toEqual(["errors", "metrics"]);
  });

  it("offers nothing when neither module is enabled", () => {
    expect(bootstrapTasks([])).toEqual([]);
    expect(bootstrapTasks(["i18n"])).toEqual([]);
  });
});

describe("bootstrapPrompt — the brief handed to the harness", () => {
  const prompt = (features: string[]) => bootstrapPrompt(bootstrapTasks(features), "proj_1");

  it("names the skills to load and the project it is instrumenting", () => {
    const p = prompt(["ops", "flags"]);
    expect(p).toContain("proj_1");
    for (const skill of ["shipeasy-see", "shipeasy-ops", "shipeasy-metrics", "shipeasy-alerts"]) {
      expect(p, `must load ${skill}`).toContain(skill);
    }
  });

  it("carries only the enabled module's task", () => {
    const opsOnly = prompt(["ops"]);
    expect(opsOnly).toContain("TASK — error tracking");
    expect(opsOnly).not.toContain("TASK — metrics + alerts");
    expect(opsOnly).not.toContain("shipeasy-alerts");

    const releaseOnly = prompt(["flags"]);
    expect(releaseOnly).toContain("TASK — metrics + alerts");
    expect(releaseOnly).not.toContain("TASK — error tracking");
  });

  it("states the configured-SDK prerequisite — instrumenting comes after wiring", () => {
    // see() and track() calls can't work before configure(), so a session that
    // starts on an unwired repo has to finish the wiring first.
    const p = prompt(["ops"]);
    expect(p).toContain("PREREQUISITE");
    expect(p).toContain(WIRING_FILENAME);
  });

  it("keeps the same safety rules as the wiring doc", () => {
    const p = prompt(["ops", "flags"]);
    expect(p).toContain("Never print, log, echo, or commit a key value");
    expect(p).toMatch(/Do NOT commit/);
    expect(p).not.toMatch(/sdk_server_[a-z0-9]/i); // var shapes only, never a value
  });

  it("tells the agent to read the codebase rather than pattern-match a checklist", () => {
    // The whole point of the step: a module enable is backend-only, so the
    // signal has to come from what THIS app does.
    const p = prompt(["ops", "flags"]);
    expect(p).toContain("READ it first");
    expect(p).toMatch(/not from a generic SaaS checklist/);
    expect(p).toMatch(/never grep the codebase for what is being measured/);
    // Guardrails against over-instrumenting.
    expect(p).toMatch(/Do NOT instrument control flow/);
    expect(p).toMatch(/ASK the user for the\s+number rather than inventing an SLO/);
  });

  it("gives every task a verification gate", () => {
    for (const t of bootstrapTasks(["ops", "flags"])) {
      expect(t.instructions, `${t.key} needs a gate`).toContain("Gate:");
    }
  });
});

describe("appBaseUrl", () => {
  // The trigger hand-off and the closing "Dashboard:" line are both built on
  // this, and a run with no stored session takes the fallback — which is most
  // runs, since either can be reached before anyone logs in. `app.shipeasy.ai`
  // has never been provisioned (NXDOMAIN), so a wrong fallback here doesn't even
  // produce a 404 page; the dashboard is served from the apex.
  it("falls back to the apex host, never an app.* subdomain", () => {
    const cfgHome = mkdtempSync(join(tmpdir(), "se-nocreds-"));
    const prev = { ...process.env };
    try {
      process.env.XDG_CONFIG_HOME = cfgHome;
      delete process.env.SHIPEASY_CLI_TOKEN;
      delete process.env.SHIPEASY_PROJECT_ID;
      expect(appBaseUrl()).toBe("https://shipeasy.ai");
    } finally {
      process.env = prev;
      rmSync(cfgHome, { recursive: true, force: true });
    }
  });
});

describe("TRUST_SESSION_PROMPT", () => {
  // Claude queues a positional prompt behind the trust dialog, so this is what
  // the user lands on the moment they accept it.
  it("is a slash command, so the trust session does no agent work", () => {
    expect(TRUST_SESSION_PROMPT.startsWith("/")).toBe(true);
    // Prose would start a turn in a session we opened purely to collect trust —
    // and that session runs WITHOUT --dangerously-skip-permissions.
    expect(TRUST_SESSION_PROMPT).not.toMatch(/\s/);
  });

  it("is `/exit`, so the trust session closes itself", () => {
    // The session exists to collect ONE keystroke — the trust dialog. Claude
    // runs the queued positional prompt the moment that dialog clears, so
    // `/exit` hands the terminal straight back to `shipeasy setup` instead of
    // parking the user in a chat REPL. Authorization is its own step now, so
    // there is nothing else for this session to do.
    expect(TRUST_SESSION_PROMPT).toBe("/exit");
  });
});

describe("parseClaudeServerState — read against real `claude mcp get` output", () => {
  // Captured verbatim from claude 2.1.220; the wording is what we branch on.
  const PENDING = [
    "shipeasy:",
    "  Scope: Project config (shared via .mcp.json)",
    "  Status: ⏸ Pending approval (run `claude` to approve)",
    "  Type: http",
  ].join("\n");
  const CONNECTED = [
    "shipeasy:",
    "  Scope: Project config (shared via .mcp.json)",
    "  Status: ✔ Connected",
    "  Type: http",
  ].join("\n");

  it("tells a pending server from a connected one", () => {
    expect(parseClaudeServerState(PENDING)).toBe("pending");
    expect(parseClaudeServerState(CONNECTED)).toBe("connected");
  });

  it("never reads the pending line as connected", () => {
    // It mentions the server and a status; only the pending phrase may win.
    expect(parseClaudeServerState(PENDING)).not.toBe("connected");
  });

  it("returns null on no output, so we fall back instead of guessing", () => {
    expect(parseClaudeServerState("")).toBeNull();
    expect(parseClaudeServerState("   \n ")).toBeNull();
  });

  it("reports anything else as other", () => {
    expect(parseClaudeServerState("No MCP server named shipeasy")).toBe("other");
  });
});

describe("approveProjectMcpServer", () => {
  it("merges into existing settings instead of clobbering them", () => {
    const dir = tmp();
    try {
      const path = join(dir, ".claude", "settings.local.json");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(
        path,
        JSON.stringify({ enabledMcpjsonServers: ["shadcn"], permissions: { allow: ["Bash"] } }),
      );

      approveProjectMcpServer(ctx(dir));

      const settings = JSON.parse(readFileSync(path, "utf8"));
      expect(settings.enabledMcpjsonServers).toEqual(["shadcn", "shipeasy"]);
      expect(settings.permissions).toEqual({ allow: ["Bash"] }); // unrelated keys survive
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent and writes nothing under dryRun", () => {
    const dir = tmp();
    try {
      expect(approveProjectMcpServer(ctx(dir, { dryRun: true })).action).toBe("updated");
      expect(existsSync(join(dir, ".claude", "settings.local.json"))).toBe(false);

      approveProjectMcpServer(ctx(dir));
      const again = approveProjectMcpServer(ctx(dir));
      expect(again.action).toBe("skipped");
      const settings = JSON.parse(
        readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"),
      );
      expect(settings.enabledMcpjsonServers).toEqual(["shipeasy"]); // not duplicated
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("mcpAuthHandoff — the one-time MCP OAuth authorization step", () => {
  // Empty PATH so no agent binary is found: the readiness probes resolve to
  // `unknown` on every machine, instead of the run depending on whether the
  // developer happens to have an authorized `cursor-agent` installed.
  const realPath = process.env.PATH;
  beforeEach(() => {
    process.env.PATH = "";
  });
  afterEach(() => {
    process.env.PATH = realPath;
    vi.restoreAllMocks();
    delete process.env.SHIPEASY_AGENT;
  });

  it("has a browser-authorize instruction for every agent", () => {
    const agents: readonly AgentId[] = ALL_AGENT_IDS;
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
    // ...and that authorizing does NOT hand its own running session the tools —
    // MCP servers load at session start, so the honest next move is a restart.
    // (`explain` hard-wraps, so the phrase can straddle a line break.)
    expect(out).toMatch(/restart\s+this\s+session/i);
  });

  it("is a no-op when no agents were wired", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await mcpAuthHandoff([], false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("prints no heading of its own — authorization is its own numbered setup step", async () => {
    // `runSetup` owns the "9. Authorize the MCP connection" heading so the step
    // still announces itself when there are no agents to authorize. If this
    // function printed one too, every run would show the heading twice.
    process.env.SHIPEASY_AGENT = "1";
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));

    await mcpAuthHandoff(["codex"], false);

    const out = logs.join("\n");
    expect(out).not.toMatch(/─{4}/); // the heading rule
    expect(out).not.toMatch(/Authorize the MCP connection/);
    expect(out).toMatch(/OAuth/); // it still explains what's about to happen
  });

  it("scripts the login for agents whose CLI can do it, and only those", () => {
    // Claude, Cursor and Codex all ship an `mcp login`. Codex used to be left out
    // on the belief that it "prompts on first tool use" — so setup printed a hint
    // and opened nothing, and the user met the sign-in as a 401 much later.
    for (const a of ["claude", "cursor", "codex"] as AgentId[]) {
      expect(MCP_AUTH_COMMANDS[a]?.argv).toEqual(["mcp", "login", "shipeasy"]);
    }
    // Copilot authorizes from its own UI; neither Google client has an `mcp
    // login` at all. All three keep the printed instruction instead of a bogus
    // shell-out — and the instruction must actually exist, or `runMcpAuth`
    // hands back an undefined detail and this assertion passes vacuously.
    for (const a of ["copilot", "antigravity", "gemini"] as AgentId[]) {
      expect(MCP_AUTH_COMMANDS[a]).toBeUndefined();
      expect(MCP_AUTH_INSTRUCTIONS[a]).toBeTruthy();
      expect(runMcpAuth(a)).toEqual({ action: "manual", detail: MCP_AUTH_INSTRUCTIONS[a] });
    }
    // Codex's instruction is the manual form of the same command, for a build
    // whose `mcp login` doesn't exist yet.
    expect(MCP_AUTH_INSTRUCTIONS.codex).toMatch(/codex mcp login shipeasy/);
  });
});

describe("wiringPlanLines — what we promise the launched agent will do", () => {
  const plan = (over: Partial<Parameters<typeof wiringPlanLines>[0]> = {}) => ({
    targets: [wiringTarget()],
    devtools: [] as DevtoolsSurface[],
    features: [] as string[],
    ...over,
  });

  it("always covers the SDK init, identity wiring, and the ask-before-commit rule", () => {
    const lines = wiringPlanLines(plan());
    expect(lines.join("\n")).toMatch(/configure the SDK once at the startup entry point/);
    expect(lines.join("\n")).toMatch(/identity \+ targeting attributes/);
    expect(lines.at(-1)).toMatch(/never commits unless you say yes/);
    expect(lines.at(-1)).toMatch(/never pushes/);
  });

  it("reflects THIS run's choices — overlay, ops, i18n, deferred install", () => {
    const lines = wiringPlanLines(
      plan({
        targets: [wiringTarget({ sdkInstalled: false, installCmd: "pnpm add @shipeasy/sdk" })],
        devtools: ["browser"],
        features: ["ops", "i18n"],
      }),
    ).join("\n");
    expect(lines).toMatch(/finish the SDK package install in apps\/web\//);
    expect(lines).toMatch(/devtools overlay tag in that same <head> block/);
    expect(lines).toMatch(/see\(\) primitive/);
    expect(lines).toMatch(/translatable i18n keys/);
  });

  it("promises the RN mount, not a <script> tag, on a React Native run", () => {
    // The two surfaces are different work: one edits an HTML shell, the other
    // mounts a component and needs a registered deep-link scheme.
    const lines = wiringPlanLines(plan({ devtools: ["react-native"] })).join("\n");
    expect(lines).toMatch(/React Native devtools overlay at your app root/);
    expect(lines).toMatch(/deep-link scheme/);
    expect(lines).not.toMatch(/<script> tag/);
  });

  it("omits what wasn't chosen (no overlay/ops/i18n lines when they're off)", () => {
    const lines = wiringPlanLines(plan({ features: ["flags"] })).join("\n");
    expect(lines).not.toMatch(/devtools overlay/);
    expect(lines).not.toMatch(/see\(\)/);
    expect(lines).not.toMatch(/i18n/);
  });
});
