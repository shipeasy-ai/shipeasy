import { describe, it, expect } from "vitest";
import {
  FEATURE_SKILLS,
  marketplaceSkillRawUrl,
  marketplaceSkillSource,
  skillsForFeatures,
} from "../setup/skills-registry";
import { SKILLS_CLI_AGENT } from "../setup/agents";
import { substituteSdkSnippets } from "../setup/sdk-docs";

describe("skills registry", () => {
  it("maps each feature to its marketplace usage skill (not the removed *-install)", () => {
    expect(FEATURE_SKILLS.flags).toEqual(["shipeasy-flags"]);
    expect(FEATURE_SKILLS.ops).toEqual(["shipeasy-ops", "shipeasy-see"]);
    expect(FEATURE_SKILLS.i18n).toEqual(["shipeasy-i18n"]);
    for (const names of Object.values(FEATURE_SKILLS)) {
      for (const n of names) expect(n).not.toMatch(/-install$/);
    }
  });

  it("de-duplicates skills across selected features and ignores unknowns", () => {
    expect(skillsForFeatures(["flags", "ops"]).sort()).toEqual([
      "shipeasy-flags",
      "shipeasy-ops",
      "shipeasy-see",
    ]);
    expect(skillsForFeatures(["flags", "flags"])).toEqual(["shipeasy-flags"]);
    expect(skillsForFeatures(["nope"])).toEqual([]);
  });

  it("builds a GitHub tree-path source under the marketplace repo", () => {
    expect(marketplaceSkillSource("shipeasy-flags")).toBe(
      "shipeasy-ai/shipeasy/shipeasy/skills/shipeasy-flags",
    );
  });

  it("builds a raw-content URL for templated (snippet-baked) install", () => {
    expect(marketplaceSkillRawUrl("shipeasy-flags")).toBe(
      "https://raw.githubusercontent.com/shipeasy-ai/shipeasy/main/shipeasy/skills/shipeasy-flags/SKILL.md",
    );
    expect(marketplaceSkillRawUrl("shipeasy-flags", "v2")).toContain("/shipeasy-ai/shipeasy/v2/");
  });
});

describe("substituteSdkSnippets", () => {
  it("returns content unchanged (no network) when there are no placeholders", async () => {
    const body = "# Skill\n\n```ts\nconst x = 1;\n```\n";
    expect(await substituteSdkSnippets(body, "typescript")).toBe(body);
  });

  it("maps skills-CLI agents but never Claude (it uses the plugin) or Jules (cloud)", () => {
    expect(SKILLS_CLI_AGENT.claude).toBeUndefined();
    expect(SKILLS_CLI_AGENT.jules).toBeUndefined();
    expect(SKILLS_CLI_AGENT.cursor).toBe("cursor");
    expect(SKILLS_CLI_AGENT.codex).toBe("codex");
    expect(SKILLS_CLI_AGENT.copilot).toBe("copilot");
  });
});
