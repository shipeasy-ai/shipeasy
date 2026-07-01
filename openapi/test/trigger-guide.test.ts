import { describe, expect, it } from "vitest";
import {
  providerFromClientName,
  providerFromEnv,
  triggerGuideOp,
  TRIGGER_PROVIDERS,
} from "../src/custom/trigger-guide.js";
import { TRIGGER_PROVIDER_META, TRIGGER_PROVIDER_SECTIONS } from "../src/custom/trigger-guide-content.js";

describe("trigger guide op", () => {
  it("covers every provider with meta, a section, and a guide", async () => {
    expect(TRIGGER_PROVIDERS.length).toBe(10);
    for (const p of TRIGGER_PROVIDERS) {
      expect(TRIGGER_PROVIDER_META[p]).toBeDefined();
      expect(TRIGGER_PROVIDER_SECTIONS[p].length).toBeGreaterThan(200);
      const out = (await triggerGuideOp.run({ provider: p })) as { provider: string; guide: string };
      expect(out.provider).toBe(p);
      // Every guide carries the shared trigger prompt + auth rules.
      expect(out.guide).toContain("SHIPEASY_CLI_TOKEN");
      expect(out.guide).toContain("Mint a restricted");
    }
  });

  it("rejects an unknown provider with the provider list", async () => {
    await expect(async () => triggerGuideOp.run({ provider: "emacs" })).rejects.toThrow(/One of: claude/);
  });

  it("returns the provider index when nothing is given or detectable", async () => {
    const out = (await triggerGuideOp.run({})) as { provider: string | null; providers?: unknown[] };
    // Under a detectable harness (e.g. this test running inside Claude Code)
    // the op resolves it; otherwise it returns the index. Both are valid.
    if (out.provider === null) expect(out.providers).toHaveLength(10);
    else expect(TRIGGER_PROVIDERS).toContain(out.provider);
  });

  it("no shipped content references the retired slash commands or TRIGGER-INSTALL.md", () => {
    for (const p of TRIGGER_PROVIDERS) {
      expect(TRIGGER_PROVIDER_SECTIONS[p]).not.toMatch(/\/shipeasy:/);
      expect(TRIGGER_PROVIDER_SECTIONS[p]).not.toContain("TRIGGER-INSTALL.md");
      expect(TRIGGER_PROVIDER_SECTIONS[p]).not.toContain("create_trigger");
    }
  });

  it("maps MCP client names to providers", () => {
    expect(providerFromClientName("claude-code")).toBe("claude");
    expect(providerFromClientName("Cursor (vscode)")).toBe("cursor");
    expect(providerFromClientName("codex-mcp-client")).toBe("codex");
    expect(providerFromClientName("gemini-cli")).toBe("gemini");
    expect(providerFromClientName("jules")).toBe("gemini");
    expect(providerFromClientName("some-unknown-agent")).toBeNull();
    expect(providerFromClientName(undefined)).toBeNull();
  });

  it("detects harnesses from env markers", () => {
    expect(providerFromEnv({ CLAUDECODE: "1" })).toBe("claude");
    expect(providerFromEnv({ CURSOR_TRACE_ID: "x" })).toBe("cursor");
    expect(providerFromEnv({ GEMINI_CLI: "1" })).toBe("gemini");
    expect(providerFromEnv({})).toBeNull();
  });
});
