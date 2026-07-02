import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CASES_DIR, KNOWN_TOOLS_SET } from "../catalog.js";
import { expectedSkills, type EvalCase } from "../types.js";

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

  it("every case names a skill and has a unique id", () => {
    const ids = new Set<string>();
    for (const c of cases) {
      expect(expectedSkills(c).length, `${c.id} has no expect_skill`).toBeGreaterThan(0);
      expect(ids.has(c.id), `duplicate id ${c.id}`).toBe(false);
      ids.add(c.id);
    }
  });

  it("every referenced tool is a real tool", () => {
    const bad: string[] = [];
    for (const c of cases) {
      const refs = [
        ...c.expect_tools,
        ...(c.forbid_tools ?? []),
        ...(c.assert_args ?? []).map((a) => a.tool).filter((t): t is string => !!t),
      ];
      for (const t of refs) if (!KNOWN_TOOLS_SET.has(t)) bad.push(`${c.id} → ${t}`);
    }
    expect(bad, `unknown tool names: ${bad.join("; ")}`).toEqual([]);
  });
});
