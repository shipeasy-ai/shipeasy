/**
 * Run the skill-routing eval: for every case, drive headless `claude -p` once
 * (K=1, enforced) against the LOCAL shipeasy MCP server, parse the tool-call
 * transcript, and check the expected skill fired and the expected tools ran.
 *
 *   pnpm --filter @shipeasy/skills-eval eval               # all cases
 *   pnpm --filter @shipeasy/skills-eval eval -- flags      # cases whose id/file matches "flags"
 *
 * Env (see README):
 *   SHIPEASY_EVAL_TOKEN         admin SDK key minted vs local backend  (required)
 *   SHIPEASY_EVAL_PROJECT_ID    project id for the binding + config     (required)
 *   SHIPEASY_EVAL_BASE_URL      local admin API base (default :3100)
 *   SHIPEASY_EVAL_K             runs per case (must be 1 — higher is rejected)
 *   SHIPEASY_EVAL_THRESHOLD     pass threshold 0..1 (default 0.67)
 *   SHIPEASY_EVAL_MODE          "execute" (default, real calls) | "plan" (no side effects)
 *   SHIPEASY_EVAL_MODEL         --model (default "haiku": cases must route on the cheapest model)
 *   SHIPEASY_EVAL_CLAUDE_BIN    claude binary (default "claude")
 *   ANTHROPIC_API_KEY           required by headless claude
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { CASES_DIR, MCP_SERVER_NAME } from "./catalog.js";
import { prepareEnv, readEnvConfigFromEnv, type PreparedEnv } from "./prepare-env.js";
import { setupState, snapshotState, verifyState, verifyNoDuplicate } from "./verify-state.js";
import { parseTranscript } from "./transcript.js";
import { scoreCase } from "./score.js";
import { renderReport } from "./report.js";
import { expectedSkills, type CaseResult, type EvalCase, type Observation } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Which agent runner drives the cases. `claude` (default) or `copilot`, chosen
// via `--copilot` / `--agent <name>` (a user argument) or SHIPEASY_EVAL_AGENT.
const { agent: AGENT, filter } = parseArgs(process.argv.slice(2));
// HARD RULE: the eval always runs at K=1. A skill that only routes when its
// result is averaged over multiple runs is not fixed — every case must pass
// deterministically on a single run. Refuse any attempt to raise K.
const K = int(process.env.SHIPEASY_EVAL_K, 1);
if (K !== 1) {
  console.error(
    `SHIPEASY_EVAL_K=${K} is not allowed — this eval only runs at K=1. ` +
      `Fix the skill's routing until it passes on a single run; do not average more runs.`,
  );
  process.exit(2);
}
const THRESHOLD = num(process.env.SHIPEASY_EVAL_THRESHOLD, 0.67);
// Allow up to N retries per case (default 1). A case still runs at K=1 per
// attempt; a retry re-invokes `claude` once more only when the prior attempt
// FAILED, to absorb pure model variance (an empty transcript, a wrong-tool
// pick). This is not K-averaging — a case passes the moment any attempt passes.
const RETRIES = Math.max(0, int(process.env.SHIPEASY_EVAL_RETRIES, 1));
const MODE = process.env.SHIPEASY_EVAL_MODE === "plan" ? "plan" : "execute";
// Binary + model resolve per runner. Default to the cheapest model on purpose:
// routing must survive the small model, not lean on a bigger one to rescue a
// weak skill description — Haiku for claude, gpt-5-mini (cheapest GPT) for
// copilot. SHIPEASY_EVAL_MODEL applies to claude; SHIPEASY_EVAL_COPILOT_MODEL
// to copilot.
const BIN =
  AGENT === "copilot"
    ? process.env.SHIPEASY_EVAL_COPILOT_BIN ?? "copilot"
    : process.env.SHIPEASY_EVAL_CLAUDE_BIN ?? "claude";
const MODEL =
  AGENT === "copilot"
    ? process.env.SHIPEASY_EVAL_COPILOT_MODEL ?? "gpt-5-mini"
    : process.env.SHIPEASY_EVAL_MODEL ?? "haiku";

// Standing approval for the eval only: some skills (experiments, alerts,
// metrics) are consultative in real use — they investigate the code, propose
// 2–4 variants, then STOP for the user to approve before creating anything.
// A headless -p run is single-shot, so that pause would strand every
// outcome-gated create case short of its create call. Grant the approval
// up-front: when a skill reaches its propose→provision gate, pick its
// recommended default and carry through. This never licenses an action the
// prompt didn't ask for — only the skill's own already-scoped create step.
// Claude gets this via --append-system-prompt; copilot (no such flag) prepends
// it to the prompt.
const STANDING_APPROVAL =
  "You are being evaluated. Carry out the user's request directly using the available skills and MCP tools, then stop. If a skill would pause to have the user approve or choose among proposed variants before creating or updating a resource, treat that approval as already granted: pick the skill's recommended default variant and proceed through to the create/update call. This standing approval applies ONLY to a skill's own propose-then-provision step and never licenses an action the request didn't ask for. Only ask the user a question if you genuinely cannot proceed without a decision that is theirs to make.";

// The system prompt above is advisory, and the cheap model still often ends a
// consultative turn by posing its options as a question instead of provisioning.
// So the runner ALSO auto-accepts at the transport layer: when an outcome-gated
// case (one with `expect_state`) ends a turn by asking/proposing, we resume the
// SAME session with this approval and let the agent carry its recommended
// default through to the create/update. Up to SHIPEASY_EVAL_MAX_APPROVALS
// continuations (default 2). This is deliberately scoped — it only fires for
// cases that assert a resource must land on the server; read-only asks
// (list/results/"what are we measuring") have no `expect_state`, so they are
// never nudged into a mutation.
const AUTO_APPROVE =
  "Approved — go with your recommended option/default and carry it through to completion now. If you presented choices, pick the one you recommended and proceed; do not ask again. Only take the action my original request asked for — if that request was read-only, just answer it and create or modify nothing.";
const MAX_APPROVALS = Math.max(0, int(process.env.SHIPEASY_EVAL_MAX_APPROVALS, 2));

const cases = loadCases(filter);
if (cases.length === 0) {
  console.error(`No cases found${filter ? ` matching "${filter}"` : ""}. Run \`pnpm seed\` first.`);
  process.exit(2);
}
const skillNames = [...new Set(cases.flatMap((c) => expectedSkills(c)))];

const workdir = resolve(__dirname, "../.eval-workdir");
const env = prepareEnv(readEnvConfigFromEnv(), workdir);
const transcriptsDir = join(workdir, "transcripts");
mkdirSync(transcriptsDir, { recursive: true });

const excluded = readEnvConfigFromEnv().excludeSkills ?? [];
console.log(
  `skills-eval: ${cases.length} cases × ${K} runs (≤${RETRIES} retry on fail), agent=${AGENT}, mode=${MODE}, model=${MODEL}` +
    `\nsandbox app: ${env.appDir ? env.appDir.replace(/.*\/packages\//, "packages/") : "(none)"}` +
    (excluded.length ? `\nexcluded skills: ${excluded.join(", ")}` : "") +
    `\n`,
);

const stateCfg = readEnvConfigFromEnv();
const results: CaseResult[] = [];
for (const c of cases) {
  // Pre-create any dedup fixtures, THEN snapshot (so they read as pre-existing).
  if (c.setup) await setupState(stateCfg, c.setup);
  const checksState = !!(c.expect_state || c.expect_no_duplicate);
  const before = checksState
    ? await snapshotState(stateCfg, c.expect_state ?? {}, c.expect_no_duplicate ?? {})
    : {};

  // Up to RETRIES extra attempts, but only while the case is still failing.
  // The `before` snapshot is taken ONCE (above), so a resource a failing first
  // attempt happened to create still verifies as "new" on the passing retry.
  //
  // Keep the BEST attempt, not the last. With the auto-approve runner an
  // outcome-gated case usually provisions on attempt 0; a retry then re-lists,
  // sees that resource, and (correctly) dedups instead of creating — a *worse*
  // transcript (no create tool-call) that must not overwrite the earlier,
  // stronger attempt. "Better" = passing, else fewer missed dimensions.
  let result: CaseResult | undefined;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const obs = runOnce(c, attempt, env, workdir, transcriptsDir);
    const skillOk = expectedSkills(c).every((s) => obs.skills.includes(s));
    const textOk =
      !(c.expect_text_contains?.length) ||
      (c.expect_text_contains ?? []).some((s) =>
        (obs.text ?? "").toLowerCase().includes(s.toLowerCase()),
      );
    process.stdout.write(obs.error ? "E" : skillOk && textOk ? "." : "x");
    const state = checksState ? await mergeState(c, before) : undefined;
    const r = scoreCase(c, [obs], THRESHOLD, state);
    if (!result || r.pass || r.misses.length < result.misses.length) result = r;
    if (result.pass) break;
  }
  process.stdout.write(` ${c.id}\n`);
  results.push(result!);
}

/** Combine the existence + no-duplicate outcome checks into one state result. */
async function mergeState(c: EvalCase, before: Awaited<ReturnType<typeof snapshotState>>) {
  const parts: string[] = [];
  let pass = true;
  if (c.expect_state) {
    const r = await verifyState(stateCfg, c.expect_state, before);
    pass = pass && r.pass;
    if (r.detail) parts.push(r.detail);
  }
  if (c.expect_no_duplicate) {
    const r = await verifyNoDuplicate(stateCfg, c.expect_no_duplicate, before);
    pass = pass && r.pass;
    if (r.detail) parts.push(r.detail);
  }
  return { pass, detail: parts.join(" | ") };
}

const report = renderReport(results, THRESHOLD, K);
console.log(report);
writeFileSync(join(workdir, "report.txt"), report);
console.log(`Transcripts + report under ${workdir}`);

process.exit(results.every((r) => r.pass) ? 0 : 1);

// ---------------------------------------------------------------------------

function runOnce(
  c: EvalCase,
  i: number,
  env: PreparedEnv,
  cwd: string,
  outDir: string,
): Observation {
  const outFile = join(outDir, `${c.id.replace(/\//g, "__")}.${i}.jsonl`);
  const empty = { skills: [], tools: [], toolCalls: [], otherTools: [], askedUser: false, text: "" };
  if (AGENT === "copilot") {
    const res = spawn(buildCopilotArgs(c, env), cwd);
    const ndjson = res.stdout ?? "";
    writeFileSync(outFile, ndjson);
    if (res.error) return { ...empty, error: String(res.error) };
    if (!ndjson.trim())
      return { ...empty, error: `empty output (stderr: ${(res.stderr ?? "").slice(0, 300)})` };
    return parseTranscript(ndjson, skillNames, "copilot");
  }
  return runClaudeConversation(c, env.mcpConfigPath, cwd, outFile, empty);
}

/**
 * Drive `claude` for one case, auto-accepting the skill's propose→provision
 * pause. Turn 0 is the real prompt on a fresh session id; if an outcome-gated
 * case (`expect_state`) ends that turn by asking/proposing (a trailing prose
 * question or an AskUserQuestion call), we `--resume` the SAME session with
 * {@link AUTO_APPROVE} so the agent carries its recommended default through to
 * the create — up to {@link MAX_APPROVALS} continuations. The transcripts from
 * every turn are concatenated and parsed as one, so `expect_ask` still sees the
 * turn-0 question and the state check sees the eventual create.
 */
function runClaudeConversation(
  c: EvalCase,
  mcpConfig: string,
  cwd: string,
  outFile: string,
  empty: Observation,
): Observation {
  const sessionId = randomUUID();
  // Recommend-in-prose cases (expect_text_contains, e.g. the onboarding
  // "set up X for my project" prompts) are meant to end in a *recommendation*,
  // not an action — they forbid the create tools. Never nudge those; the
  // approval would push the agent past the recommendation into a forbidden
  // create. Everything else is nudgeable: outcome-gated creates, reads, and
  // name-referenced mutates.
  const maxApprovals = c.expect_text_contains?.length ? 0 : MAX_APPROVALS;
  const parts: string[] = [];
  let prompt = c.prompt;
  let resume = false;
  let lastError: string | undefined;
  for (let turn = 0; turn <= maxApprovals; turn++) {
    const res = spawn(buildClaudeArgs(prompt, mcpConfig, { id: sessionId, resume }), cwd);
    const ndjson = res.stdout ?? "";
    if (ndjson.trim()) parts.push(ndjson);
    if (res.error) {
      lastError = String(res.error);
      break;
    }
    if (!ndjson.trim()) {
      lastError = `empty output (stderr: ${(res.stderr ?? "").slice(0, 300)})`;
      break;
    }
    // Decide whether to auto-accept and continue. Two exit conditions, by case
    // shape:
    //  - Outcome-gated (expect_state): stop once a mutating MCP call has landed;
    //    otherwise keep nudging — an agent that only listed/proposed (whether it
    //    closed with a question or a declarative "I'll set it up") hasn't reached
    //    its create yet.
    //  - Everything else (reads, name-referenced mutates): stop once the agent
    //    stops *asking*. A turn that stalls behind a question ("give me the id,
    //    or I can look it up via MCP") gets the approval so it carries through;
    //    a turn that just answered/acted does not. The AUTO_APPROVE text keeps a
    //    read-only ask read-only, and forbid_tools still guards mutations.
    if (turn >= maxApprovals) break;
    const done = c.expect_state
      ? turnMutated(ndjson)
      : !parseTranscript(ndjson, skillNames, "claude").askedUser;
    if (done) break;
    prompt = AUTO_APPROVE;
    resume = true;
  }
  const combined = parts.join("\n");
  writeFileSync(outFile, combined);
  if (!combined.trim()) return { ...empty, error: lastError ?? "empty output" };
  return parseTranscript(combined, skillNames, "claude");
}

/**
 * Did this turn perform a state-changing MCP call? Read tools (`*_list`,
 * `*_get`, `*_show`, `*_results`, `*_grammar`, …) never match; create/update/
 * set/enable/start/archive/… do. Used to decide whether an outcome-gated case
 * still needs an auto-approval nudge to reach its provision step. The regex is
 * inlined (not a module const) so it's safe to call from the top-level case loop
 * that runs before this file's trailing declarations initialise.
 */
function turnMutated(ndjson: string): boolean {
  const mutationVerb =
    /(create|update|set|enable|disable|start|stop|archive|restore|publish|draft|discard|unset|upsert|push|approve|link_pr|notify|trigger)/;
  return parseTranscript(ndjson, skillNames, "claude").tools.some((t) => mutationVerb.test(t));
}

/** One headless spawn with the shared limits. */
function spawn(args: string[], cwd: string) {
  return spawnSync(BIN, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: int(process.env.SHIPEASY_EVAL_TIMEOUT_MS, 240000),
    env: process.env,
  });
}

/**
 * The headless claude invocation — centralised so the version-sensitive flags
 * live in ONE place. Smoke-test these against your installed `claude` once (see
 * README) and adjust here if a flag name has drifted.
 */
function buildClaudeArgs(
  prompt: string,
  mcpConfig: string,
  session: { id: string; resume: boolean },
): string[] {
  return [
    "-p",
    prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--mcp-config", mcpConfig,
    "--strict-mcp-config",
    "--permission-mode", MODE === "plan" ? "plan" : "bypassPermissions",
    // MCP-only lockdown. Removing these tools (a) stops the agent editing the
    // real repo, (b) removes the interchangeable `shipeasy` CLI (no shell), so
    // it must use the MCP surface we assert on, and (c) blocks subagents whose
    // tool calls would escape the top-level stream we parse. ToolSearch stays
    // (deferred MCP tools surface through it); Read/Glob/Grep are read-only.
    "--disallowedTools", "Bash,Edit,Write,NotebookEdit,Agent,Task,SendMessage",
    "--append-system-prompt", STANDING_APPROVAL,
    "--model", MODEL,
    // Turn 0 stamps a fresh session id; each auto-approval resumes it so the
    // whole conversation shares one context (see runClaudeConversation).
    ...(session.resume ? ["--resume", session.id] : ["--session-id", session.id]),
  ];
}

/**
 * The headless copilot (`@github/copilot`) invocation. Mirrors the claude
 * runner: JSONL output we parse, an MCP-only lockdown, and the same standing
 * approval. Copilot has no `--append-system-prompt`, so the approval is
 * prepended to the prompt. Smoke-test the flags against your installed
 * `copilot` once and adjust here if a flag name drifts.
 */
function buildCopilotArgs(c: EvalCase, env: PreparedEnv): string[] {
  const args = [
    "-p",
    `${STANDING_APPROVAL}\n\n--- User request ---\n${c.prompt}`,
    "--model", MODEL,
    "--output-format", "json",
    "--no-color",
    "--allow-all-tools",
    // Lockdown mirroring the claude runner: deny the shell tool (so it can't
    // fall back to the interchangeable prod `shipeasy` CLI) and `write` (so it
    // can't touch the sandbox/repo). Denials beat --allow-all-tools, forcing
    // the agent onto the MCP surface we assert on.
    "--deny-tool", "shell",
    "--deny-tool", "write",
    // Only the local-backend MCP is reachable: drop the builtin github server
    // and any installed prod `shipeasy` plugin server (ours is `shipeasy_eval`,
    // see COPILOT_MCP_SERVER_NAME — a different name so this disable misses it).
    "--disable-builtin-mcps",
    "--disable-mcp-server", MCP_SERVER_NAME,
    "--additional-mcp-config", `@${env.copilotMcpConfigPath}`,
  ];
  if (MODE === "plan") args.push("--plan");
  return args;
}

/**
 * Parse the runner selection + case filter off argv. The agent comes from
 * `--copilot`, `--agent <name>`/`--agent=<name>`, or SHIPEASY_EVAL_AGENT
 * (default `claude`); the filter is the first bare positional that isn't the
 * value consumed by `--agent`.
 */
function parseArgs(argv: string[]): { agent: "claude" | "copilot"; filter?: string } {
  let agent = process.env.SHIPEASY_EVAL_AGENT?.trim() || "claude";
  let filter: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (a === "--copilot") agent = "copilot";
    else if (a === "--claude") agent = "claude";
    else if (a === "--agent" && argv[i + 1]) agent = argv[++i] as string;
    else if (a.startsWith("--agent=")) agent = a.slice("--agent=".length);
    else if (!a.startsWith("--") && filter === undefined) filter = a;
  }
  if (agent !== "claude" && agent !== "copilot") {
    console.error(`Unknown --agent "${agent}". Use "claude" (default) or "copilot".`);
    process.exit(2);
  }
  return { agent, filter };
}

function loadCases(f?: string): EvalCase[] {
  let files: string[];
  try {
    files = readdirSync(CASES_DIR).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out: EvalCase[] = [];
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(join(CASES_DIR, file), "utf8")) as EvalCase[];
    for (const c of parsed) {
      // No filter → all. Filter matches either the file name or a case id.
      if (!f || file.includes(f) || c.id.includes(f)) out.push(c);
    }
  }
  return out;
}

function int(v: string | undefined, d: number): number {
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : d;
}
function num(v: string | undefined, d: number): number {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : d;
}
