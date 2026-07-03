import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CASES_DIR, KNOWN_TOOLS_SET } from "../catalog.js";
import { expectedSkills, flattenTools, type EvalCase } from "../types.js";

/** Longest a prompt may be. Prompts must read like a quick human utterance. */
const MAX_PROMPT_LEN = 140;

const files = readdirSync(CASES_DIR).filter((f) => f.endsWith(".json"));
const cases: EvalCase[] = files.flatMap(
  (f) => JSON.parse(readFileSync(join(CASES_DIR, f), "utf8")) as EvalCase[],
);

describe("committed cases are well-formed", () => {
  it("has cases to check", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it("prompts stay short (no essay prompts)", () => {
    const long = cases
      .filter((c) => c.prompt.length > MAX_PROMPT_LEN)
      .map((c) => `${c.id} (${c.prompt.length} chars)`);
    expect(long, `prompts over ${MAX_PROMPT_LEN} chars — tighten them: ${long.join("; ")}`).toEqual([]);
  });

  it("every case asserts a skill or text, and has a unique id", () => {
    const ids = new Set<string>();
    for (const c of cases) {
      // Most cases name a skill; onboarding cases have no skill to fire (the
      // setup skill was removed — onboarding delegates to the `shipeasy setup`
      // CLI), so they assert on text instead. One of the two must be present.
      const asserts = expectedSkills(c).length > 0 || (c.expect_text_contains?.length ?? 0) > 0;
      expect(asserts, `${c.id} asserts neither a skill nor expect_text_contains`).toBe(true);
      expect(ids.has(c.id), `duplicate id ${c.id}`).toBe(false);
      ids.add(c.id);
    }
  });

  it("every referenced tool is a real tool", () => {
    const bad: string[] = [];
    for (const c of cases) {
      const refs = [
        ...flattenTools(c.expect_tools),
        ...(c.forbid_tools ?? []),
        ...(c.assert_args ?? []).map((a) => a.tool).filter((t): t is string => !!t),
      ];
      for (const t of refs) if (!KNOWN_TOOLS_SET.has(t)) bad.push(`${c.id} → ${t}`);
    }
    expect(bad, `unknown tool names: ${bad.join("; ")}`).toEqual([]);
  });
});
