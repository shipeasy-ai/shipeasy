import { describe, expect, it } from "vitest";
import { extractTriggers, extractTools, parseSkill } from "../parse-skill.js";

const FLAGS_MD = `---
name: shipeasy-flags
description: Create, evaluate, and roll out Shipeasy feature gates and dynamic configs. Trigger on "feature flag", "feature gate", "rollout", "kill switch", "dynamic config", "remote config".
user-invocable: true
---

# Shipeasy feature gates & configs

\`\`\`
mcp tool: release_flags_create {
  "name": "checkout_v2"
}
\`\`\`
Also see the \`release_configs_create\` tool. Not a tool: \`some_prose_thing\`.
`;

describe("extractTriggers", () => {
  it("pulls the quoted phrases after 'Trigger on'", () => {
    expect(extractTriggers(FLAGS_MD)).toEqual([
      "feature flag",
      "feature gate",
      "rollout",
      "kill switch",
      "dynamic config",
      "remote config",
    ]);
  });

  it("drops phrases containing placeholders", () => {
    const md = `Trigger on "alert me when", "notify when <metric> exceeds", "alerting".`;
    expect(extractTriggers(md)).toEqual(["alert me when", "alerting"]);
  });
});

describe("extractTools", () => {
  it("keeps only real tool suffixes across reference styles", () => {
    const tools = extractTools(FLAGS_MD);
    expect(tools).toContain("release_flags_create"); // mcp tool: form
    expect(tools).toContain("release_configs_create"); // backtick form
    expect(tools).not.toContain("some_prose_thing"); // not in catalogue
  });
});

describe("parseSkill", () => {
  it("bundles name + triggers + tools", () => {
    const p = parseSkill("shipeasy-flags", FLAGS_MD);
    expect(p.name).toBe("shipeasy-flags");
    expect(p.triggers.length).toBe(6);
    expect(p.tools).toContain("release_flags_create");
  });
});
