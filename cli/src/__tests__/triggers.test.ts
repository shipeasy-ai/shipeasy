import { describe, it, expect } from "vitest";
import {
  TRIGGER_PLATFORMS,
  normalizePlatform,
  orderTriggerPlatforms,
  triggerSetupUrl,
} from "../setup/triggers";
import { buildCopilotAgentFile } from "../setup/copilot-agent";

describe("normalizePlatform", () => {
  it("accepts each guided platform id", () => {
    for (const p of TRIGGER_PLATFORMS) expect(normalizePlatform(p.id)).toBe(p.id);
  });

  it("aliases jules → gemini and is case/space tolerant", () => {
    expect(normalizePlatform("jules")).toBe("gemini");
    expect(normalizePlatform("  CLAUDE ")).toBe("claude");
  });

  it("returns null for unknown or empty values", () => {
    expect(normalizePlatform("windsurf")).toBeNull();
    expect(normalizePlatform("")).toBeNull();
    expect(normalizePlatform(null)).toBeNull();
    expect(normalizePlatform(undefined)).toBeNull();
  });
});

describe("orderTriggerPlatforms", () => {
  it("keeps canonical order and recommends nothing when no agents wired", () => {
    const ordered = orderTriggerPlatforms([]);
    expect(ordered.map((p) => p.id)).toEqual(TRIGGER_PLATFORMS.map((p) => p.id));
    expect(ordered.every((p) => !p.recommended)).toBe(true);
  });

  it("floats wired agents to the top, tagged recommended, rest below", () => {
    const ordered = orderTriggerPlatforms(["copilot", "cursor"]);
    // recommended first (in canonical order: cursor precedes copilot)
    expect(ordered.slice(0, 2).map((p) => p.id)).toEqual(["cursor", "copilot"]);
    expect(ordered.slice(0, 2).every((p) => p.recommended)).toBe(true);
    // the rest stay below and are not recommended
    expect(ordered.slice(2).map((p) => p.id)).toEqual(["claude", "codex", "gemini"]);
    expect(ordered.slice(2).every((p) => !p.recommended)).toBe(true);
  });

  it("maps the jules agent id to the gemini platform", () => {
    const ordered = orderTriggerPlatforms(["jules"]);
    expect(ordered[0]).toMatchObject({ id: "gemini", recommended: true });
  });

  it("ignores unknown agent ids", () => {
    const ordered = orderTriggerPlatforms(["windsurf", "claude"]);
    expect(ordered[0]).toMatchObject({ id: "claude", recommended: true });
    expect(ordered.filter((p) => p.recommended)).toHaveLength(1);
  });
});

describe("triggerSetupUrl", () => {
  it("points at the hosted dashboard triggers wizard with a provider deep link", () => {
    expect(triggerSetupUrl("https://app.shipeasy.ai", "prj_123", "claude")).toBe(
      "https://app.shipeasy.ai/dashboard/prj_123/triggers?provider=claude",
    );
  });

  it("omits the query when no platform is preselected", () => {
    expect(triggerSetupUrl("https://app.shipeasy.ai", "prj_123", null)).toBe(
      "https://app.shipeasy.ai/dashboard/prj_123/triggers",
    );
  });

  it("strips a trailing slash from the base URL", () => {
    expect(triggerSetupUrl("https://app.shipeasy.ai/", "prj_1", "cursor")).toBe(
      "https://app.shipeasy.ai/dashboard/prj_1/triggers?provider=cursor",
    );
  });

  it("adds secretsDone=1 when the CLI already wrote the Copilot Agents secrets", () => {
    expect(
      triggerSetupUrl("https://app.shipeasy.ai", "prj_1", "copilot", { secretsDone: true }),
    ).toBe("https://app.shipeasy.ai/dashboard/prj_1/triggers?provider=copilot&secretsDone=1");
  });

  it("omits secretsDone when the flag is false", () => {
    expect(
      triggerSetupUrl("https://app.shipeasy.ai", "prj_1", "copilot", { secretsDone: false }),
    ).toBe("https://app.shipeasy.ai/dashboard/prj_1/triggers?provider=copilot");
  });

  it("carries the agent name when the CLI wrote the custom-agent file", () => {
    expect(
      triggerSetupUrl("https://app.shipeasy.ai", "prj_1", "copilot", {
        secretsDone: true,
        agent: "shipeasy",
      }),
    ).toBe(
      "https://app.shipeasy.ai/dashboard/prj_1/triggers?provider=copilot&secretsDone=1&agent=shipeasy",
    );
  });
});

describe("buildCopilotAgentFile", () => {
  it("writes the documented path with the local-stdio MCP server + token secret", () => {
    const { path, content } = buildCopilotAgentFile({ projectId: "prj_xyz" });
    expect(path).toBe(".github/agents/shipeasy.agent.md");
    expect(content).toContain("name: shipeasy");
    expect(content).toContain("target: github-copilot");
    expect(content).toContain("type: local");
    expect(content).toContain("args: ['-y', '@shipeasy/mcp']");
    expect(content).toContain("SHIPEASY_PROJECT_ID: 'prj_xyz'");
    expect(content).toContain(
      "SHIPEASY_CLI_TOKEN: ${{ secrets.COPILOT_MCP_SHIPEASY_CLI_TOKEN }}",
    );
    expect(content).toContain("shipeasy-ops-work");
  });
});
