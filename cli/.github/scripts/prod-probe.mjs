#!/usr/bin/env node
// Production eval probe — composed from existing `shipeasy` CLI commands plus
// the public /sdk/evaluate endpoint. NOT a new CLI command: this is CI glue that
// the prod-probe workflow runs on a schedule against the prod project.
//
// It answers "do flags/experiments still bucket correctly in prod?" three ways:
//
//   1. Inventory          — `shipeasy flags list --json`: the configured intent
//                           (rollout %, enabled, targeting) we check the edge
//                           against. Drift here is just reported.
//   2. Experiment SRM     — `shipeasy experiments status <name> --json`: the
//                           server already runs a sample-ratio-mismatch χ² over
//                           real exposures. srm_detected === 1 means assignment
//                           is skewed in prod. Pure command composition.
//   3. Rollout distribution — POST /sdk/evaluate for a deterministic synthetic
//                           cohort and assert each pure-percentage gate's
//                           observed pass-rate matches its configured rollout
//                           within a binomial band. This is the part real-traffic
//                           SRM can't cover (gates have no SRM), and it needs no
//                           oracle: the edge does the bucketing, we only tally.
//
// Exit non-zero on any drift so the Action fails (and notifies). Env:
//   SHIPEASY_CLI_TOKEN, SHIPEASY_PROJECT_ID  — CLI auth (the CLI reads these)
//   SHIPEASY_EDGE_URL                        — e.g. https://cdn.shipeasy.ai
//   SHIPEASY_CLIENT_KEY                      — canary CLIENT key (enables leg 3)
//   SHIPEASY_PROBE_MEMBER_EMAIL              — known @team/@owner member (leg C5)
//   SHIPEASY_PROBE_NONMEMBER_EMAIL           — optional; defaults to an invalid addr
//   SHIPEASY_PROBE_EXPERIMENT                — running 2-group experiment (leg #3)
//   SHIPEASY_PROBE_METRIC_EVENT              — its goal metric's backing event (leg #3)
//   PROBE_COHORT (default 500), PROBE_CLI ("npx --yes @shipeasy/cli@latest")

import { execFileSync } from "node:child_process";

const EDGE_URL = (process.env.SHIPEASY_EDGE_URL || "https://cdn.shipeasy.ai").replace(/\/$/, "");
const CLIENT_KEY = process.env.SHIPEASY_CLIENT_KEY || "";
const COHORT = Number(process.env.PROBE_COHORT || "500");
const CONCURRENCY = 20;
const CLI = (process.env.PROBE_CLI || "npx --yes @shipeasy/cli@latest").split(" ");

let failed = 0;
const annotate = (msg) => console.log(`::error::${msg}`);
const ok = (msg) => console.log(`✔ ${msg}`);

function cli(args) {
  return JSON.parse(cliText(args));
}

// Non-JSON CLI invocation (for commands like `experiments reanalyze` that print
// a human line). Returns stdout text.
function cliText(args) {
  return execFileSync(CLI[0], [...CLI.slice(1), ...args], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"],
  });
}

// One /sdk/evaluate call for a user context → full response ({flags, configs,
// killswitches, experiments}). The edge does all bucketing/targeting; the probe
// only inspects the verdicts.
async function evaluate(user) {
  const res = await fetch(`${EDGE_URL}/sdk/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sdk-key": CLIENT_KEY },
    body: JSON.stringify({ user }),
  });
  if (!res.ok) throw new Error(`/sdk/evaluate ${res.status}`);
  return res.json();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mutating CLI commands (unlike read commands) don't resolve the project from
// SHIPEASY_PROJECT_ID — they need an explicit --project (or a bound .shipeasy,
// absent in CI). Append it from the env.
function reanalyzeArgs(exp) {
  const p = process.env.SHIPEASY_PROJECT_ID;
  return ["experiments", "reanalyze", exp, ...(p ? ["--project", p] : [])];
}

// ── 1 + 3: gates ────────────────────────────────────────────────────────────
async function probeGates() {
  const gates = cli(["flags", "list", "--json"]);
  console.log(`::group::Gates (${gates.length})`);
  for (const g of gates) {
    console.log(`  ${g.name}: rollout=${(g.rolloutPct ?? 0) / 100}% enabled=${!!g.enabled}`);
  }
  console.log("::endgroup::");

  // Pure percentage gates: no targeting rules, no stack — answerable from a unit
  // id alone. Require an explicit empty `rules` array (the list response always
  // includes it) so a targeted gate can never be mistaken for pure and
  // false-positive: a synthetic cohort sends no attributes, so a targeted gate
  // would deny everyone and look like rollout drift.
  const pure = gates.filter(
    (g) =>
      g.enabled &&
      Array.isArray(g.rules) &&
      g.rules.length === 0 &&
      (g.stack == null || g.stack.length === 0) &&
      typeof g.rolloutPct === "number",
  );

  if (!CLIENT_KEY) {
    console.log("SHIPEASY_CLIENT_KEY unset — skipping edge rollout distribution leg");
    return;
  }
  if (pure.length === 0) {
    console.log("No pure-percentage gates to distribution-check");
    return;
  }

  // One /sdk/evaluate call per synthetic unit returns ALL gate verdicts, so the
  // whole cohort costs COHORT requests regardless of gate count.
  const responses = await fetchCohort(COHORT);

  console.log(`::group::Rollout distribution (cohort=${COHORT})`);
  for (const g of pure) {
    const p = g.rolloutPct / 10000;
    const pass = responses.reduce((n, r) => n + (r.flags?.[g.name] === true ? 1 : 0), 0);
    const rate = pass / responses.length;

    // Deterministic edges; otherwise a ~4σ binomial band (floored at 1pt). The
    // cohort ids are fixed, so the tally is deterministic — the band only
    // absorbs the fixed set's sampling offset from the true p.
    let pass_ok;
    if (p === 0) pass_ok = pass === 0;
    else if (p === 1) pass_ok = pass === responses.length;
    else {
      const band = Math.max(0.01, 4 * Math.sqrt((p * (1 - p)) / responses.length));
      pass_ok = Math.abs(rate - p) <= band;
    }

    const line = `gate ${g.name}: observed ${(rate * 100).toFixed(2)}% vs configured ${(p * 100).toFixed(2)}% (n=${responses.length})`;
    if (pass_ok) ok(line);
    else {
      annotate(`rollout drift — ${line}`);
      failed++;
    }
  }
  console.log("::endgroup::");
}

async function fetchCohort(n) {
  const out = new Array(n);
  let cursor = 0;
  async function worker() {
    while (cursor < n) {
      const i = cursor++;
      const res = await fetch(`${EDGE_URL}/sdk/evaluate`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-sdk-key": CLIENT_KEY },
        body: JSON.stringify({ user: { anonymous_id: `probe:${i}` } }),
      });
      if (!res.ok) throw new Error(`/sdk/evaluate ${res.status} for probe:${i}`);
      out[i] = await res.json();
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, n) }, worker));
  return out;
}

// ── C5: template / alias gates (@team / @owner / stack templates) ────────────
// The rollout-distribution leg deliberately SKIPS targeted gates — a synthetic
// cohort sends no attributes, so they'd deny everyone and look like drift. This
// leg covers them: for each alias/template gate, hit /sdk/evaluate with a KNOWN
// member identity (SHIPEASY_PROBE_MEMBER_EMAIL — the canary owner/team email)
// and a known non-member, asserting pass/deny. Non-member-deny always holds
// (targeting fails regardless of rollout); member-pass is only hard-asserted for
// 100%-rollout gates (a fractional rollout makes the member's bucket
// nondeterministic). A member DENIED at 100% means alias expansion (@team/@owner
// → emails in the KV blob) is broken in prod.
async function probeTemplateGates() {
  if (!CLIENT_KEY) {
    console.log("SHIPEASY_CLIENT_KEY unset — skipping template-gate leg");
    return;
  }
  const MEMBER = process.env.SHIPEASY_PROBE_MEMBER_EMAIL || "";
  const NONMEMBER = process.env.SHIPEASY_PROBE_NONMEMBER_EMAIL || "not-a-member@probe.invalid";
  const gates = cli(["flags", "list", "--json"]);
  // Alias/template gates: an `email <in|eq> @symbol` rule, or any stack entry
  // seeded fromTemplate. These are exactly the gates a known member can probe.
  const isAlias = (g) =>
    (Array.isArray(g.rules) &&
      g.rules.some((r) => typeof r?.value === "string" && r.value.startsWith("@"))) ||
    (Array.isArray(g.stack) && g.stack.some((s) => s?.fromTemplate));
  const tmpl = gates.filter((g) => g.enabled && isAlias(g));
  if (tmpl.length === 0) {
    console.log("No template/alias gates to check");
    return;
  }
  if (!MEMBER) {
    annotate(
      "template/alias gates present but SHIPEASY_PROBE_MEMBER_EMAIL unset — cannot verify membership",
    );
    failed++;
    return;
  }

  async function evalFor(email) {
    const res = await fetch(`${EDGE_URL}/sdk/evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sdk-key": CLIENT_KEY },
      body: JSON.stringify({ user: { anonymous_id: `probe-tmpl:${email}`, email } }),
    });
    if (!res.ok) throw new Error(`/sdk/evaluate ${res.status} for ${email}`);
    return (await res.json()).flags ?? {};
  }

  console.log(`::group::Template/alias gates (${tmpl.length})`);
  const memberFlags = await evalFor(MEMBER);
  const nonFlags = await evalFor(NONMEMBER);
  for (const g of tmpl) {
    // Non-member must always be denied (targeting rule fails).
    if (nonFlags[g.name] === true) {
      annotate(`template gate ${g.name}: non-member (${NONMEMBER}) ADMITTED — targeting leak`);
      failed++;
    } else {
      ok(`template gate ${g.name}: non-member denied`);
    }
    // Member: pass expected only when the gate is fully rolled out.
    if (g.rolloutPct === 10000) {
      if (memberFlags[g.name] === true) {
        ok(`template gate ${g.name}: member (${MEMBER}) admitted`);
      } else {
        annotate(
          `template gate ${g.name}: member (${MEMBER}) DENIED at 100% rollout — alias expansion broken in prod`,
        );
        failed++;
      }
    } else {
      console.log(
        `  ${g.name}: member=${memberFlags[g.name]} (rollout ${g.rolloutPct / 100}%, not hard-asserted)`,
      );
    }
  }
  console.log("::endgroup::");
}

// ── 2: experiment SRM (server-computed over real traffic) ───────────────────
function probeExperiments() {
  const exps = cli(["experiments", "list", "--json"]).filter((e) => e.status === "running");
  console.log(`::group::Experiment SRM (${exps.length} running)`);
  for (const e of exps) {
    let st;
    try {
      st = cli(["experiments", "status", e.name, "--json"]);
    } catch {
      console.log(`  ${e.name}: no status yet — skipping`);
      continue;
    }
    // `experiments status --json` is the bundle { experiment, results }, and the
    // per-group rows are nested at `results.results` (the inner bundle also
    // carries its own experiment summary). Tolerate both shapes + field casings.
    const rows = Array.isArray(st.results)
      ? st.results
      : Array.isArray(st.results?.results)
        ? st.results.results
        : [];
    const enrolment = rows.reduce((s, r) => s + (r.n ?? 0), 0);
    const srm = rows.some((r) => r.srm_detected === 1 || r.srmDetected === 1);
    if (srm) {
      annotate(`experiment ${e.name}: SRM detected (sample ratio mismatch) — assignment is skewed in prod`);
      failed++;
    } else if (enrolment === 0) {
      console.log(`  ${e.name}: no enrolment yet — skipping`);
    } else {
      ok(`experiment ${e.name}: SRM clear (enrolment=${enrolment})`);
    }
  }
  console.log("::endgroup::");
}

// ── #1 + #2: targeting + combination gates (generic rule synthesis) ─────────
// For every targeting gate the probe DERIVES a matching and a non-matching
// identity FROM THE GATE'S OWN RULES and asserts /sdk/evaluate admits the match
// and denies the non-match — covering every operator (eq/neq/in/not_in/gt/gte/
// lt/lte/contains/semver_*) and rule combinations (flat AND, stack condition
// pass:all/any, OR across stack entries). No oracle, no hardcoded fixture
// knowledge. Gates it can't synthesize deterministically (regex, fractional
// rollout, rollout entries inside a stack, alias rules) are skipped.
const SENTINEL = "se_probe_nomatch_x9z";
const isAlias = (v) => typeof v === "string" && v.startsWith("@");

function synthRule(rule) {
  const { attr, op, value } = rule || {};
  if (!attr || isAlias(value)) return null;
  const n = (x) => (typeof x === "number" ? x : Number(x));
  const s = (x) => String(x);
  switch (op) {
    case "eq": return { match: { [attr]: value }, nomatch: { [attr]: s(value) + "_x" } };
    case "neq": return { match: { [attr]: s(value) + "_x" }, nomatch: { [attr]: value } };
    case "in":
      if (!Array.isArray(value) || !value.length) return null;
      return { match: { [attr]: value[0] }, nomatch: { [attr]: SENTINEL } };
    case "not_in":
      if (!Array.isArray(value) || !value.length) return null;
      return { match: { [attr]: SENTINEL }, nomatch: { [attr]: value[0] } };
    case "contains": return { match: { [attr]: "x" + value + "y" }, nomatch: { [attr]: SENTINEL } };
    case "gt": return { match: { [attr]: n(value) + 1 }, nomatch: { [attr]: n(value) - 1 } };
    case "gte": return { match: { [attr]: n(value) }, nomatch: { [attr]: n(value) - 1 } };
    case "lt": return { match: { [attr]: n(value) - 1 }, nomatch: { [attr]: n(value) } };
    case "lte": return { match: { [attr]: n(value) }, nomatch: { [attr]: n(value) + 1 } };
    case "semver_gt": return { match: { [attr]: "999.0.0" }, nomatch: { [attr]: "0.0.0" } };
    case "semver_gte": return { match: { [attr]: s(value) }, nomatch: { [attr]: "0.0.0" } };
    case "semver_lt": return { match: { [attr]: "0.0.0" }, nomatch: { [attr]: "999.0.0" } };
    case "semver_lte": return { match: { [attr]: s(value) }, nomatch: { [attr]: "999.0.0" } };
    default: return null; // regex + anything unknown
  }
}

function synthCondition(rules, pass) {
  const parts = (rules || []).map(synthRule);
  if (!parts.length || parts.some((p) => p === null)) return null;
  if (pass === "any") {
    const match = { ...parts[0].match };
    const nomatch = {};
    for (const p of parts) Object.assign(nomatch, p.nomatch); // violate all → none pass
    return { match, nomatch };
  }
  const match = {};
  for (const p of parts) Object.assign(match, p.match); // satisfy all (AND)
  const nomatch = { ...match, ...parts[0].nomatch }; // violate one
  return { match, nomatch };
}

function synthGate(g) {
  if (g.stack && g.stack.length) {
    if (g.stack.some((e) => e.type !== "condition")) return null; // rollout entry → nondeterministic
    const conds = g.stack.map((e) => synthCondition(e.rules || [], e.pass || "all"));
    if (conds.some((c) => c === null)) return null;
    const match = { ...conds[0].match }; // first entry passes → gate true (OR)
    const nomatch = {};
    for (const c of conds) Object.assign(nomatch, c.nomatch); // violate every entry
    return { match, nomatch };
  }
  if (!g.rules || g.rules.length === 0) return null; // pure rollout → probeGates
  if (g.rules.some((r) => isAlias(r.value))) return null; // alias → probeTemplateGates
  if (g.rolloutPct !== 10000) return null; // fractional rollout → can't assert match
  return synthCondition(g.rules, "all");
}

async function probeTargeting() {
  if (!CLIENT_KEY) {
    console.log("SHIPEASY_CLIENT_KEY unset — skipping targeting leg");
    return;
  }
  const gates = cli(["flags", "list", "--json"]).filter((g) => g.enabled);
  const targets = gates.map((g) => ({ g, syn: synthGate(g) })).filter((x) => x.syn);
  const skipped = gates.filter((g) => !synthGate(g) && (g.rules?.length || g.stack?.length));
  if (!targets.length) {
    console.log("No synthesizable targeting gates");
    return;
  }
  console.log(`::group::Targeting + combination gates (${targets.length})`);
  for (const { g, syn } of targets) {
    const mf = (await evaluate({ anonymous_id: "pt-m", ...syn.match })).flags ?? {};
    const nf = (await evaluate({ anonymous_id: "pt-n", ...syn.nomatch })).flags ?? {};
    if (mf[g.name] === true && nf[g.name] !== true) {
      ok(`gate ${g.name}: match admitted, non-match denied`);
    } else {
      annotate(
        `gate ${g.name}: match=${mf[g.name]} (want true), non-match=${nf[g.name]} (want falsy) — synth ${JSON.stringify(syn)}`,
      );
      failed++;
    }
  }
  if (skipped.length) {
    console.log(`  (skipped, not deterministically synthesizable: ${skipped.map((g) => g.name).join(", ")})`);
  }
  console.log("::endgroup::");
}

// ── #2b: condition → rollout FALLTHROUGH ────────────────────────────────────
// evalGatekeeper returns on the FIRST stack entry that passes, so a
// [condition, rollout] stack means "fail the condition → fall through to the
// next rollout entry." Verify BOTH halves on gates that mix them: a
// condition-matcher is always admitted (the condition short-circuits before the
// rollout), and condition-failers are admitted at ~rolloutPct (the fallthrough
// rollout fires) — measured over a cohort against a binomial band.
async function probeFallthrough() {
  if (!CLIENT_KEY) {
    console.log("SHIPEASY_CLIENT_KEY unset — skipping fallthrough leg");
    return;
  }
  const gates = cli(["flags", "list", "--json"]).filter((g) => g.enabled);
  const fts = gates.filter(
    (g) =>
      g.stack?.some((e) => e.type === "condition") && g.stack?.some((e) => e.type === "rollout"),
  );
  if (!fts.length) {
    console.log("No condition→rollout fallthrough gates");
    return;
  }
  console.log(`::group::Condition→rollout fallthrough (${fts.length})`);
  for (const g of fts) {
    const conds = g.stack.filter((e) => e.type === "condition");
    const roll = g.stack.find((e) => e.type === "rollout");
    const first = synthCondition(conds[0].rules || [], conds[0].pass || "all");
    if (!first) {
      console.log(`  ${g.name}: condition not synthesizable — skipping`);
      continue;
    }
    // (a) condition match → always admitted (short-circuits before the rollout).
    const matchPass = (await evaluate({ anonymous_id: "ft-m", ...first.match })).flags?.[g.name] === true;
    // (b) condition fail → fall through to the rollout. Violate EVERY condition,
    // vary the bucketing identity, and measure the pass rate ≈ rolloutPct.
    const failCtx = {};
    for (const c of conds) {
      const sc = synthCondition(c.rules || [], c.pass || "all");
      if (sc) Object.assign(failCtx, sc.nomatch);
    }
    const N = 200;
    let pass = 0;
    for (let i = 0; i < N; i++) {
      if ((await evaluate({ anonymous_id: `ft-f:${i}`, ...failCtx })).flags?.[g.name] === true) pass++;
    }
    const rate = pass / N;
    const want = (roll.rolloutPct ?? 0) / 10000;
    const band = Math.max(0.08, 4 * Math.sqrt((want * (1 - want)) / N));
    if (matchPass && Math.abs(rate - want) <= band) {
      ok(`gate ${g.name}: condition admits, fallthrough rollout ${(rate * 100).toFixed(1)}% ≈ ${(want * 100).toFixed(0)}%`);
    } else {
      annotate(
        `gate ${g.name}: condition-match=${matchPass} (want true); fallthrough ${(rate * 100).toFixed(1)}% vs ${(want * 100).toFixed(0)}% (±${(band * 100).toFixed(0)}pp)`,
      );
      failed++;
    }
  }
  console.log("::endgroup::");
}

// ── #4: killswitches with named switch entries ──────────────────────────────
// The prod-resolved killswitch view from /sdk/evaluate must match the admin
// config: a whole-killed switch → boolean; a switch with named overrides →
// the { switchKey: bool } map.
async function probeKillswitches() {
  if (!CLIENT_KEY) return;
  let list;
  try {
    list = cli(["killswitch", "list", "--json"]);
  } catch {
    console.log("killswitch list unavailable — skipping");
    return;
  }
  if (!list.length) {
    console.log("No killswitches to check");
    return;
  }
  const got = (await evaluate({ anonymous_id: "ks-probe" })).killswitches ?? {};
  console.log(`::group::Killswitches (${list.length})`);
  for (const k of list) {
    const prod = k.envs?.prod ?? {};
    const hasSwitches = prod.switches && Object.keys(prod.switches).length > 0;
    const actual = got[k.name];
    let pass;
    if (hasSwitches) {
      pass = actual && typeof actual === "object" &&
        JSON.stringify(actual) === JSON.stringify(prod.switches);
    } else {
      pass = !!actual === !!prod.value && typeof actual !== "object";
    }
    if (pass) {
      ok(`killswitch ${k.name}: ${hasSwitches ? "switches match" : `value=${!!prod.value}`}`);
    } else {
      annotate(
        `killswitch ${k.name}: edge=${JSON.stringify(actual)} vs config ${JSON.stringify(hasSwitches ? prod.switches : prod.value)}`,
      );
      failed++;
    }
  }
  console.log("::endgroup::");
}

// ── #3: experiment results are calculated properly ──────────────────────────
// Opt-in (needs SHIPEASY_PROBE_EXPERIMENT + SHIPEASY_PROBE_METRIC_EVENT). Sends
// a deterministic synthetic cohort to /collect — balanced 50/50 exposures with a
// KNOWN conversion lift (control 40%, treatment 60% on a binary count_users
// metric, so re-runs are idempotent) — triggers reanalyze, polls the experiment
// results, and asserts the pipeline recovered treatment > control (and no SRM on
// the balanced split). AE ingestion is async, so a no-data timeout is a WARNING
// (not a hard fail); a WRONG recovered direction is a hard fail.
async function probeExperimentResults() {
  const EXP = process.env.SHIPEASY_PROBE_EXPERIMENT;
  const EV = process.env.SHIPEASY_PROBE_METRIC_EVENT;
  if (!CLIENT_KEY || !EXP || !EV) {
    console.log("experiment-results leg: set SHIPEASY_PROBE_EXPERIMENT + SHIPEASY_PROBE_METRIC_EVENT to enable");
    return;
  }
  const N = 200; // per group
  const now = Date.now();
  const events = [];
  for (const [grp, conv] of [["control", 40], ["treatment", 60]]) {
    const tag = grp[0];
    for (let i = 0; i < N; i++) {
      const uid = `er-${tag}-${i}`;
      events.push({ type: "exposure", experiment: EXP, group: grp, user_id: uid, ts: now });
      if (i % 100 < conv) events.push({ type: "metric", event_name: EV, value: 1, user_id: uid, ts: now });
    }
  }
  // /collect takes { events } as text/plain JSON; chunk to keep payloads small.
  console.log(`::group::Experiment results (${EXP})`);
  for (let i = 0; i < events.length; i += 200) {
    const res = await fetch(`${EDGE_URL}/collect`, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-sdk-key": CLIENT_KEY },
      body: JSON.stringify({ events: events.slice(i, i + 200) }),
    });
    if (!res.ok) {
      annotate(`/collect ${res.status} — cannot run experiment-results leg`);
      failed++;
      console.log("::endgroup::");
      return;
    }
  }
  cliText(reanalyzeArgs(EXP));

  // Poll results (AE ingestion + queue consumer are async).
  const deadline = now + 150_000;
  let rows = [];
  while (Date.now() < deadline) {
    await sleep(10_000);
    let st;
    try {
      st = cli(["experiments", "status", EXP, "--json"]);
    } catch {
      continue;
    }
    rows = Array.isArray(st.results) ? st.results : st.results?.results ?? [];
    cliText(reanalyzeArgs(EXP)); // nudge again in case data landed late
    if (rows.some((r) => (r.n ?? 0) > 0)) break;
  }
  const byGroup = (name) => rows.find((r) => (r.group_name ?? r.groupName) === name);
  const c = byGroup("control");
  const t = byGroup("treatment");
  if (!c || !t || !(c.n > 0) || !(t.n > 0)) {
    console.log(`⚠ no enrolment recovered within timeout (AE ingestion lag) — exposures sent, results pending`);
    console.log("::endgroup::");
    return; // soft: don't flake on ingestion latency
  }
  const cm = c.mean ?? 0;
  const tm = t.mean ?? 0;
  if (tm > cm) {
    ok(`experiment ${EXP}: recovered treatment ${tm.toFixed(3)} > control ${cm.toFixed(3)} (n=${c.n}/${t.n})`);
  } else {
    annotate(`experiment ${EXP}: WRONG direction — treatment ${tm} !> control ${cm} (injected +20pp lift)`);
    failed++;
  }
  if (rows.some((r) => (r.srm_detected ?? r.srmDetected) === 1)) {
    annotate(`experiment ${EXP}: SRM flagged on a balanced 50/50 synthetic split — false positive`);
    failed++;
  }
  console.log("::endgroup::");
}

// ── attribute enrichment: server auto-derives the default attributes ────────
// The edge derives country (IP geo), browser/os/device (User-Agent), referrer,
// locale, etc. so rules work WITHOUT the caller setting them. Opt-in
// (SHIPEASY_PROBE_ENRICHMENT=1) because it needs the edge-worker deploy that
// ships enrichment. Sends an EMPTY body with only a Chrome UA header and asserts
// a browser-rule gate and a country-rule gate resolve from the derived attrs.
async function probeEnrichment() {
  if (!CLIENT_KEY) return;
  if (!process.env.SHIPEASY_PROBE_ENRICHMENT) {
    console.log(
      "enrichment leg disabled — after the edge worker deploys, enable with: gh variable set SHIPEASY_PROBE_ENRICHMENT 1 -R shipeasy-ai/cli",
    );
    return;
  }
  const gates = cli(["flags", "list", "--json"]).filter((g) => g.enabled);
  const browserGate = gates.find((g) => g.rules?.some((r) => r.attr === "browser"));
  const countryGate = gates.find((g) => g.rules?.some((r) => r.attr === "country" && r.op === "neq"));
  const res = await fetch(`${EDGE_URL}/sdk/evaluate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sdk-key": CLIENT_KEY,
      // No body.user — the edge must derive `browser` from this UA and `country`
      // from the connecting IP's geo.
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    },
    body: JSON.stringify({}),
  });
  const flags = (await res.json()).flags ?? {};
  console.log("::group::Attribute enrichment (empty body — derived from request)");
  if (browserGate) {
    if (flags[browserGate.name] === true) ok(`enrichment: browser from UA → ${browserGate.name} admitted`);
    else { annotate(`enrichment: ${browserGate.name} denied — browser not auto-derived (worker deployed?)`); failed++; }
  }
  if (countryGate) {
    if (flags[countryGate.name] === true) ok(`enrichment: country from IP geo → ${countryGate.name} admitted`);
    else { annotate(`enrichment: ${countryGate.name} denied — country not auto-derived (worker deployed?)`); failed++; }
  }
  console.log("::endgroup::");
}

// ── run ─────────────────────────────────────────────────────────────────────
try {
  probeExperiments();
  await probeGates();
  await probeTemplateGates();
  await probeTargeting();
  await probeFallthrough();
  await probeKillswitches();
  await probeEnrichment();
  await probeExperimentResults();
} catch (err) {
  annotate(`probe failed to run: ${err?.message ?? err}`);
  process.exit(2);
}

if (failed > 0) {
  annotate(`${failed} drift finding(s) — see annotations above`);
  process.exit(1);
}
console.log("✅ prod probe passed");
