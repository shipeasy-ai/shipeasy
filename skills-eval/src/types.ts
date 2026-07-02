/** A single behavioural test case: a prompt + what we expect the agent to do. */
export interface EvalCase {
  /** Stable id, e.g. "shipeasy-flags/rollout". */
  id: string;
  /** The user prompt fed to `claude -p`. */
  prompt: string;
  /** Skill we expect to fire (bare name, e.g. "shipeasy-flags"). */
  expect_skill: string;
  /**
   * MCP tool suffixes we expect to be called (e.g. "release_flags_create").
   * Semantics controlled by `tools_match`:
   *  - "all" (default): every listed tool must be called at least once.
   *  - "any": at least one listed tool must be called.
   *  - "none": these are candidates the seeder found; not yet asserted
   *    (treated as informational until you promote them). Prune to real
   *    expectations and switch to "all"/"any".
   */
  expect_tools: string[];
  tools_match?: "all" | "any" | "none";
  /** Tool suffixes that must NOT be called (e.g. "release_flags_archive"). */
  forbid_tools?: string[];
  /** Free-form note carried through to the report. */
  note?: string;
}

/** What we actually observed in one headless run of a case. */
export interface Observation {
  /** Bare skill names invoked (via the `Skill` tool), in order. */
  skills: string[];
  /** MCP tool suffixes called (prefix stripped), in order, with repeats. */
  tools: string[];
  /** Non-MCP, non-Skill tool names seen (Bash, Read, …) — for debugging. */
  otherTools: string[];
  /** Raw parse error, if the transcript couldn't be read. */
  error?: string;
}

export interface CaseResult {
  case: EvalCase;
  runs: Observation[];
  /** Fraction of runs where the expected skill fired. */
  skillHitRate: number;
  /** Fraction of runs where the tool expectation was satisfied. */
  toolHitRate: number;
  /** Fraction of runs with zero forbidden-tool calls. */
  cleanRate: number;
  /** True when every rate meets `threshold`. */
  pass: boolean;
  /** Human-readable reasons a case failed (empty when pass). */
  misses: string[];
}
