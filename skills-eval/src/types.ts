/** A tool expectation: an exact tool name, or an OR-group (any-of). */
export type ToolExpectation = string | string[];

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
   * Expected MCP tool suffixes. An entry is either a tool name (that exact tool
   * must be called) or an array of names meaning "any one of these is
   * acceptable" (an OR-group). This lets a flow require, say, a `*_list` dedup
   * check AND one of several terminal actions:
   *   ["ops_list", ["ops_create", "ops_bug"]]   // list, then create OR bug
   * Semantics via `tools_match`:
   *  - "all" (default when non-empty): every entry satisfied (each name called;
   *    each OR-group has at least one member called).
   *  - "any": at least one entry satisfied.
   *  - "none": candidates only, not asserted (seed default — promote them).
   */
  expect_tools: ToolExpectation[];
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
  /**
   * Outcome check: resource names (by substring) that must exist on the server
   * after the run. The authoritative "did it actually get created" signal.
   *   "expect_state": { "events": ["checkout"], "experiments": ["checkout"] }
   */
  expect_state?: ExpectState;
  /** Free-form note carried through to the report. */
  note?: string;
}

/** Per resource type, name-substrings that must exist post-run. */
export interface ExpectState {
  events?: string[];
  metrics?: string[];
  experiments?: string[];
  flags?: string[];
  killswitches?: string[];
  alerts?: string[];
  /** ops queue items (bugs/features) — matched on title/summary. */
  ops?: string[];
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
  /** null = no expect_state; else whether the resources exist post-run. */
  statePass: boolean | null;
  /** Human-readable post-run state (new vs pre-existing resources). */
  stateDetail: string;
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

/** Is one expectation entry satisfied by the set of called tools? */
export function expectationMet(entry: ToolExpectation, called: ReadonlySet<string>): boolean {
  return Array.isArray(entry) ? entry.some((t) => called.has(t)) : called.has(entry);
}

/** Flatten expectations to a plain name list (for validation / display). */
export function flattenTools(expect: ToolExpectation[]): string[] {
  return expect.flatMap((e) => (Array.isArray(e) ? e : [e]));
}

/** Render one expectation entry for the report. */
export function labelExpectation(entry: ToolExpectation): string {
  return Array.isArray(entry) ? `(${entry.join(" | ")})` : entry;
}
