/** A param-level check: a tool call whose input must contain given substrings. */
export interface ArgAssertion {
  /**
   * MCP tool suffix the args must appear on, e.g. "release_flags_create".
   * Omit to match across ANY tool call (e.g. when either `ops_create` or the
   * `ops_bug` sugar is acceptable).
   */
  tool?: string;
  /**
   * Case-insensitive substrings that must ALL appear in that call's
   * JSON-stringified input. Crude but effective: asserts the agent actually
   * passed the country / emails / event name the prompt described, not just
   * that it called the right tool.
   */
  contains: string[];
}

/** A single behavioural test case: a prompt + what we expect the agent to do. */
export interface EvalCase {
  /** Stable id, e.g. "shipeasy-flags/rich-targeting". */
  id: string;
  /** The user prompt fed to `claude -p`. Write it like a human would speak. */
  prompt: string;
  /** Skill we expect to fire (shorthand for a single-skill `expect_skills`). */
  expect_skill?: string;
  /** Skills we expect to fire — ALL must appear (for cross-skill flows). */
  expect_skills?: string[];
  /**
   * MCP tool suffixes we expect (e.g. "release_flags_create"). Semantics via
   * `tools_match`:
   *  - "all" (default when non-empty): every listed tool called at least once.
   *  - "any": at least one listed tool called.
   *  - "none": candidates only, not asserted (seed default — promote them).
   */
  expect_tools: string[];
  tools_match?: "all" | "any" | "none";
  /** Tool suffixes that must NOT be called (e.g. "release_flags_archive"). */
  forbid_tools?: string[];
  /**
   * Expect the agent to ask the user a clarifying question (the AskUserQuestion
   * tool) — e.g. after creating a kill switch, offer to add a metric + alert.
   */
  expect_ask?: boolean;
  /** Param-level assertions on specific tool calls. */
  assert_args?: ArgAssertion[];
  /** Free-form note carried through to the report. */
  note?: string;
}

/** One MCP tool call: suffix name + its stringified input (for arg checks). */
export interface ToolCall {
  name: string;
  inputText: string;
}

/** What we actually observed in one headless run of a case. */
export interface Observation {
  /** Bare skill names invoked (via the `Skill` tool), in order. */
  skills: string[];
  /** MCP tool suffixes called (prefix stripped), in order, with repeats. */
  tools: string[];
  /** MCP calls with their stringified input, for `assert_args`. */
  toolCalls: ToolCall[];
  /** Non-MCP, non-Skill tool names seen (Bash, Read, AskUserQuestion, …). */
  otherTools: string[];
  /** True if the agent invoked AskUserQuestion. */
  askedUser: boolean;
  /** Raw parse error, if the transcript couldn't be read. */
  error?: string;
}

export interface CaseResult {
  case: EvalCase;
  runs: Observation[];
  /** Fraction of runs where every expected skill fired. */
  skillHitRate: number;
  /** Fraction of runs where the tool expectation was satisfied. */
  toolHitRate: number;
  /** Fraction of runs where every arg assertion held. */
  argHitRate: number;
  /** Fraction of runs where the agent asked (only meaningful if expect_ask). */
  askHitRate: number;
  /** Fraction of runs with zero forbidden-tool calls. */
  cleanRate: number;
  /** True when every asserted rate meets `threshold`. */
  pass: boolean;
  /** Human-readable reasons a case failed (empty when pass). */
  misses: string[];
}

/** The skills a case expects, normalising `expect_skill` / `expect_skills`. */
export function expectedSkills(c: EvalCase): string[] {
  if (c.expect_skills?.length) return c.expect_skills;
  return c.expect_skill ? [c.expect_skill] : [];
}
