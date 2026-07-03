/**
 * Run the skill-routing eval: for every case, drive headless `claude -p` K times
 * against the LOCAL shipeasy MCP server, parse the tool-call transcript, and
 * score how often the expected skill fired and the expected tools were called.
 *
 *   pnpm --filter @shipeasy/skills-eval eval               # all cases
 *   pnpm --filter @shipeasy/skills-eval eval -- flags      # cases whose id/file matches "flags"
 *
 * Env (see README):
 *   SHIPEASY_EVAL_TOKEN         admin SDK key minted vs local backend  (required)
 *   SHIPEASY_EVAL_PROJECT_ID    project id for the binding + config     (required)
 *   SHIPEASY_EVAL_BASE_URL      local admin API base (default :3100)
 *   SHIPEASY_EVAL_K             runs per case (default 3)
 *   SHIPEASY_EVAL_THRESHOLD     pass threshold 0..1 (default 0.67)
 *   SHIPEASY_EVAL_MODE          "execute" (default, real calls) | "plan" (no side effects)
 *   SHIPEASY_EVAL_MODEL         --model (default "haiku": cases must route on the cheapest model)
 *   SHIPEASY_EVAL_CLAUDE_BIN    claude binary (default "claude")
 *   ANTHROPIC_API_KEY           required by headless claude
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { CASES_DIR } from "./catalog.js";
import { prepareEnv, readEnvConfigFromEnv } from "./prepare-env.js";
import { setupState, snapshotState, verifyState, verifyNoDuplicate } from "./verify-state.js";
import { parseTranscript } from "./transcript.js";
import { scoreCase } from "./score.js";
import { renderReport } from "./report.js";
import { expectedSkills, type CaseResult, type EvalCase, type Observation } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const filter = process.argv.slice(2).find((a) => !a.startsWith("--"));
const K = int(process.env.SHIPEASY_EVAL_K, 3);
const THRESHOLD = num(process.env.SHIPEASY_EVAL_THRESHOLD, 0.67);
const MODE = process.env.SHIPEASY_EVAL_MODE === "plan" ? "plan" : "execute";
const CLAUDE = process.env.SHIPEASY_EVAL_CLAUDE_BIN ?? "claude";
// Default to the cheapest model on purpose: routing must survive Haiku, not
// lean on a bigger model to rescue a weak skill description.
const MODEL = process.env.SHIPEASY_EVAL_MODEL ?? "haiku";

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

console.log(
  `skills-eval: ${cases.length} cases × ${K} runs, mode=${MODE}, model=${MODEL}` +
    `\nsandbox app: ${env.appDir ? env.appDir.replace(/.*\/packages\//, "packages/") : "(none)"}\n`,
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

  const runs: Observation[] = [];
  for (let i = 0; i < K; i++) {
    const obs = runOnce(c, i, env.mcpConfigPath, workdir, transcriptsDir);
    runs.push(obs);
    const skillOk = expectedSkills(c).every((s) => obs.skills.includes(s));
    process.stdout.write(obs.error ? "E" : skillOk ? "." : "x");
  }
  process.stdout.write(` ${c.id}\n`);

  const state = checksState ? await mergeState(c, before) : undefined;
  results.push(scoreCase(c, runs, THRESHOLD, state));
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
  mcpConfig: string,
  cwd: string,
  outDir: string,
): Observation {
  const args = buildClaudeArgs(c, mcpConfig);
  const res = spawnSync(CLAUDE, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: int(process.env.SHIPEASY_EVAL_TIMEOUT_MS, 240000),
    env: process.env,
  });
  const ndjson = res.stdout ?? "";
  writeFileSync(join(outDir, `${c.id.replace(/\//g, "__")}.${i}.jsonl`), ndjson);
  const empty = { skills: [], tools: [], toolCalls: [], otherTools: [], askedUser: false };
  if (res.error) return { ...empty, error: String(res.error) };
  if (!ndjson.trim())
    return { ...empty, error: `empty output (stderr: ${(res.stderr ?? "").slice(0, 300)})` };
  return parseTranscript(ndjson, skillNames);
}

/**
 * The headless invocation — centralised so the version-sensitive flags live in
 * ONE place. Smoke-test these against your installed `claude` once (see README)
 * and adjust here if a flag name has drifted.
 */
function buildClaudeArgs(c: EvalCase, mcpConfig: string): string[] {
  const args = [
    "-p",
    c.prompt,
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
    "--append-system-prompt",
    "You are being evaluated. Carry out the user's request directly using the available skills and MCP tools, then stop. Only ask the user a question if you genuinely cannot proceed without a decision that is theirs to make.",
  ];
  args.push("--model", MODEL);
  return args;
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
