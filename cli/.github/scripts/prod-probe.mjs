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
  const out = execFileSync(CLI[0], [...CLI.slice(1), ...args], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(out);
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
    const results = st.results ?? [];
    const enrolment = results.reduce((s, r) => s + (r.n ?? 0), 0);
    const srm = results.some((r) => r.srm_detected === 1);
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

// ── run ─────────────────────────────────────────────────────────────────────
try {
  probeExperiments();
  await probeGates();
} catch (err) {
  annotate(`probe failed to run: ${err?.message ?? err}`);
  process.exit(2);
}

if (failed > 0) {
  annotate(`${failed} drift finding(s) — see annotations above`);
  process.exit(1);
}
console.log("✅ prod probe passed");
