import { describe, it, expect } from "vitest";
import {
  ALWAYS_SKILLS,
  FEATURE_SKILLS,
  baseSkillNames,
  marketplaceSkillRawUrl,
  marketplaceSkillSource,
  setupSkillNames,
  skillsForFeatures,
} from "../setup/skills-registry";
import { SKILLS_CLI_AGENT } from "../setup/agents";
import { parseSkillDescription, substituteSdkSnippets } from "../setup/sdk-docs";

describe("skills registry", () => {
  it("maps each feature to its full marketplace skill set (not the removed *-install)", () => {
    expect(FEATURE_SKILLS.flags).toEqual([
      "shipeasy-experiments",
      "shipeasy-flags",
      "shipeasy-metrics",
    ]);
    expect(FEATURE_SKILLS.ops).toEqual([
      "shipeasy-ops",
      "shipeasy-ops-work",
      "shipeasy-see",
      "shipeasy-alerts",
      "shipeasy-metrics",
    ]);
    expect(FEATURE_SKILLS.i18n).toEqual(["shipeasy-i18n"]);
    for (const names of Object.values(FEATURE_SKILLS)) {
      for (const n of names) expect(n).not.toMatch(/-install$/);
    }
    // shipeasy-setup rides along with every setup, not with any one feature.
    expect(ALWAYS_SKILLS).toEqual(["shipeasy-setup"]);
    for (const names of Object.values(FEATURE_SKILLS)) {
      expect(names).not.toContain("shipeasy-setup");
    }
  });

  it("de-duplicates skills across selected features and ignores unknowns", () => {
    expect(skillsForFeatures(["flags", "ops"])).toEqual([
      "shipeasy-experiments",
      "shipeasy-flags",
      "shipeasy-metrics",
      "shipeasy-ops",
      "shipeasy-ops-work",
      "shipeasy-see",
      "shipeasy-alerts",
    ]);
    expect(skillsForFeatures(["flags", "flags"])).toEqual([
      "shipeasy-experiments",
      "shipeasy-flags",
      "shipeasy-metrics",
    ]);
    expect(skillsForFeatures(["nope"])).toEqual([]);
  });

  it("setupSkillNames always includes shipeasy-setup, plus the feature skills", () => {
    // No features → just the always-on setup skill.
    expect(setupSkillNames([])).toEqual(["shipeasy-setup"]);
    // i18n + setup, deduped and setup-first.
    expect(setupSkillNames(["i18n"])).toEqual(["shipeasy-setup", "shipeasy-i18n"]);
    // shipeasy-metrics shared by flags + ops appears once; setup once.
    const all = setupSkillNames(["flags", "ops"]);
    expect(all[0]).toBe("shipeasy-setup");
    expect(all.filter((n) => n === "shipeasy-metrics")).toHaveLength(1);
    expect(all.filter((n) => n === "shipeasy-setup")).toHaveLength(1);
  });

  it("baseSkillNames is the full deduped catalogue including shipeasy-setup", () => {
    const names = baseSkillNames();
    expect(names).toContain("shipeasy-setup");
    expect(new Set(names).size).toBe(names.length); // deduped
    for (const n of ["shipeasy-flags", "shipeasy-ops", "shipeasy-i18n", "shipeasy-alerts"]) {
      expect(names).toContain(n);
    }
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
    expect(SKILLS_CLI_AGENT.copilot).toBe("github-copilot");
  });
});

describe("parseSkillDescription", () => {
  it("pulls the description out of YAML frontmatter, stripping quotes", () => {
    const md = `---\nname: shipeasy-flags\ndescription: "Create and roll out feature gates."\n---\n\n# Body\n`;
    expect(parseSkillDescription(md)).toBe("Create and roll out feature gates.");
  });

  it("handles unquoted descriptions and returns empty when absent", () => {
    expect(parseSkillDescription("---\ndescription: Manage translatable copy\n---\n")).toBe(
      "Manage translatable copy",
    );
    expect(parseSkillDescription("# No frontmatter here\n")).toBe("");
    expect(parseSkillDescription("---\nname: x\n---\n")).toBe("");
  });
});
