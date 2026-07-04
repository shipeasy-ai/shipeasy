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

const run = (
  skills: string[],
  tools: string[],
  extra: Partial<Observation> = {},
): Observation => ({
  skills,
  tools,
  toolCalls: tools.map((name) => ({ name, inputText: "{}" })),
  otherTools: [],
  askedUser: false,
  ...extra,
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

  it("OR-group entry: any member satisfies that entry (list AND one-of-terminal)", () => {
    const c: EvalCase = {
      id: "ops/file",
      prompt: "p",
      expect_skill: "shipeasy-ops",
      expect_tools: ["ops_list", ["ops_create", "ops_bug"]],
      tools_match: "all",
    };
    // list + bug satisfies (bug is a member of the OR-group)
    expect(scoreCase(c, [run(["shipeasy-ops"], ["ops_list", "ops_bug"])], 0.67).pass).toBe(true);
    // list alone does not (the terminal OR-group is unmet)
    const r = scoreCase(c, [run(["shipeasy-ops"], ["ops_list"])], 0.67);
    expect(r.pass).toBe(false);
    expect(r.misses.join(" ")).toContain("ops_create | ops_bug");
  });

  it("skillProxy: correct tool without a Skill tool-call passes (read case)", () => {
    // Skill didn't fire, but the expected tool did and no outcome is asserted.
    const r = scoreCase(
      { id: "metrics/list", prompt: "p", expect_skill: "shipeasy-metrics", expect_tools: ["metrics_list"], tools_match: "all" },
      [run([], ["metrics_list"])],
      0.67,
    );
    expect(r.pass).toBe(true);
    expect(r.skillProxy).toBe(true);
    expect(r.skillHitRate).toBe(0); // raw rate stays honest
    expect(r.misses).toEqual([]);
  });

  it("skillProxy needs a correct outcome when state is asserted", () => {
    const c: EvalCase = { ...base, expect_state: { flags: ["x"] } };
    // tool hit but state WRONG → no proxy, still fails.
    const bad = scoreCase(c, [run([], ["release_flags_create"])], 0.67, { pass: false, detail: "x MISSING" });
    expect(bad.skillProxy).toBe(false);
    expect(bad.pass).toBe(false);
    // tool hit AND state ok → proxy carries it.
    const good = scoreCase(c, [run([], ["release_flags_create"])], 0.67, { pass: true, detail: "flags:x (new)" });
    expect(good.skillProxy).toBe(true);
    expect(good.pass).toBe(true);
  });

  it("skillProxy does NOT rescue a case where the tool also missed", () => {
    const r = scoreCase(base, [run([], [])], 0.67); // no skill, no tool
    expect(r.skillProxy).toBe(false);
    expect(r.pass).toBe(false);
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

  it("expect_state: server-state result gates the case", () => {
    const c: EvalCase = { ...base, expect_state: { experiments: ["checkout"] } };
    const good = scoreCase(c, [run(["shipeasy-flags"], ["release_flags_create"])], 0.67, {
      pass: true,
      detail: "experiments:checkout-button (new)",
    });
    expect(good.statePass).toBe(true);
    expect(good.pass).toBe(true);
    const bad = scoreCase(c, [run(["shipeasy-flags"], ["release_flags_create"])], 0.67, {
      pass: false,
      detail: 'experiments:"checkout" MISSING',
    });
    expect(bad.statePass).toBe(false);
    expect(bad.pass).toBe(false);
    expect(bad.misses.join(" ")).toContain("server state wrong");
  });

  it("statePass is null when no expect_state", () => {
    const r = scoreCase(base, [run(["shipeasy-flags"], ["release_flags_create"])], 0.67);
    expect(r.statePass).toBeNull();
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

  it("expect_skills: every listed skill must fire in the run", () => {
    const c: EvalCase = {
      id: "x/multi",
      prompt: "p",
      expect_skills: ["shipeasy-flags", "shipeasy-alerts"],
      expect_tools: [],
      tools_match: "none",
    };
    expect(scoreCase(c, [run(["shipeasy-flags"], [])], 0.67).pass).toBe(false);
    expect(
      scoreCase(c, [run(["shipeasy-flags", "shipeasy-alerts"], [])], 0.67).pass,
    ).toBe(true);
  });

  it("expect_ask: requires AskUserQuestion", () => {
    const c: EvalCase = { ...base, expect_ask: true };
    expect(scoreCase(c, [run(["shipeasy-flags"], ["release_flags_create"])], 0.67).pass).toBe(false);
    const asked = run(["shipeasy-flags"], ["release_flags_create"], { askedUser: true });
    expect(scoreCase(c, [asked], 0.67).pass).toBe(true);
  });

  it("assert_args: substrings must appear in the tool input", () => {
    const c: EvalCase = {
      ...base,
      assert_args: [{ tool: "release_flags_create", contains: ["US", "alice@acme.com"] }],
    };
    const good = run(["shipeasy-flags"], ["release_flags_create"], {
      toolCalls: [{ name: "release_flags_create", inputText: '{"rules":["US"],"whitelist":["alice@acme.com"]}' }],
    });
    const bad = run(["shipeasy-flags"], ["release_flags_create"], {
      toolCalls: [{ name: "release_flags_create", inputText: '{"rules":["US"]}' }],
    });
    expect(scoreCase(c, [good], 0.67).pass).toBe(true);
    const r = scoreCase(c, [bad], 0.67);
    expect(r.pass).toBe(false);
    expect(r.misses.join(" ")).toContain("alice@acme.com");
  });

  it("expect_text_contains: passes when prose recommends the CLI, no skill needed", () => {
    const c: EvalCase = {
      id: "onboarding/set-up",
      prompt: "set up shipeasy",
      expect_tools: [],
      tools_match: "none",
      expect_text_contains: ["shipeasy setup"],
    };
    const good = run([], [], { text: "You should run `shipeasy setup` to get started." });
    const bad = run([], [], { text: "Let me create a flag for you." });
    expect(scoreCase(c, [good], 0.67).pass).toBe(true);
    const r = scoreCase(c, [bad], 0.67);
    expect(r.pass).toBe(false);
    expect(r.textHitRate).toBe(0);
    expect(r.misses.join(" ")).toContain("shipeasy setup");
  });

  it("assert_args with no tool matches across any call (ops_create OR ops_bug)", () => {
    const c: EvalCase = {
      id: "ops/ctx",
      prompt: "p",
      expect_skill: "shipeasy-ops",
      expect_tools: ["ops_create", "ops_bug"],
      tools_match: "any",
      assert_args: [{ contains: ["proration"] }],
    };
    const viaBug = run(["shipeasy-ops"], ["ops_bug"], {
      toolCalls: [{ name: "ops_bug", inputText: '{"body":"stale proration preview"}' }],
    });
    expect(scoreCase(c, [viaBug], 0.67).pass).toBe(true);
  });
});
