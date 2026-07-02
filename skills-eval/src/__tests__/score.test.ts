import { describe, expect, it } from "vitest";
import { scoreCase } from "../score.js";
import type { EvalCase, Observation } from "../types.js";

const base: EvalCase = {
  id: "shipeasy-flags/create",
  prompt: "create a feature flag",
  expect_skill: "shipeasy-flags",
  expect_tools: ["release_flags_create"],
  tools_match: "all",
};

const run = (skills: string[], tools: string[]): Observation => ({
  skills,
  tools,
  otherTools: [],
});

describe("scoreCase", () => {
  it("passes when skill + tool hit on every run", () => {
    const r = scoreCase(base, [
      run(["shipeasy-flags"], ["release_flags_create"]),
      run(["shipeasy-flags"], ["release_flags_create"]),
    ], 0.67);
    expect(r.pass).toBe(true);
    expect(r.skillHitRate).toBe(1);
    expect(r.toolHitRate).toBe(1);
  });

  it("passes above threshold, fails below it (nondeterminism tolerance)", () => {
    const runs = [
      run(["shipeasy-flags"], ["release_flags_create"]),
      run(["shipeasy-flags"], ["release_flags_create"]),
      run(["shipeasy-metrics"], []), // one miss
    ];
    expect(scoreCase(base, runs, 0.66).pass).toBe(true); // 2/3 ≥ 0.66
    expect(scoreCase(base, runs, 0.9).pass).toBe(false); // 2/3 < 0.9
  });

  it("reports the wrong skill it actually saw", () => {
    const r = scoreCase(base, [run(["shipeasy-metrics"], [])], 0.67);
    expect(r.pass).toBe(false);
    expect(r.misses.join(" ")).toContain("shipeasy-metrics");
  });

  it("'any' semantics: one of the listed tools suffices", () => {
    const c: EvalCase = {
      ...base,
      expect_tools: ["release_flags_create", "release_configs_create"],
      tools_match: "any",
    };
    const r = scoreCase(c, [run(["shipeasy-flags"], ["release_configs_create"])], 0.67);
    expect(r.toolHitRate).toBe(1);
    expect(r.pass).toBe(true);
  });

  it("'none' semantics: tools are informational, not asserted", () => {
    const c: EvalCase = { ...base, tools_match: "none" };
    const r = scoreCase(c, [run(["shipeasy-flags"], [])], 0.67);
    expect(r.pass).toBe(true); // skill fired; tools not required
  });

  it("forbidden tool fails the case even when skill+tool hit", () => {
    const c: EvalCase = { ...base, forbid_tools: ["release_flags_archive"] };
    const r = scoreCase(c, [
      run(["shipeasy-flags"], ["release_flags_create", "release_flags_archive"]),
    ], 0.67);
    expect(r.pass).toBe(false);
    expect(r.cleanRate).toBe(0);
    expect(r.misses.join(" ")).toContain("forbidden");
  });
});
