import type { CaseResult, EvalCase, Observation } from "./types.js";

/**
 * Score one case's K runs into pass-rates. Routing is probabilistic, so a case
 * passes on a *threshold* of runs, not a single boolean — e.g. threshold 0.8
 * means the expected skill must fire in ≥4 of 5 runs.
 */
export function scoreCase(
  c: EvalCase,
  runs: Observation[],
  threshold: number,
): CaseResult {
  const n = runs.length || 1;
  const match = c.tools_match ?? (c.expect_tools.length ? "all" : "any");

  let skillHits = 0;
  let toolHits = 0;
  let clean = 0;

  for (const run of runs) {
    if (run.skills.includes(c.expect_skill)) skillHits++;

    const called = new Set(run.tools);
    let toolOk: boolean;
    if (match === "none" || c.expect_tools.length === 0) {
      toolOk = true; // nothing asserted yet
    } else if (match === "any") {
      toolOk = c.expect_tools.some((t) => called.has(t));
    } else {
      toolOk = c.expect_tools.every((t) => called.has(t));
    }
    if (toolOk) toolHits++;

    const violated = (c.forbid_tools ?? []).some((t) => called.has(t));
    if (!violated) clean++;
  }

  const skillHitRate = skillHits / n;
  const toolHitRate = toolHits / n;
  const cleanRate = clean / n;

  const misses: string[] = [];
  if (skillHitRate < threshold)
    misses.push(
      `skill ${c.expect_skill} fired ${pct(skillHitRate)} (< ${pct(threshold)}); saw [${uniq(runs.flatMap((r) => r.skills)).join(", ") || "none"}]`,
    );
  if (match !== "none" && c.expect_tools.length && toolHitRate < threshold)
    misses.push(
      `tools ${match}[${c.expect_tools.join(", ")}] satisfied ${pct(toolHitRate)} (< ${pct(threshold)}); saw [${uniq(runs.flatMap((r) => r.tools)).join(", ") || "none"}]`,
    );
  if (cleanRate < 1)
    misses.push(`forbidden tool called in ${pct(1 - cleanRate)} of runs`);

  return {
    case: c,
    runs,
    skillHitRate,
    toolHitRate,
    cleanRate,
    pass: misses.length === 0,
    misses,
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];
