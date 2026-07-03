import {
  expectationMet,
  expectedSkills,
  labelExpectation,
  type CaseResult,
  type EvalCase,
  type Observation,
} from "./types.js";

/**
 * Score one case's K runs into pass-rates. Routing is probabilistic, so a case
 * passes on a *threshold* of runs, not a single boolean — e.g. threshold 0.8
 * means each asserted dimension must hold in ≥4 of 5 runs.
 */
export function scoreCase(
  c: EvalCase,
  runs: Observation[],
  threshold: number,
): CaseResult {
  const n = runs.length || 1;
  const wantSkills = expectedSkills(c);
  const match = c.tools_match ?? (c.expect_tools.length ? "all" : "none");

  let skillHits = 0;
  let toolHits = 0;
  let argHits = 0;
  let askHits = 0;
  let clean = 0;

  for (const run of runs) {
    if (wantSkills.every((s) => run.skills.includes(s))) skillHits++;

    const called = new Set(run.tools);
    let toolOk: boolean;
    if (match === "none" || c.expect_tools.length === 0) toolOk = true;
    else if (match === "any") toolOk = c.expect_tools.some((e) => expectationMet(e, called));
    else toolOk = c.expect_tools.every((e) => expectationMet(e, called));
    if (toolOk) toolHits++;

    if ((c.assert_args ?? []).every((a) => argHolds(a, run))) argHits++;
    if (run.askedUser) askHits++;
    if (!(c.forbid_tools ?? []).some((t) => called.has(t))) clean++;
  }

  const skillHitRate = skillHits / n;
  const toolHitRate = toolHits / n;
  const argHitRate = argHits / n;
  const askHitRate = askHits / n;
  const cleanRate = clean / n;

  const misses: string[] = [];
  if (wantSkills.length && skillHitRate < threshold)
    misses.push(
      `skills [${wantSkills.join(", ")}] fired ${pct(skillHitRate)} (< ${pct(threshold)}); saw [${uniq(runs.flatMap((r) => r.skills)).join(", ") || "none"}]`,
    );
  if (match !== "none" && c.expect_tools.length && toolHitRate < threshold)
    misses.push(
      `tools ${match}[${c.expect_tools.map(labelExpectation).join(", ")}] satisfied ${pct(toolHitRate)} (< ${pct(threshold)}); saw [${uniq(runs.flatMap((r) => r.tools)).join(", ") || "none"}]`,
    );
  if ((c.assert_args ?? []).length && argHitRate < threshold)
    misses.push(
      `arg checks held ${pct(argHitRate)} (< ${pct(threshold)}); ${describeArgs(c, runs)}`,
    );
  if (c.expect_ask && askHitRate < threshold)
    misses.push(`expected the agent to ask (AskUserQuestion) — did so ${pct(askHitRate)} (< ${pct(threshold)})`);
  if (cleanRate < 1)
    misses.push(`forbidden tool called in ${pct(1 - cleanRate)} of runs`);

  return {
    case: c,
    runs,
    skillHitRate,
    toolHitRate,
    argHitRate,
    askHitRate,
    cleanRate,
    pass: misses.length === 0,
    misses,
  };
}

/** Does some matching call in this run contain all required substrings? */
function argHolds(a: { tool?: string; contains: string[] }, run: Observation): boolean {
  const calls = a.tool ? run.toolCalls.filter((tc) => tc.name === a.tool) : run.toolCalls;
  if (!calls.length) return false;
  return calls.some((tc) => {
    const hay = tc.inputText.toLowerCase();
    return a.contains.every((s) => hay.includes(s.toLowerCase()));
  });
}

/** For the report: which substrings went missing, across runs. */
function describeArgs(c: EvalCase, runs: Observation[]): string {
  return (c.assert_args ?? [])
    .map((a) => {
      const label = a.tool ?? "any tool";
      const missing = a.contains.filter(
        (s) => !runs.some((r) =>
          r.toolCalls.some((tc) => (!a.tool || tc.name === a.tool) && tc.inputText.toLowerCase().includes(s.toLowerCase())),
        ),
      );
      return missing.length ? `${label} never saw [${missing.join(", ")}]` : `${label} ok`;
    })
    .join("; ");
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];
