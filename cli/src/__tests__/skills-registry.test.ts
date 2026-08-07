import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALWAYS_SKILLS,
  FEATURE_SKILLS,
  baseSkillNames,
  marketplaceSkillRawUrl,
  marketplaceSkillSource,
  setupSkillNames,
  skillsCliAgentsFor,
  skillsForFeatures,
} from "../setup/skills-registry";
import { SKILLS_CLI_AGENT } from "../setup/agents";
import { parseSkillDescription, substituteSdkSnippets, writeSkillDir } from "../setup/sdk-docs";

describe("skills registry", () => {
  it("maps each feature to its full marketplace skill set (not the removed *-install)", () => {
    expect(FEATURE_SKILLS.flags).toEqual([
      "shipeasy-experiments",
      "shipeasy-flags",
      "shipeasy-metrics",
      "shipeasy-migrate",
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
      "shipeasy-migrate",
      "shipeasy-ops",
      "shipeasy-ops-work",
      "shipeasy-see",
      "shipeasy-alerts",
    ]);
    expect(skillsForFeatures(["flags", "flags"])).toEqual([
      "shipeasy-experiments",
      "shipeasy-flags",
      "shipeasy-metrics",
      "shipeasy-migrate",
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

  // The registry is what setup and upgrade install FROM — a skill that ships in
  // the plugin but is in no feature list (as `shipeasy-migrate` was) reaches
  // Claude via the plugin and no other agent, ever.
  it("covers every skill shipped in the marketplace plugin", () => {
    const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../shipeasy/skills");
    const shipped = readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(shipped.length).toBeGreaterThan(0);
    expect(baseSkillNames().sort()).toEqual(shipped);
  });

  it("routes claude through the skills CLI only in-repo (user scope = plugin)", () => {
    expect(skillsCliAgentsFor(["claude"], "project")).toEqual(["claude-code"]);
    expect(skillsCliAgentsFor(["claude"], "user")).toEqual([]);
    expect(skillsCliAgentsFor(["claude", "cursor", "antigravity"], "user")).toEqual([
      "cursor",
      "antigravity",
      "antigravity-cli",
    ]);
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

  it("maps skills-CLI agents but never Claude (it uses the plugin)", () => {
    expect(SKILLS_CLI_AGENT.claude).toBeUndefined();
    expect(SKILLS_CLI_AGENT.cursor).toEqual(["cursor"]);
    expect(SKILLS_CLI_AGENT.codex).toEqual(["codex"]);
    expect(SKILLS_CLI_AGENT.copilot).toEqual(["github-copilot"]);
  });

  // Antigravity can't take Claude's plugin route (`agy plugin install` resolves
  // only Google's own marketplaces), and it keeps IDE and CLI skills apart, so
  // it's the one agent that maps to two names.
  it("routes both Google agents through the skills CLI", () => {
    expect(SKILLS_CLI_AGENT.antigravity).toEqual(["antigravity", "antigravity-cli"]);
    expect(SKILLS_CLI_AGENT.gemini).toEqual(["gemini-cli"]);
  });
});

describe("writeSkillDir", () => {
  it("replaces a previous install instead of merging over it", () => {
    const base = mkdtempSync(join(tmpdir(), "se-write-skill-"));
    try {
      writeSkillDir(
        { "SKILL.md": "v1\n", "references/gone.md": "dropped upstream\n" },
        "shipeasy-ops",
        base,
      );
      writeSkillDir({ "SKILL.md": "v2\n", "references/kept.md": "new\n" }, "shipeasy-ops", base);
      const dir = join(base, "shipeasy-ops");
      expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toBe("v2\n");
      expect(existsSync(join(dir, "references", "kept.md"))).toBe(true);
      // A reference the new version doesn't ship must not survive the update.
      expect(existsSync(join(dir, "references", "gone.md"))).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("only removes a directory that is actually a skill (has SKILL.md)", () => {
    const base = mkdtempSync(join(tmpdir(), "se-write-skill-"));
    try {
      // A non-skill dir at the same name keeps its contents — we merge into it
      // rather than deleting somebody else's files.
      writeSkillDir({ "notes.md": "user's own\n" }, "shipeasy-ops", base);
      writeSkillDir({ "SKILL.md": "v1\n" }, "shipeasy-ops", base);
      expect(existsSync(join(base, "shipeasy-ops", "notes.md"))).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
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
