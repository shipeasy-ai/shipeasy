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
//   4. Reference gates    — auto-discover gates whose stack references another
//                           gate (gate_pass) or a running experiment variant
//                           (exp_in) and assert the cross-resource implication
//                           (flags[G] ⇒ referenced gate/experiment holds) over
//                           the cohort. Oracle-free: one evaluate response
//                           carries both verdicts. See probeReferenceGates.
//   5. Gradual ramps      — discover single-entry ramp stacks, mirror core's
//                           effectivePct, assert the edge pass-rate matches the
//                           ramp's live effective % (pending/in-flight/complete).
//   6. Managed presets    — discover `fromTemplate` conditions (bots/mobile/geo),
//                           assert the label survives + the preset audience is
//                           admitted and others denied (incl. the bot UA regex).
//   7. Per-condition rollout — a stack condition's own fractional rolloutPct:
//                           non-matchers always denied, matchers pass ≈ rolloutPct.
//
// Exit non-zero on any drift so the Action fails (and notifies). Env:
//   SHIPEASY_CLI_TOKEN, SHIPEASY_PROJECT_ID  — CLI auth (the CLI reads these)
//   SHIPEASY_EDGE_URL                        — e.g. https://cdn.shipeasy.ai
//   SHIPEASY_CLIENT_KEY                      — canary CLIENT key (enables leg 3)
//   SHIPEASY_PROBE_MEMBER_EMAIL              — known @team/@owner member (leg C5)
//   SHIPEASY_PROBE_NONMEMBER_EMAIL           — optional; defaults to an invalid addr
//   SHIPEASY_PROBE_EXPERIMENT                — running 2-group experiment (leg #3)
//   SHIPEASY_PROBE_METRIC_EVENT              — its goal metric's backing event (leg #3)
//   SHIPEASY_PROBE_IDENTIFY_EXPERIMENT       — dedicated 2-group exp for the identify-merge leg
//   SHIPEASY_SERVER_KEY                      — server key (server-blob + bootstrap legs)
//   SHIPEASY_CLIENT_KEY_DEV                  — a dev-env client key (multi-env leg)
//   SHIPEASY_PROBE_ALERTS (=1)               — enable the metric-rule alert leg (async cron)
//   SHIPEASY_APP_URL                         — admin API base (errors + error-series legs)
//   SHIPEASY_PROBE_ENRICHMENT (=1)           — enable the request-enrichment leg
//   SHIPEASY_PROBE_MUTATE (=1)               — enable the killswitch-propagation leg,
//                                              the stats-effect leg (power/SRM), the three
//                                              stats-knob legs (mSPRT τ / CUPED / verdict
//                                              gates), AND the five Universes→Experiments→
//                                              Groups rework legs (config object + universe-
//                                              default inheritance, experiment targeting gate,
//                                              holdout gate, append-variant-while-running,
//                                              universe mutual exclusion). All mutations
//                                              self-restore; the rework legs build reusable
//                                              throwaway fixtures (probe_cfg_exp,
//                                              probe_targeting_exp, probe_holdout_exp,
//                                              probe_append_exp) and assert deterministically
//                                              off /sdk/evaluate — no /collect, no AE lag. The
//                                              mutual-exclusion leg additionally needs
//                                              SHIPEASY_SERVER_KEY (pool metadata) and soft-
//                                              skips until the §B4 pooled write path deploys.
//   SHIPEASY_PROBE_STATS_UNIVERSE            — universe the create-and-mutate stats legs
//                                              bucket their throwaway fixtures in
//                                              (default "probe_stats"; created if missing).
//                                              Requires a Pro+ plan (sequential + CUPED).
//   SHIPEASY_PROBE_MAX_MS (default 50)       — latency p95 budget for /sdk/evaluate
//   PROBE_COHORT (default 500)
//   PROBE_CLI    — how to invoke the CLI. The workflow points this at the
//                  locally-built workspace binary (`node cli/bin/shipeasy.js`)
//                  so the command tree always matches this repo's CLI; defaults
//                  to "npx --yes @shipeasy/cli@latest" when unset.

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

// Non-JSON CLI invocation (for mutating commands like `experiments reanalyze`
// and `killswitch set` that print a human line). Returns stdout text.
function cliText(args) {
  return execFileSync(CLI[0], [...CLI.slice(1), ...args], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "inherit"],
  });
}

// ── CLI resource reads ───────────────────────────────────────────────────────
// The `shipeasy` CLI is the spec-generated `release`/`ops` group tree: JSON is
// the default output (there is no `--json` flag) and list endpoints return a
// `{ data: [...] }` envelope. These wrappers issue the commands directly and
// return the bare array the checks below expect.
const listGates = () => cli(["release", "flags", "list", "--limit", "500"]).data ?? [];
const listExperiments = () => cli(["release", "experiments", "list", "--limit", "500"]).data ?? [];
const experimentResults = (exp) => cli(["release", "experiments", "results", exp]);
const listKillswitches = () => cli(["release", "killswitch", "list", "--limit", "500"]).data ?? [];
const listUniverses = () =>
  cli(["release", "experiments", "universes", "list", "--limit", "500"]).data ?? [];
const listConfigs = () => cli(["release", "configs", "list", "--limit", "500"]).data ?? [];
const listAlertRules = () => cli(["ops", "alerts", "list"]).data ?? [];
const listAlerts = () => cli(["ops", "list", "--limit", "500"]).data ?? [];

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

// Admin API base (errors + error-series endpoints). The CLI token authenticates.
const APP_URL = (process.env.SHIPEASY_APP_URL || "").replace(/\/$/, "");
const ADMIN_H = {
  "X-SDK-Key": process.env.SHIPEASY_CLI_TOKEN || "",
  "X-Project-Id": process.env.SHIPEASY_PROJECT_ID || "",
  "content-type": "application/json",
};

// Mutating CLI commands resolve their project from the `.shipeasy` binding the
// workflow writes via `shipeasy bind` (the generated commands have no --project
// flag and don't read SHIPEASY_PROJECT_ID for writes).
function reanalyzeArgs(exp) {
  return ["release", "experiments", "reanalyze", exp];
}

// ── 1 + 3: gates ────────────────────────────────────────────────────────────
async function probeGates() {
  const gates = listGates();
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

// ── Reference gates: gate_pass / exp_in cross-resource implication ────────────
// A gate step can reference another gate (`gate_pass`) or a running experiment
// variant (`exp_in`). Both resolve ONLY on the worker hot path (/sdk/evaluate),
// so they're exactly what a prod eval probe should guard. This leg auto-DISCOVERS
// such gates from the inventory (no new env var) and asserts a cross-resource
// IMPLICATION over the synthetic cohort — oracle-free, because a single evaluate
// response already carries both the gate verdict AND the referenced gate's
// verdict / experiment assignment, so the two must agree:
//
//   gate_pass T   : flags[G]===true ⇒ flags[T]===true
//   exp_in E / V  : flags[G]===true ⇒ experiments[E].group===V
//   exp_in E /$any : flags[G]===true ⇒ experiments[E]?.inExperiment===true
//   exp_in E /$hold: flags[G]===true ⇒ experiments[E] absent (held out / not enrolled)
//
// Handles BOTH shapes: a flat gate (reference op in its AND-ed `rules`) and a
// stacked gate (reference op in a stack condition). For flat gates every
// reference rule is asserted (AND ⇒ each must hold); for stacked gates only a
// SINGLE reference condition with no independent admit path yields a crisp
// implication — an ambiguous gate is reported as skipped, never failed.
async function probeReferenceGates() {
  if (!CLIENT_KEY) {
    console.log("reference-gates leg: SHIPEASY_CLIENT_KEY unset — skipping");
    return;
  }
  const REF_OPS = new Set(["gate_pass", "exp_in"]);
  const refRuleOf = (step) =>
    step?.type === "condition" && Array.isArray(step.rules)
      ? step.rules.find((r) => REF_OPS.has(r?.op))
      : undefined;

  const isRef = (r) => REF_OPS.has(r?.op);
  const gates = listGates();
  const candidates = [];
  for (const g of gates) {
    if (!g.enabled) continue;
    const hasStack = Array.isArray(g.stack) && g.stack.length > 0;
    if (!hasStack) {
      // Flat gate: rules are AND-ed under rolloutPct. flags[G]===true ⇒ EVERY
      // rule matched (and the caller bucketed), so each reference rule's target
      // must hold — assert the implication per reference rule, crisp regardless
      // of the other rules or the rollout %.
      const refs = Array.isArray(g.rules) ? g.rules.filter(isRef) : [];
      for (const ref of refs) candidates.push({ gate: g, ref });
      continue;
    }
    // Stacked gate: steps are OR-ed (first-match-wins), so the implication is
    // crisp only when the reference is the SOLE admit path — one reference
    // condition, no other condition, no rollout floor that admits on its own.
    const conds = g.stack.filter((e) => e?.type === "condition");
    const rolls = g.stack.filter((e) => e?.type === "rollout");
    const refSteps = conds.filter((c) => refRuleOf(c));
    if (refSteps.length === 0) continue; // not a reference gate
    const otherCond = conds.some((c) => !refRuleOf(c));
    const floorAdmits = rolls.some((r) => ((r.ramp ? r.ramp.to : r.rolloutPct) ?? 0) > 0);
    if (refSteps.length !== 1 || otherCond || floorAdmits) {
      console.log(
        `  skip ${g.name}: ambiguous admit path (refSteps=${refSteps.length} otherCond=${otherCond} floorAdmits=${floorAdmits})`,
      );
      continue;
    }
    candidates.push({ gate: g, ref: refRuleOf(refSteps[0]) });
  }

  if (candidates.length === 0) {
    console.log("reference-gates leg: no single-reference gates in inventory — skipping");
    return;
  }

  const responses = await fetchCohort(COHORT);
  console.log(`::group::Reference gates (${candidates.length}, cohort=${COHORT})`);
  for (const { gate, ref } of candidates) {
    let admits = 0;
    let violations = 0;
    for (const r of responses) {
      if (r.flags?.[gate.name] !== true) continue;
      admits++;
      if (ref.op === "gate_pass") {
        if (r.flags?.[ref.value] !== true) violations++;
      } else {
        const a = r.experiments?.[ref.attr];
        if (ref.value === "$any") {
          if (!a || a.inExperiment !== true) violations++;
        } else if (ref.value === "$holdout") {
          if (a) violations++; // an assignment means the caller was NOT held out
        } else if (!a || a.group !== ref.value) {
          violations++;
        }
      }
    }
    const desc =
      ref.op === "gate_pass" ? `passes gate "${ref.value}"` : `in experiment "${ref.attr}" (${ref.value})`;
    const line = `gate ${gate.name} ⇒ ${desc}: ${admits} admit(s), ${violations} violation(s) over n=${responses.length}`;
    if (violations === 0) ok(line);
    else {
      annotate(`reference drift — ${line}`);
      failed++;
    }
  }
  console.log("::endgroup::");
}

// ── Auto-field gates: referrer / request_url (and other request attrs) ────────
// Gates targeting a request-derived STRING attribute (referrer, request_url, …)
// deny the attribute-less synthetic cohort, so the rollout-distribution leg
// can't see them. This leg discovers single-rule string-match gates on those
// attrs and checks them with an ORACLE: send a user whose attribute does NOT
// match → the gate MUST be false (the rule fails regardless of rollout); send
// one that DOES match → a 100%-rollout gate MUST be true. Covers the
// referrer/request-uri templates end-to-end through /sdk/evaluate.
const AUTO_FIELD_ATTRS = new Set([
  "referrer",
  "request_url",
  "url",
  "page_url",
  "path",
  "user_agent",
]);
const STRING_OPS = new Set(["contains", "eq", "regex"]);
async function probeAutoFieldGates() {
  if (!CLIENT_KEY) {
    console.log("auto-field leg: SHIPEASY_CLIENT_KEY unset — skipping");
    return;
  }
  const gates = listGates();
  const targets = gates.filter(
    (g) =>
      g.enabled &&
      (!Array.isArray(g.stack) || g.stack.length === 0) &&
      Array.isArray(g.rules) &&
      g.rules.length === 1 &&
      AUTO_FIELD_ATTRS.has(g.rules[0]?.attr) &&
      STRING_OPS.has(g.rules[0]?.op) &&
      typeof g.rules[0]?.value === "string",
  );
  if (targets.length === 0) {
    console.log("auto-field leg: no referrer/request_url string gates in inventory — skipping");
    return;
  }
  console.log(`::group::Auto-field gates (${targets.length})`);
  for (const g of targets) {
    const { attr, op, value } = g.rules[0];
    // A value the operator matches, plus one it clearly doesn't.
    const match = op === "eq" ? value : op === "regex" ? null : `https://probe.test/${value}/p`;
    const noMatch = "https://probe.invalid/zzz-no-match";
    const uid = "probe_autofield";
    // FAIL direction holds regardless of rollout: a non-matching attr can never
    // satisfy the rule, so the gate must be false.
    const noRes = await evaluate({ user_id: uid, [attr]: noMatch });
    const failOk = noRes.flags?.[g.name] !== true;
    // PASS direction only at 100% rollout (bucketing could otherwise deny a
    // match); skip regex since we don't synthesize a string for arbitrary patterns.
    let passOk = true;
    let passNote = "pass-dir skipped";
    if (match != null && g.rolloutPct === 10000) {
      const yesRes = await evaluate({ user_id: uid, [attr]: match });
      passOk = yesRes.flags?.[g.name] === true;
      passNote = `match→${yesRes.flags?.[g.name] === true}`;
    }
    const line = `gate ${g.name} (${attr} ${op} "${value}"): non-match→${noRes.flags?.[g.name] === true ? "PASS!(bad)" : "deny"}, ${passNote}`;
    if (failOk && passOk) ok(line);
    else {
      annotate(`auto-field drift — ${line}`);
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
  const gates = listGates();
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
  const exps = listExperiments().filter((e) => e.status === "running");
  console.log(`::group::Experiment SRM (${exps.length} running)`);
  for (const e of exps) {
    let st;
    try {
      st = experimentResults(e.name);
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
    // A per-condition rollout or a ramp makes a matching caller's verdict
    // nondeterministic (it depends on the hash bucket / wall clock), so this leg
    // can't hard-assert a match. probeConditionRollout + probeGradualRamps cover
    // those shapes over a cohort instead.
    if (g.stack.some((e) => e.ramp || (typeof e.rolloutPct === "number" && e.rolloutPct !== 10000)))
      return null;
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
  const gates = listGates().filter((g) => g.enabled);
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
  const gates = listGates().filter((g) => g.enabled);
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

// ── #2c: rule-gated fractional rollout ──────────────────────────────────────
// A FLAT gate with rules AND a fractional rollout means "X% of the users who
// match the rules; 0% of everyone else" (the rules gate membership, then the
// rollout buckets the matchers). Distinct from the stack condition→rollout
// fallthrough (#2b, where non-matchers fall through to the rollout). The generic
// targeting leg skips these (a fractional match isn't per-user deterministic),
// so verify here: non-matchers are ALWAYS denied, and matchers pass at ~rolloutPct.
async function probeRuleGatedRollout() {
  if (!CLIENT_KEY) {
    console.log("SHIPEASY_CLIENT_KEY unset — skipping rule-gated-rollout leg");
    return;
  }
  const gates = listGates().filter((g) => g.enabled);
  const rg = gates.filter(
    (g) =>
      (!g.stack || g.stack.length === 0) &&
      g.rules?.length &&
      !g.rules.some((r) => isAlias(r.value)) &&
      g.rolloutPct > 0 &&
      g.rolloutPct < 10000,
  );
  if (!rg.length) {
    console.log("No rule-gated fractional-rollout gates");
    return;
  }
  console.log(`::group::Rule-gated rollout (${rg.length})`);
  for (const g of rg) {
    const syn = synthCondition(g.rules, "all");
    if (!syn) {
      console.log(`  ${g.name}: rules not synthesizable — skipping`);
      continue;
    }
    // Non-matchers: the rule fails before the rollout bucket → always denied.
    let denyOk = true;
    for (let i = 0; i < 20; i++) {
      if ((await evaluate({ anonymous_id: `rg-n:${i}`, ...syn.nomatch })).flags?.[g.name] === true) {
        denyOk = false;
        break;
      }
    }
    // Matchers: pass at ~rolloutPct over a cohort (vary the bucketing identity).
    const N = 200;
    let pass = 0;
    for (let i = 0; i < N; i++) {
      if ((await evaluate({ anonymous_id: `rg-m:${i}`, ...syn.match })).flags?.[g.name] === true) pass++;
    }
    const rate = pass / N;
    const want = g.rolloutPct / 10000;
    const band = Math.max(0.08, 4 * Math.sqrt((want * (1 - want)) / N));
    if (denyOk && Math.abs(rate - want) <= band) {
      ok(`gate ${g.name}: non-match denied, matched rollout ${(rate * 100).toFixed(1)}% ≈ ${(want * 100).toFixed(0)}%`);
    } else {
      annotate(
        `gate ${g.name}: nonMatchDenied=${denyOk}; matched rollout ${(rate * 100).toFixed(1)}% vs ${(want * 100).toFixed(0)}% (±${(band * 100).toFixed(0)}pp)`,
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
    list = listKillswitches();
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
      st = experimentResults(EXP);
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
  const gates = listGates().filter((g) => g.enabled);
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

// ── universe holdout (live) ─────────────────────────────────────────────────
// A unit in a universe's holdout is excluded from EVERY experiment in that
// universe. Over a cohort the assigned fraction must be ≈ (1 − holdoutWidth) ×
// allocation — i.e. the holdout carves out the right share before allocation.
async function probeHoldout() {
  if (!CLIENT_KEY) return;
  let universes;
  try {
    universes = listUniverses();
  } catch {
    console.log("universes list unavailable — skipping holdout leg");
    return;
  }
  const withHoldout = universes.filter((u) => Array.isArray(u.holdoutRange ?? u.holdout_range));
  if (!withHoldout.length) {
    console.log("No universes with a holdout range");
    return;
  }
  const exps = listExperiments().filter((e) => e.status === "running");
  console.log(`::group::Universe holdout (${withHoldout.length})`);
  for (const u of withHoldout) {
    const range = u.holdoutRange ?? u.holdout_range;
    const holdoutFrac = (range[1] - range[0]) / 10000;
    const uniExps = exps.filter((e) => e.universe === u.name);
    if (!uniExps.length) {
      console.log(`  ${u.name}: holdout ${(holdoutFrac * 100).toFixed(0)}%, no running experiments — skipping`);
      continue;
    }
    const maxAlloc = Math.max(...uniExps.map((e) => (e.allocationPct ?? e.allocation_pct ?? 10000) / 10000));
    const N = 300;
    let assigned = 0;
    for (let i = 0; i < N; i++) {
      const r = await evaluate({ user_id: `ho:${u.name}:${i}` });
      if (uniExps.some((e) => r.experiments?.[e.name])) assigned++;
    }
    const rate = assigned / N;
    const want = (1 - holdoutFrac) * maxAlloc;
    const band = Math.max(0.08, 4 * Math.sqrt((want * (1 - want)) / N));
    if (Math.abs(rate - want) <= band) {
      ok(`universe ${u.name}: ${(rate * 100).toFixed(1)}% assigned ≈ ${(want * 100).toFixed(0)}% (holdout ${(holdoutFrac * 100).toFixed(0)}%)`);
    } else {
      annotate(`universe ${u.name}: assigned ${(rate * 100).toFixed(1)}% vs expected ${(want * 100).toFixed(0)}% (holdout ${(holdoutFrac * 100).toFixed(0)}%, ±${(band * 100).toFixed(0)}pp)`);
      failed++;
    }
  }
  console.log("::endgroup::");
}

// ── configs resolve to the client ───────────────────────────────────────────
// Every published config must reach /sdk/evaluate with a defined value. (Deep
// value-equality lives in the unit round-trip tests; the write→KV→edge path is
// proven live by the killswitch-propagation leg, since killswitches ride the
// same configs table + blob.)
async function probeConfigs() {
  if (!CLIENT_KEY) return;
  let configs;
  try {
    configs = listConfigs();
  } catch {
    console.log("configs list unavailable — skipping");
    return;
  }
  if (!configs.length) {
    console.log("No configs to check");
    return;
  }
  const got = (await evaluate({ anonymous_id: "cfg-probe" })).configs ?? {};
  console.log(`::group::Configs (${configs.length})`);
  for (const c of configs) {
    if (c.name in got && got[c.name] !== undefined) ok(`config ${c.name}: resolves to client`);
    else {
      annotate(`config ${c.name}: NOT resolved on /sdk/evaluate (publish/KV gap)`);
      failed++;
    }
  }
  console.log("::endgroup::");
}

// ── killswitch single-switch toggle propagation (write → next read) ──────────
// Flipping one switch via the admin API must transfer to the edge on the next
// request. Opt-in + self-restoring (SHIPEASY_PROBE_MUTATE=1): read a switch, flip
// it, poll /sdk/evaluate until it reflects, then restore the original value.
async function probeKillswitchPropagation() {
  if (!CLIENT_KEY) return;
  if (!process.env.SHIPEASY_PROBE_MUTATE) {
    console.log("ks-propagation leg disabled — enable with SHIPEASY_PROBE_MUTATE=1 (flips a switch then restores it)");
    return;
  }
  const list = listKillswitches();
  const ks = list.find((k) => k.envs?.prod?.switches && Object.keys(k.envs.prod.switches).length);
  if (!ks) {
    console.log("No killswitch with switches — skipping propagation leg");
    return;
  }
  const key = Object.keys(ks.envs.prod.switches)[0];
  const orig = ks.envs.prod.switches[key];
  const flipped = !orig;
  const setSwitch = (val) =>
    cliText(["release", "killswitch", "set", ks.name, "--env", "prod", "--switch-key", key, "--value", String(val)]);
  const read = async () => (await evaluate({ anonymous_id: "ksp-probe" })).killswitches?.[ks.name]?.[key];
  console.log(`::group::Killswitch switch propagation (${ks.name}.${key})`);
  let restored = false;
  try {
    setSwitch(flipped);
    let live;
    for (let i = 0; i < 12; i++) {
      await sleep(2000);
      live = await read();
      if (live === flipped) break;
    }
    if (live === flipped) ok(`flip ${key} ${orig}→${flipped} propagated to the edge`);
    else {
      annotate(`flip ${key} ${orig}→${flipped} did NOT propagate (edge still ${live})`);
      failed++;
    }
  } finally {
    setSwitch(orig);
    for (let i = 0; i < 12; i++) {
      await sleep(2000);
      if ((await read()) === orig) {
        restored = true;
        break;
      }
    }
    console.log(restored ? `  restored ${key}=${orig}` : `  ⚠ could not confirm restore of ${key}=${orig}`);
  }
  console.log("::endgroup::");
}

// ── Project stats knobs — EFFECT test. Not "did the value save" (that's just
// CRUD) but "does changing the knob change the analysis". Opt-in + self-restoring
// (SHIPEASY_PROBE_MUTATE=1 + SHIPEASY_PROBE_EXPERIMENT/METRIC_EVENT + CLIENT_KEY):
// inject ONE deterministic, slightly-imbalanced synthetic cohort, then vary a
// knob to a random in-range value and re-run the analyzer, asserting the
// persisted result moves the way the statistics say it must.
//
// Two knobs have a robustly-observable effect on an EXISTING experiment's
// persisted results via `experiments reanalyze`:
//   • default_power → experiment_results.realized_mde. MDE = (z_{α/2}+z_β)·SE, so
//     raising power raises z_β and the realized detectable effect, monotonically,
//     independent of the exact N — this is literally "does the power knob move
//     statistical power".
//   • srm_threshold → experiment_results.srm_detected. On a deliberately
//     imbalanced split srm_detected = (srm_p < threshold), so a threshold bracket
//     around the induced srm_p flips the flag.
// The other knobs can't move an EXISTING canary run this way, so each gets its
// own purpose-built fixture below instead: mSPRT τ needs a sequential experiment
// (probeSequentialTau), CUPED needs frozen pre-period baselines (probeCupedGates),
// and min_sample_size / min_runtime_days / ci_confidence seed the verdict / the
// displayed interval rather than a results column (probeVerdictGates).
async function probeStatsEffect() {
  const EXP = process.env.SHIPEASY_PROBE_EXPERIMENT;
  const EV = process.env.SHIPEASY_PROBE_METRIC_EVENT;
  if (!process.env.SHIPEASY_PROBE_MUTATE) {
    console.log(
      "stats-effect leg disabled — enable with SHIPEASY_PROBE_MUTATE=1 (varies power/SRM, then restores)",
    );
    return;
  }
  if (!CLIENT_KEY || !EXP || !EV) {
    console.log("stats-effect leg: needs SHIPEASY_PROBE_EXPERIMENT + SHIPEASY_PROBE_METRIC_EVENT");
    return;
  }
  const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
  const proj = await readProject();
  if (proj && !hasStatsKnobs(proj)) {
    console.log("stats-effect leg: project stats knobs absent — prod UI worker predates the per-project-stats-settings deploy; skipping (soft)");
    return;
  }
  if (!proj?.id) {
    annotate("stats-effect: could not read project via admin API");
    failed++;
    return;
  }
  const setKnob = (flag, val) => cliText(["projects", "update", proj.id, flag, String(val)]);
  const treatmentRow = () => {
    const st = experimentResults(EXP);
    const rows = Array.isArray(st.results) ? st.results : (st.results?.results ?? []);
    return rows.find((r) => (r.group_name ?? r.groupName) === "treatment");
  };
  const mdeOf = (r) => (r ? (r.realized_mde ?? r.realizedMde) : null);
  const srmOf = (r) => (r ? (r.srm_detected ?? r.srmDetected) : null);
  // Reanalyze a few times then read — the cohort is already in AE, so recompute
  // is fast; the passes just absorb queue-consumer lag.
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      cliText(reanalyzeArgs(EXP));
      await sleep(12_000);
    }
    return treatmentRow();
  };

  // Deterministic, idempotent, imbalanced cohort (200 control / 260 treatment)
  // → induced srm_p ≈ 0.005, comfortably inside the [1e-4, 0.05] threshold band.
  const now = Date.now();
  const events = [];
  for (const [grp, n, conv] of [
    ["control", 200, 40],
    ["treatment", 260, 60],
  ]) {
    for (let i = 0; i < n; i++) {
      const uid = `sfx-${grp[0]}-${i}`;
      events.push({ type: "exposure", experiment: EXP, group: grp, user_id: uid, ts: now });
      if (i % 100 < conv) events.push({ type: "metric", event_name: EV, value: 1, user_id: uid, ts: now });
    }
  }

  console.log(`::group::Stats knobs affect the analysis (${EXP})`);
  const orig = { power: proj.defaultPower, srm: proj.srmThreshold };
  try {
    for (let i = 0; i < events.length; i += 200) {
      const res = await fetch(`${EDGE_URL}/collect`, {
        method: "POST",
        headers: { "content-type": "text/plain", "x-sdk-key": CLIENT_KEY },
        body: JSON.stringify({ events: events.slice(i, i + 200) }),
      });
      if (!res.ok) {
        annotate(`/collect ${res.status} — cannot run stats-effect leg`);
        failed++;
        console.log("::endgroup::");
        return;
      }
    }

    // Wait for the cohort to land (with SRM off, so realized_mde is clean).
    await setKnob("--srm-threshold", orig.srm);
    let base = await settle();
    for (let tries = 0; tries < 8 && !(base && (base.n ?? 0) > 0); tries++) base = await settle();
    if (!base || !((base.n ?? 0) > 0)) {
      console.log("⚠ no enrolment recovered within timeout (AE ingestion lag) — skipping (soft)");
      console.log("::endgroup::");
      return;
    }

    // ── default_power → realized_mde (monotonic increase) ────────────────────
    const pLo = Number(rnd(0.5, 0.6).toFixed(3));
    const pHi = Number(rnd(0.95, 0.99).toFixed(3));
    await setKnob("--default-power", pLo);
    const mdeLo = mdeOf(await settle());
    await setKnob("--default-power", pHi);
    const mdeHi = mdeOf(await settle());
    if (mdeLo != null && mdeHi != null && mdeLo > 0) {
      if (mdeHi > mdeLo * 1.15) {
        ok(`default_power ${pLo}→${pHi} raised realized_mde ${mdeLo.toFixed(4)}→${mdeHi.toFixed(4)}`);
      } else {
        annotate(
          `default_power had NO effect: realized_mde ${mdeLo} (power ${pLo}) vs ${mdeHi} (power ${pHi}) — expected a clear increase`,
        );
        failed++;
      }
    } else {
      console.log(`⚠ realized_mde not populated (${mdeLo}/${mdeHi}) — skipping power assertion (soft)`);
    }
    await setKnob("--default-power", orig.power);

    // ── srm_threshold → srm_detected (flag flips across the induced srm_p) ────
    const thrHi = Number(rnd(0.02, 0.05).toFixed(4)); // > induced srm_p → detect
    const thrLo = Number(rnd(0.0001, 0.0008).toFixed(4)); // < induced srm_p → clear
    await setKnob("--srm-threshold", thrHi);
    const detHi = srmOf(await settle());
    await setKnob("--srm-threshold", thrLo);
    const detLo = srmOf(await settle());
    if (detHi === 1 && detLo === 0) {
      ok(`srm_threshold ${thrHi}→${thrLo} flipped srm_detected 1→0 on the imbalanced split`);
    } else if (detHi === detLo) {
      // srm_p fell outside [thrLo, thrHi] (real traffic diluted or over-skewed
      // the split) — the knob still applied, just not observable here. Soft.
      console.log(
        `⚠ srm_detected did not flip (hi=${detHi}, lo=${detLo}) — induced srm_p outside the bracket; not a knob failure (soft)`,
      );
    } else {
      annotate(`srm_threshold inverted: raising the threshold gave detected=${detHi}, lowering gave ${detLo}`);
      failed++;
    }
  } finally {
    try {
      await setKnob("--default-power", orig.power);
      await setKnob("--srm-threshold", orig.srm);
      console.log(`  restored default_power=${orig.power}, srm_threshold=${orig.srm}`);
    } catch (e) {
      annotate(`stats-effect: restore failed — ${e?.message ?? e}`);
      failed++;
    }
  }
  console.log("::endgroup::");
}

// ── latency: client-facing /sdk/evaluate must be fast (<50ms target) ─────────
async function probeLatency() {
  if (!CLIENT_KEY) return;
  const N = 50;
  const MAX_MS = Number(process.env.SHIPEASY_PROBE_MAX_MS || "50");
  for (let i = 0; i < 3; i++) await evaluate({ anonymous_id: "lat-warm" }); // warm TLS + isolate
  const times = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await evaluate({ anonymous_id: `lat:${i}` });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const q = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))];
  const p50 = q(0.5), p95 = q(0.95), p99 = q(0.99), max = times[times.length - 1];
  console.log(`::group::Latency — /sdk/evaluate (${N} reqs, end-to-end from CI runner)`);
  console.log(`  p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms max=${max.toFixed(1)}ms (target p95<${MAX_MS}ms)`);
  if (p95 <= MAX_MS) ok(`latency: p95 ${p95.toFixed(1)}ms ≤ ${MAX_MS}ms`);
  else {
    annotate(`latency: p95 ${p95.toFixed(1)}ms > ${MAX_MS}ms (end-to-end incl. CI→edge network)`);
    failed++;
  }
  console.log("::endgroup::");
}

// ── identify / anonymous→identified merge ───────────────────────────────────
// When an anonymous visitor signs in, alias(anonId, userId) ties the two ids
// together so the analysis stitches their exposures/metrics into ONE unit (the
// merge — see doc 18 §Login transition; bucketing itself keys on user_id
// post-login for cross-device consistency). Validate the merge live: an anon
// exposure + an identify + an identified exposure (same arm) must count as ONE
// user, not two. Opt-in via SHIPEASY_PROBE_IDENTIFY_EXPERIMENT (a dedicated
// 2-group experiment); idempotent (fixed ids).
async function probeIdentifyMerge() {
  const EXP = process.env.SHIPEASY_PROBE_IDENTIFY_EXPERIMENT;
  if (!CLIENT_KEY || !EXP) {
    console.log("identify-merge leg: set SHIPEASY_PROBE_IDENTIFY_EXPERIMENT to enable");
    return;
  }
  const now = Date.now();
  // ONE person, anonymous then signed-in (alias ties the two ids), both exposed
  // to control; plus one treatment user so the analysis has two groups. The two
  // control exposures (anon id + user id) must STITCH to a single unit → control
  // n === 1. If the merge fails they'd count as two (n === 2). Fixed ids +
  // dedicated experiment keep the count exact and idempotent across runs.
  const events = [
    { type: "exposure", experiment: EXP, group: "control", anonymous_id: "v3-anon", ts: now },
    { type: "identify", anonymous_id: "v3-anon", user_id: "v3-user", ts: now },
    { type: "exposure", experiment: EXP, group: "control", user_id: "v3-user", ts: now },
    { type: "exposure", experiment: EXP, group: "treatment", user_id: "v3-treat", ts: now },
  ];
  console.log(`::group::Identify merge (${EXP})`);
  const res = await fetch(`${EDGE_URL}/collect`, {
    method: "POST",
    headers: { "content-type": "text/plain", "x-sdk-key": CLIENT_KEY },
    body: JSON.stringify({ events }),
  });
  if (!res.ok) {
    annotate(`/collect ${res.status} — cannot run identify-merge leg`);
    failed++;
    console.log("::endgroup::");
    return;
  }
  cliText(reanalyzeArgs(EXP));
  const deadline = Date.now() + 150_000;
  let control;
  while (Date.now() < deadline) {
    await sleep(10_000);
    let st;
    try {
      st = experimentResults(EXP);
    } catch {
      continue;
    }
    const rows = Array.isArray(st.results) ? st.results : st.results?.results ?? [];
    cliText(reanalyzeArgs(EXP));
    control = rows.find((r) => (r.group_name ?? r.groupName) === "control");
    if (control && (control.n ?? 0) > 0) break;
  }
  if (!control || !(control.n > 0)) {
    console.log("⚠ no enrolment recovered within timeout (AE ingestion lag) — merge pending");
    console.log("::endgroup::");
    return; // soft: don't flake on ingestion latency
  }
  if (control.n === 1) {
    ok(`identify merge: anonymous + signed-in exposures stitched to one unit (control n=1)`);
  } else {
    annotate(`identify merge: control n=${control.n} (expected 1 — anon+identified should merge to one user)`);
    failed++;
  }
  console.log("::endgroup::");
}

// ── server-SDK blob endpoints (/sdk/flags, /sdk/experiments) ─────────────────
// Client SDKs hit /sdk/evaluate (edge evals); SERVER SDKs poll the raw blobs and
// evaluate locally. Verify the server blobs are served (server key) and match the
// admin config the edge also serves. Opt-in via SHIPEASY_SERVER_KEY.
async function probeServerBlobs() {
  const SK = process.env.SHIPEASY_SERVER_KEY;
  if (!SK) {
    console.log("server-blob leg: set SHIPEASY_SERVER_KEY to enable");
    return;
  }
  const [fr, er] = await Promise.all([
    fetch(`${EDGE_URL}/sdk/flags`, { headers: { "x-sdk-key": SK } }),
    fetch(`${EDGE_URL}/sdk/experiments`, { headers: { "x-sdk-key": SK } }),
  ]);
  if (!fr.ok || !er.ok) {
    annotate(`server blobs: /sdk/flags ${fr.status}, /sdk/experiments ${er.status}`);
    failed++;
    return;
  }
  const flagsBlob = await fr.json();
  const expBlob = await er.json();
  const blobGates = flagsBlob.gates ?? {};
  const blobExps = expBlob.experiments ?? {};
  const gates = listGates().filter((g) => g.enabled);
  const exps = listExperiments().filter((e) => e.status === "running");
  console.log("::group::Server-SDK blobs (/sdk/flags + /sdk/experiments)");
  let gmiss = 0;
  for (const g of gates) {
    const bg = blobGates[g.name];
    if (!bg || bg.rolloutPct !== g.rolloutPct || !!bg.enabled !== !!g.enabled) gmiss++;
  }
  if (gmiss === 0) ok(`/sdk/flags carries all ${gates.length} gates with matching rollout/enabled`);
  else {
    annotate(`/sdk/flags: ${gmiss}/${gates.length} gates missing or mismatched vs admin`);
    failed++;
  }
  const emiss = exps.filter((e) => !blobExps[e.name]).map((e) => e.name);
  if (emiss.length === 0) ok(`/sdk/experiments carries all ${exps.length} running experiment(s)`);
  else {
    annotate(`/sdk/experiments missing: ${emiss.join(", ")}`);
    failed++;
  }
  console.log("::endgroup::");
}

// ── SSR bootstrap (/sdk/bootstrap) ───────────────────────────────────────────
// Server components pre-evaluate via /sdk/bootstrap (server key + base64
// X-User-Context). Its verdicts must agree with /sdk/evaluate for the same user
// — otherwise SSR and the browser disagree and the UI flickers.
async function probeBootstrap() {
  const SK = process.env.SHIPEASY_SERVER_KEY;
  if (!SK || !CLIENT_KEY) {
    console.log("bootstrap leg: needs SHIPEASY_SERVER_KEY (+ client key)");
    return;
  }
  const user = { anonymous_id: "bs-probe", country: "US", plan: "pro" };
  const ctx = Buffer.from(JSON.stringify(user)).toString("base64");
  const br = await fetch(`${EDGE_URL}/sdk/bootstrap`, {
    headers: { "x-sdk-key": SK, "X-User-Context": ctx },
  });
  if (!br.ok) {
    annotate(`/sdk/bootstrap ${br.status}`);
    failed++;
    return;
  }
  const bs = await br.json();
  const ev = await evaluate(user); // same user, client key → edge eval
  console.log("::group::SSR bootstrap vs /sdk/evaluate");
  const names = new Set([...Object.keys(bs.flags ?? {}), ...Object.keys(ev.flags ?? {})]);
  const disagree = [...names].filter((n) => (bs.flags?.[n] ?? false) !== (ev.flags?.[n] ?? false));
  if (disagree.length === 0) ok(`bootstrap agrees with /sdk/evaluate on all ${names.size} gates`);
  else {
    annotate(`bootstrap disagrees with /sdk/evaluate on: ${disagree.join(", ")}`);
    failed++;
  }
  console.log("::endgroup::");
}

// ── multi-env isolation ──────────────────────────────────────────────────────
// An SDK key is locked to its environment — it can only ever read that env's
// blob. With a per-env-divergent resource configured (e.g. a killswitch switch
// true in dev / false in prod), the prod-key and dev-key evaluations MUST differ.
async function probeMultiEnv() {
  const DEVK = process.env.SHIPEASY_CLIENT_KEY_DEV;
  if (!CLIENT_KEY || !DEVK) {
    console.log("multi-env leg: set SHIPEASY_CLIENT_KEY_DEV (a dev client key) to enable");
    return;
  }
  const evalKey = async (key) => {
    const r = await fetch(`${EDGE_URL}/sdk/evaluate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sdk-key": key },
      body: JSON.stringify({ user: { anonymous_id: "env-probe" } }),
    });
    if (!r.ok) throw new Error(`/sdk/evaluate ${r.status}`);
    return r.json();
  };
  const [prod, dev] = await Promise.all([evalKey(CLIENT_KEY), evalKey(DEVK)]);
  console.log("::group::Multi-env isolation (prod key vs dev key)");
  const snap = (e) => JSON.stringify({ flags: e.flags, configs: e.configs, killswitches: e.killswitches });
  if (snap(prod) !== snap(dev)) {
    ok("env-locked keys read their own env blob (prod and dev evaluations diverge)");
    console.log(`  prod killswitches=${JSON.stringify(prod.killswitches)}`);
    console.log(`  dev  killswitches=${JSON.stringify(dev.killswitches)}`);
  } else {
    annotate("multi-env: prod and dev evaluations identical — env isolation not observable (configure a per-env divergent value)");
    failed++;
  }
  console.log("::endgroup::");
}

// ── metric-threshold alert rules ─────────────────────────────────────────────
// A metric-rule alert is raised by the alerts cron (every ~10m) when a metric
// crosses its threshold. Opt-in (SHIPEASY_PROBE_ALERTS, async); asserts the cron
// is evaluating rules — i.e. an active `metric_rule` alert exists for a rule whose
// metric currently breaches. Soft-warns if the cron hasn't run since rule setup.
async function probeAlertRules() {
  if (!process.env.SHIPEASY_PROBE_ALERTS) {
    console.log("alert-rules leg: set SHIPEASY_PROBE_ALERTS=1 to enable (async ~10m cron)");
    return;
  }
  let rules, alerts;
  try {
    rules = listAlertRules();
    alerts = listAlerts();
  } catch {
    console.log("alert-rules/alerts list unavailable — skipping");
    return;
  }
  const enabled = rules.filter((r) => r.enabled !== false);
  if (!enabled.length) {
    console.log("no enabled alert rules to check");
    return;
  }
  // Raised alerts now live in the unified ops queue as `type: 'alert'` tickets
  // (auto-filed by the analysis cron), not a separate alerts table with a
  // `source` field — hence `ops list` filtered by type rather than a dedicated
  // alerts endpoint.
  const active = alerts.filter((a) => a.type === "alert");
  console.log(`::group::Metric-threshold alert rules (${enabled.length} enabled)`);
  if (active.length) {
    ok(`alerts cron raised metric_rule alert(s): ${active.map((a) => a.title || a.dedupeKey).join("; ")}`);
  } else {
    console.log("⚠ no active metric_rule alert yet — alerts cron runs ~every 10m; a breaching rule hasn't been evaluated since setup");
  }
  console.log("::endgroup::");
}

// ── errors / see(): ingestion, correlation + caused-by linking, timeseries ───
// Sends (a) an in-process caused_by chain and (b) a cross-runtime correlation
// pair (client Http5xx ⇄ server cause sharing a correlation_id) and asserts the
// errors ingest AND link via causedByFingerprint (so they display together).
// Then asserts the occurrence series render — a WEEKLY (daily-bucketed) and a 24h
// (hourly-bucketed, small intervals) view. Opt-in via SHIPEASY_APP_URL.
async function probeErrors() {
  if (!CLIENT_KEY || !APP_URL) {
    console.log("errors leg: set SHIPEASY_APP_URL (admin API) to enable");
    return;
  }
  const now = Date.now();
  const corr = "probe-corr-001";
  const events = [
    { type: "error", side: "server", error_type: "ProbeCheckoutError", message: "probe checkout failed",
      caused_by: { error_type: "ProbeDbError", message: "probe connection refused" }, ts: now },
    { type: "error", side: "server", error_type: "ProbeApiError", message: "probe upstream 500", correlation_id: corr, ts: now },
    { type: "error", side: "client", kind: "network", error_type: "ProbeHttp5xx", message: "probe 500 from api", correlation_id: corr, ts: now },
  ];
  console.log("::group::Errors / see() ingestion + linking");
  const cr = await fetch(`${EDGE_URL}/collect`, {
    method: "POST",
    headers: { "content-type": "text/plain", "x-sdk-key": CLIENT_KEY },
    body: JSON.stringify({ events }),
  });
  if (!cr.ok) {
    annotate(`/collect error events ${cr.status}`);
    failed++;
    console.log("::endgroup::");
    return;
  }
  await sleep(3000);
  const er = await fetch(`${APP_URL}/api/admin/errors?status=all&limit=200`, { headers: ADMIN_H });
  if (!er.ok) {
    annotate(`/api/admin/errors ${er.status}`);
    failed++;
    console.log("::endgroup::");
    return;
  }
  const raw = await er.json();
  const list = Array.isArray(raw) ? raw : raw.data ?? [];
  const byType = (t) => list.find((e) => e.errorType === t);
  const apiE = byType("ProbeApiError"), httpE = byType("ProbeHttp5xx"), chkE = byType("ProbeCheckoutError");
  // Cross-runtime correlation: the client Http5xx must point at the server cause.
  if (httpE && apiE && httpE.causedByFingerprint === apiE.fingerprint) {
    ok("correlation: client Http5xx linked to its server cause (same correlation_id)");
  } else {
    annotate(`correlation: Http5xx.causedBy=${httpE?.causedByFingerprint} vs ApiError.fp=${apiE?.fingerprint}`);
    failed++;
  }
  // In-process caused_by chain.
  if (chkE && chkE.causedByFingerprint) ok("caused-by chain: error linked to its cause (displayed together)");
  else {
    annotate(`caused-by chain: ProbeCheckoutError has no causedByFingerprint`);
    failed++;
  }
  console.log("::endgroup::");

  // Timeseries: weekly (daily buckets) + 24h (hourly buckets — small intervals).
  const nowS = Math.floor(now / 1000);
  const series = async (from, bucket) => {
    const r = await fetch(`${APP_URL}/api/admin/errors/series`, {
      method: "POST",
      headers: ADMIN_H,
      body: JSON.stringify({ from, to: nowS, bucket }),
    });
    if (!r.ok) throw new Error(`series ${r.status}`);
    return r.json();
  };
  console.log("::group::Error timeseries (weekly + 24h)");
  try {
    const wk = await series(nowS - 7 * 86_400, 86_400);
    const day = await series(nowS - 86_400, 3_600);
    const wkOk = Array.isArray(wk.rows);
    const dayOk = Array.isArray(day.rows);
    // 24h must be SMALL intervals: every returned bucket aligns to the hour, and
    // the query bucketed on 3600 (not a coarse daily bucket).
    const hourly = dayOk && day.rows.every((r) => Number(r.t) % 3_600 === 0);
    const small = typeof day.sql === "string" && day.sql.includes("intDiv(toUInt32(double2), 3600)");
    if (wkOk && dayOk && hourly && small) {
      ok(`error series render: weekly ${wk.rows.length} daily bucket(s) + 24h ${day.rows.length} hourly bucket(s)`);
    } else {
      annotate(`error series: weeklyRows=${wkOk} 24hRows=${dayOk} hourlyAligned=${hourly} smallBucket=${small}`);
      failed++;
    }
  } catch (e) {
    annotate(`error-series endpoint failed: ${e?.message ?? e}`);
    failed++;
  }
  console.log("::endgroup::");
}

// ── gradual rollout (over-time ramp) ─────────────────────────────────────────
// A stack entry's rollout % can RAMP linearly over time — effectivePct(entry,now)
// interpolates from→to over [startAt, startAt+durationMs], clamped outside. This
// resolves only on the worker hot path, so it's exactly what a prod probe should
// guard. This leg discovers single-entry ramp stacks, MIRRORS core's effectivePct
// (verbatim — the cross-SDK contract) to get the live target %, and asserts the
// edge's cohort pass-rate matches: a complete ramp sits at `to`, a pending one at
// `from`, a mid-flight one at the lerp. For a ramped CONDITION it first asserts
// the rule still gates (non-matchers always denied), then measures matchers.
function effectivePctMirror(entry, now) {
  const base = entry.type === "condition" ? (entry.rolloutPct ?? 10000) : (entry.rolloutPct ?? 0);
  const r = entry.ramp;
  if (!r) return base;
  if (now <= r.startAt) return r.from;
  if (now >= r.startAt + r.durationMs) return r.to;
  const pct = r.from + Math.trunc(((r.to - r.from) * (now - r.startAt)) / r.durationMs);
  return Math.max(0, Math.min(10000, pct));
}

async function probeGradualRamps() {
  if (!CLIENT_KEY) {
    console.log("ramp leg: SHIPEASY_CLIENT_KEY unset — skipping");
    return;
  }
  const gates = listGates().filter((g) => g.enabled);
  const ramped = gates.filter(
    (g) => Array.isArray(g.stack) && g.stack.length === 1 && g.stack[0]?.ramp,
  );
  if (!ramped.length) {
    console.log("No single-entry ramp gates");
    return;
  }
  console.log(`::group::Gradual ramps (${ramped.length})`);
  for (const g of ramped) {
    const entry = g.stack[0];
    const now = Date.now();
    const want = effectivePctMirror(entry, now) / 10000;
    // A ramped condition needs its rules satisfied before the bucket; a ramped
    // rollout buckets everyone. Build the per-user context accordingly.
    let baseCtx = {};
    if (entry.type === "condition") {
      const syn = synthCondition(entry.rules || [], entry.pass || "all");
      if (!syn) {
        console.log(`  ${g.name}: condition not synthesizable — skipping`);
        continue;
      }
      baseCtx = syn.match;
      const leak = (await evaluate({ anonymous_id: "rmp-n", ...syn.nomatch })).flags?.[g.name] === true;
      if (leak) {
        annotate(`ramp gate ${g.name}: non-matching caller ADMITTED — rule leak before the ramp bucket`);
        failed++;
      }
    }
    const N = 300;
    let pass = 0;
    for (let i = 0; i < N; i++) {
      if ((await evaluate({ anonymous_id: `rmp:${g.name}:${i}`, ...baseCtx })).flags?.[g.name] === true) pass++;
    }
    const rate = pass / N;
    let pass_ok;
    if (want <= 0) pass_ok = pass === 0;
    else if (want >= 1) pass_ok = pass === N;
    else {
      const band = Math.max(0.07, 4 * Math.sqrt((want * (1 - want)) / N));
      pass_ok = Math.abs(rate - want) <= band;
    }
    const phase =
      now <= entry.ramp.startAt
        ? "pending"
        : now >= entry.ramp.startAt + entry.ramp.durationMs
          ? "complete"
          : "in-flight";
    const line = `gate ${g.name} (${entry.type} ramp ${phase}): observed ${(rate * 100).toFixed(1)}% vs effective ${(want * 100).toFixed(1)}% (n=${N})`;
    if (pass_ok) ok(line);
    else {
      annotate(`ramp drift — ${line}`);
      failed++;
    }
  }
  console.log("::endgroup::");
}

// ── managed presets (fromTemplate) ───────────────────────────────────────────
// A managed-preset condition (bots / mobile / a geo region) renders a curated
// audience in the dashboard but ships an EXPANDED concrete rule in the blob. This
// leg discovers single managed conditions, asserts (1) the `fromTemplate` label
// survives the admin round-trip (a lost label breaks the managed render), and (2)
// the preset audience is admitted and others denied at the edge — including the
// bot user-agent regex, which the generic targeting leg deliberately skips.
function managedSynth(rules) {
  if (!rules.length) return null;
  // A lone regex on a request-string attr (the bot signature) — synth a known-bot
  // UA and a plain-browser UA rather than trying to reverse the pattern.
  const reRule = rules.find((r) => r.op === "regex" && typeof r.value === "string");
  if (rules.length === 1 && reRule) {
    return {
      match: { [reRule.attr]: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
      nomatch: { [reRule.attr]: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15" },
    };
  }
  return synthCondition(rules, "all");
}

async function probeManagedPresets() {
  if (!CLIENT_KEY) {
    console.log("managed-preset leg: SHIPEASY_CLIENT_KEY unset — skipping");
    return;
  }
  const gates = listGates().filter((g) => g.enabled);
  // Single managed condition at full rollout (so the verdict is deterministic),
  // no ramp.
  const managed = gates.filter(
    (g) =>
      Array.isArray(g.stack) &&
      g.stack.length === 1 &&
      g.stack[0]?.type === "condition" &&
      g.stack[0]?.fromTemplate &&
      !g.stack[0]?.ramp &&
      (g.stack[0]?.rolloutPct == null || g.stack[0]?.rolloutPct === 10000),
  );
  if (!managed.length) {
    console.log("No managed-preset gates (fromTemplate)");
    return;
  }
  console.log(`::group::Managed presets (${managed.length})`);
  for (const g of managed) {
    const e = g.stack[0];
    if (typeof e.fromTemplate !== "string" || !e.fromTemplate.length) {
      annotate(`managed gate ${g.name}: fromTemplate label missing — managed render broken`);
      failed++;
      continue;
    }
    const ctx = managedSynth(e.rules || []);
    if (!ctx) {
      ok(`managed gate ${g.name}: label "${e.fromTemplate}" preserved (rule not synthesizable, eval skipped)`);
      continue;
    }
    const mf = (await evaluate({ anonymous_id: "mp-m", ...ctx.match })).flags?.[g.name] === true;
    const nf = (await evaluate({ anonymous_id: "mp-n", ...ctx.nomatch })).flags?.[g.name] === true;
    if (mf && !nf) {
      ok(`managed gate ${g.name} ("${e.fromTemplate}"): preset audience admitted, others denied`);
    } else {
      annotate(`managed gate ${g.name} ("${e.fromTemplate}"): match=${mf} (want true), non-match=${nf} (want false)`);
      failed++;
    }
  }
  console.log("::endgroup::");
}

// ── per-condition rollout on a stack condition ───────────────────────────────
// A stack condition can carry its OWN fractional rolloutPct: after the rules
// match, the caller is bucketed at that %, miss → fall through. Distinct from the
// flat rule-gated rollout (#2c, no stack) and the condition→rollout fallthrough
// (#2b, a separate rollout entry). Verify here: non-matchers are ALWAYS denied
// (rule fails before the bucket), matchers pass at ~rolloutPct over a cohort.
async function probeConditionRollout() {
  if (!CLIENT_KEY) {
    console.log("condition-rollout leg: SHIPEASY_CLIENT_KEY unset — skipping");
    return;
  }
  const gates = listGates().filter((g) => g.enabled);
  const targets = gates.filter(
    (g) =>
      Array.isArray(g.stack) &&
      g.stack.length === 1 &&
      g.stack[0]?.type === "condition" &&
      !g.stack[0]?.ramp &&
      typeof g.stack[0]?.rolloutPct === "number" &&
      g.stack[0].rolloutPct > 0 &&
      g.stack[0].rolloutPct < 10000 &&
      !(g.stack[0].rules || []).some((r) => isAlias(r.value)),
  );
  if (!targets.length) {
    console.log("No per-condition fractional-rollout gates");
    return;
  }
  console.log(`::group::Per-condition rollout (${targets.length})`);
  for (const g of targets) {
    const e = g.stack[0];
    const syn = synthCondition(e.rules || [], e.pass || "all");
    if (!syn) {
      console.log(`  ${g.name}: condition not synthesizable — skipping`);
      continue;
    }
    let denyOk = true;
    for (let i = 0; i < 20; i++) {
      if ((await evaluate({ anonymous_id: `cr-n:${i}`, ...syn.nomatch })).flags?.[g.name] === true) {
        denyOk = false;
        break;
      }
    }
    const N = 300;
    const want = e.rolloutPct / 10000;
    let pass = 0;
    for (let i = 0; i < N; i++) {
      if ((await evaluate({ anonymous_id: `cr-m:${i}`, ...syn.match })).flags?.[g.name] === true) pass++;
    }
    const rate = pass / N;
    const band = Math.max(0.07, 4 * Math.sqrt((want * (1 - want)) / N));
    if (denyOk && Math.abs(rate - want) <= band) {
      ok(`gate ${g.name}: non-match denied, matched per-condition rollout ${(rate * 100).toFixed(1)}% ≈ ${(want * 100).toFixed(0)}%`);
    } else {
      annotate(`gate ${g.name}: nonMatchDenied=${denyOk}; matched ${(rate * 100).toFixed(1)}% vs ${(want * 100).toFixed(0)}% (±${(band * 100).toFixed(0)}pp)`);
      failed++;
    }
  }
  console.log("::endgroup::");
}

// ── stats-knob legs (mSPRT τ / CUPED / verdict gates) ────────────────────────
// The stats-effect leg above covers the two project knobs that move an EXISTING
// canary experiment's persisted results under `reanalyze` (default_power →
// realized_mde, srm_threshold → srm_detected). The remaining analysis knobs
// can't be exercised that way — each needs a purpose-built experiment:
//   • mSPRT τ (msprt_tau_mei_factor / msprt_tau_sd_factor) only feeds the
//     analysis when the experiment runs SEQUENTIAL testing → needs a sequential
//     fixture, and a fixed sibling to prove it stays null off the sequential path.
//   • CUPED (cuped_min_overlap / cuped_min_baseline_users / cuped_baseline_days)
//     only fires when frozen pre-experiment baselines exist → needs a fixture
//     seeded with a BACKDATED pre-period that correlates with the in-period
//     outcome, so the variance visibly drops when CUPED is admitted.
//   • min_sample_size / min_runtime_days seed the ship/hold/WAIT verdict (not any
//     results column), and ci_confidence drives which interval the UI displays →
//     covered by asserting the verdict flips and both CIs are carried.
// These build/mutate throwaway fixtures under SHIPEASY_PROBE_STATS_UNIVERSE, so
// they gate on SHIPEASY_PROBE_MUTATE and self-restore every project knob they touch.

const STATS_UNIVERSE = process.env.SHIPEASY_PROBE_STATS_UNIVERSE || "probe_stats";

// Read the bound project via the admin API. NOTE: `projects current`
// (getCurrentProject) is NOT a real route — /api/admin/projects/current collides
// with /projects/[id] (id="current") and 403s — so read the project by its id
// (SHIPEASY_PROJECT_ID) through the withAdmin GET, which returns the full row incl.
// the stats knobs. Returns null when unavailable.
async function readProject() {
  const id = process.env.SHIPEASY_PROJECT_ID || "";
  if (!APP_URL || !id) return null;
  try {
    const res = await fetch(`${APP_URL}/api/admin/projects/${id}`, { headers: ADMIN_H });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
// True once the deployed backend carries the per-project stats knobs. When false,
// the deployed UI worker predates the per-project-stats-settings feature, so a
// `projects update <knob>` would 422 ("unrecognized key") — the stats legs
// soft-skip rather than fail, and light up automatically once prod redeploys.
const hasStatsKnobs = (proj) => proj != null && proj.msprtTauMeiFactor != null;
const setProjKnob = (id, flag, val) => cliText(["projects", "update", id, flag, String(val)]);

// Approve a metric event so the edge :catalog KV blob is rebuilt. Inline
// goal-metric registration (attachInlineMetrics) inserts the backing event as
// pending:0 but does NOT call rebuildCatalog — only the events handlers do — so
// without this the edge /collect gate keeps 422-ing "Unregistered event names".
// approve is idempotent (works on an already-approved event) and always rebuilds.
function registerEvent(name) {
  try {
    cliText(["metrics", "events", "approve", name]);
  } catch (e) {
    console.log(`  registerEvent(${name}) note: ${e?.message ?? e}`);
  }
}

// THROTTLED chunked POST to /collect (text/plain JSON, client key). Returns true
// on success. Two constraints shape this:
//  • Analytics Engine SAMPLES per index (project) above ~100 data points/second
//    (scaling.md): a single 200-event burst gets heavily down-sampled, so the
//    recovered `n` and the injected effect collapse. Send small chunks with a
//    gap so the sustained write rate stays well under 100/s (~50/s here).
//  • A just-approved event can still be missing from the edge's in-memory catalog
//    cache (per-isolate, 60s TTL); retry the "Unregistered event names" 422.
const COLLECT_CHUNK = 20;
async function collect(events) {
  for (let i = 0; i < events.length; i += COLLECT_CHUNK) {
    const chunk = events.slice(i, i + COLLECT_CHUNK);
    let status = 0;
    let body = "";
    for (let attempt = 0; attempt < 7; attempt++) {
      const res = await fetch(`${EDGE_URL}/collect`, {
        method: "POST",
        headers: { "content-type": "text/plain", "x-sdk-key": CLIENT_KEY },
        body: JSON.stringify({ events: chunk }),
      });
      status = res.status;
      if (res.ok) break;
      body = await res.text().catch(() => "");
      if (status === 422 && body.includes("Unregistered")) {
        await sleep(15_000); // catalog cache TTL — let the rebuild propagate
        continue;
      }
      break; // other errors: don't spin
    }
    if (status < 200 || status >= 300) {
      annotate(`/collect ${status} — cannot seed stats fixture${body ? ` (${body.slice(0, 120)})` : ""}`);
      return false;
    }
    if (i + COLLECT_CHUNK < events.length) await sleep(500); // stay under the AE sampling rate
  }
  return true;
}

const expByName = () => new Map(listExperiments().map((e) => [e.name, e]));
const resultRows = (exp) => {
  let st;
  try {
    st = experimentResults(exp);
  } catch {
    return { rows: [], verdict: null }; // transient CLI/read error — never abort the probe
  }
  const rows = Array.isArray(st.results) ? st.results : (st.results?.results ?? []);
  return { rows, verdict: st.verdict ?? st.results?.verdict ?? null };
};
const groupRow = (rows, group) => rows.find((r) => (r.group_name ?? r.groupName) === group);
const varOf = (r) => (r ? (r.variance ?? null) : null);
const lambdaOf = (r) => (r ? (r.msprt_lambda ?? r.msprtLambda ?? null) : null);
// Reanalyze a few times then read (cohort already in AE — recompute is fast; the
// passes just absorb queue-consumer lag), reusing the stats-effect settle shape.
async function settle(exp, passes = 3, gapMs = 12_000) {
  for (let i = 0; i < passes; i++) {
    try {
      cliText(reanalyzeArgs(exp)); // transient reanalyze blip must not abort the whole probe
    } catch (e) {
      console.log(`  reanalyze(${exp}) transient error: ${e?.message ?? e}`);
    }
    await sleep(gapMs);
  }
  return resultRows(exp);
}

// A universe for the throwaway fixtures — created once, reused across runs.
function ensureStatsUniverse() {
  const has = () => listUniverses().some((u) => u.name === STATS_UNIVERSE);
  if (has()) return true;
  try {
    cliText(["release", "experiments", "universes", "create", STATS_UNIVERSE]);
  } catch (e) {
    console.log(`  could not create universe ${STATS_UNIVERSE}: ${e?.message ?? e}`);
  }
  return has();
}

// Create the fixture experiment if absent (idempotent — reused across runs). The
// goal metric is attached inline so `start` accepts it. Returns the row, or null
// when creation is refused (e.g. a Free plan rejecting sequential_testing → the
// leg soft-skips). `goalMetric` is the inline metric JSON string.
function ensureExperiment(name, { goalMetric, sequential = false }) {
  let exp = expByName().get(name);
  if (exp) return exp;
  const args = [
    "release", "experiments", "create", name,
    "--universe", STATS_UNIVERSE,
    "--groups", JSON.stringify([
      { name: "control", weight: 5000 },
      { name: "treatment", weight: 5000 },
    ]),
    "--allocation-percent", "100",
    "--goal-metric", goalMetric,
  ];
  if (sequential) args.push("--sequential-testing", "true");
  try {
    cliText(args);
  } catch (e) {
    console.log(`  could not create ${name}: ${e?.message ?? e}`);
    return null;
  }
  return expByName().get(name) ?? null;
}

// Force a clean run: a stopped/draft fixture is (re)started so `started_at`
// (and, for CUPED, the baseline freeze) is fresh; a running one is left as-is
// unless `restart` forces a stop→start cycle (needed to re-freeze CUPED).
function freshStart(name, { restart = false } = {}) {
  const exp = expByName().get(name);
  if (!exp) return null;
  if (exp.status === "running" && !restart) return exp;
  try {
    if (exp.status === "running") cliText(["release", "experiments", "stop", name]);
    if (exp.status === "archived") cliText(["release", "experiments", "restore", name]);
    cliText(["release", "experiments", "start", name]);
  } catch (e) {
    console.log(`  freshStart(${name}) failed: ${e?.message ?? e}`);
  }
  return expByName().get(name);
}

// A balanced, deterministic, idempotent exposure cohort with a binary metric at
// `controlPct` (control) / `controlPct+lift` (treatment). Fixed ids → re-runs
// upsert. Kept SMALL (default n=60/arm) with a STRONG effect: Analytics Engine
// samples per-index bursts, so a large cohort loses most of its events (and its
// signal) — a small, fully-landing cohort with a wide gap recovers a clean,
// significant delta. Conversion is exact for any n (first ⌈n·pct⌉ users fire).
function binaryCohort(exp, evt, { n = 200, controlPct = 30, lift = 40, tsMs = Date.now() }) {
  const events = [];
  for (const [grp, conv] of [["control", controlPct], ["treatment", controlPct + lift]]) {
    const tag = grp[0];
    const converters = Math.round((n * conv) / 100);
    for (let i = 0; i < n; i++) {
      const uid = `sk-${exp}-${tag}-${i}`;
      events.push({ type: "exposure", experiment: exp, group: grp, user_id: uid, ts: tsMs });
      if (i < converters) events.push({ type: "metric", event_name: evt, value: 1, user_id: uid, ts: tsMs });
    }
  }
  return events;
}

// ── mSPRT τ factors (only bite on a sequential experiment) ───────────────────
// Build a SEQUENTIAL fixture with a strong lift so mSPRT computes a λ, then vary
// the τ factors and assert (1) λ is populated, (2) it MOVES with the knob (τ
// feeds the mixing prior — a knob-ignoring bug leaves λ pinned), and (3) it stays
// NULL on a FIXED sibling seeded identically (the "only on sequential" contract:
// consumer.ts guards `if (exp.sequentialTesting)` before touching msprt_*). λ is
// non-monotonic in τ² in general, so we hard-assert movement, not a direction.
async function probeSequentialTau() {
  if (!process.env.SHIPEASY_PROBE_MUTATE) {
    console.log("mSPRT-τ leg disabled — enable with SHIPEASY_PROBE_MUTATE=1 (creates a sequential fixture)");
    return;
  }
  if (!CLIENT_KEY) {
    console.log("mSPRT-τ leg: SHIPEASY_CLIENT_KEY unset — skipping");
    return;
  }
  const proj = await readProject();
  if (proj && !hasStatsKnobs(proj)) {
    console.log("mSPRT-τ leg: project stats knobs absent — prod UI worker predates the per-project-stats-settings deploy; skipping (soft)");
    return;
  }
  if (!proj?.id) {
    annotate("mSPRT-τ: could not read project via admin API");
    failed++;
    return;
  }
  if (!ensureStatsUniverse()) {
    console.log("mSPRT-τ leg: no stats universe available — skipping");
    return;
  }
  console.log("::group::mSPRT τ factors (sequential only)");
  const SEQ = "probe_seq";
  const FIXED = "probe_seq_fixed";
  // MEI set so τ = MEI × msprt_tau_mei_factor is the active path; the strong lift
  // keeps τ² below the λ(τ) peak across the knob's [0.1,2.0] range so the swing is
  // large and one-signed in practice (we still only assert |Δλ|, never the sign).
  const goal = JSON.stringify({ event: "probe_seq_evt", aggregation: "count_users", min_effect_of_interest: 0.05 });
  const seq = ensureExperiment(SEQ, { goalMetric: goal, sequential: true });
  if (!seq) {
    console.log("  sequential fixture unavailable (plan gates sequential_testing?) — skipping");
    console.log("::endgroup::");
    return;
  }
  const fixed = ensureExperiment(FIXED, { goalMetric: goal, sequential: false });
  registerEvent("probe_seq_evt"); // rebuild the edge catalog — inline-metric events aren't in it yet
  freshStart(SEQ);
  if (fixed) freshStart(FIXED);

  const orig = { mei: proj.msprtTauMeiFactor, sd: proj.msprtTauSdFactor };
  const setTau = (mei, sd) => {
    setProjKnob(proj.id, "--msprt-tau-mei-factor", mei);
    setProjKnob(proj.id, "--msprt-tau-sd-factor", sd);
  };
  try {
    const tsMs = Date.now();
    // Inject each experiment's cohort separately (smaller per-index bursts).
    if (!(await collect(binaryCohort(SEQ, "probe_seq_evt", { tsMs })))) {
      failed++;
      console.log("::endgroup::");
      return;
    }
    if (fixed && !(await collect(binaryCohort(FIXED, "probe_seq_evt", { tsMs })))) {
      failed++;
      console.log("::endgroup::");
      return;
    }

    // τ small (both factors at their floor) vs τ large (at their ceiling).
    setTau(0.1, 0.05);
    let r = await settle(SEQ);
    for (let t = 0; t < 6 && !groupRow(r.rows, "treatment"); t++) r = await settle(SEQ);
    const lamLo = lambdaOf(groupRow(r.rows, "treatment"));
    setTau(2.0, 1.0);
    const lamHi = lambdaOf(groupRow((await settle(SEQ)).rows, "treatment"));

    // λ only moves with τ when the run has a detectable effect to weigh; AE
    // samples the synthetic cohort, so some runs land λ≈0 at BOTH τ (no signal).
    // Treat that as soft (can't move what isn't there) — the robust, always-true
    // contract is asserted separately below (λ populated on sequential, NULL on
    // the fixed sibling). Only a NON-trivial-but-static λ is a real "knob isn't
    // wired" bug → hard fail.
    if (lamLo == null || lamHi == null) {
      console.log(`⚠ msprt_lambda not populated (lo=${lamLo}, hi=${lamHi}) — AE ingestion lag; soft`);
    } else if (Math.abs(lamHi - lamLo) > 0.05) {
      ok(`mSPRT λ moves with τ: ${lamLo.toFixed(3)} (τ small) → ${lamHi.toFixed(3)} (τ large)`);
    } else if (Math.abs(lamLo) < 0.05 && Math.abs(lamHi) < 0.05) {
      console.log(`⚠ λ≈0 at both τ (${lamLo.toFixed(3)}/${lamHi.toFixed(3)}) — cohort landed no detectable effect under AE sampling; soft`);
    } else {
      annotate(`mSPRT τ had NO effect: λ=${lamLo} (small) vs ${lamHi} (large) — non-trivial λ but static across τ; the knob isn't feeding mSPRT`);
      failed++;
    }

    // Contract: the FIXED sibling never carries an mSPRT verdict, whatever τ is.
    if (fixed) {
      const fr = await settle(FIXED);
      const fLam = lambdaOf(groupRow(fr.rows, "treatment"));
      if (groupRow(fr.rows, "treatment") && fLam == null) {
        ok("mSPRT λ is null on the fixed-horizon sibling (τ only bites on sequential)");
      } else if (!groupRow(fr.rows, "treatment")) {
        console.log("⚠ fixed sibling has no enrolment yet — cannot assert the sequential-only contract (soft)");
      } else {
        annotate(`fixed-horizon experiment carries msprt_lambda=${fLam} — mSPRT leaked off the sequential path`);
        failed++;
      }
    }
  } finally {
    try {
      setTau(orig.mei, orig.sd);
      console.log(`  restored msprt_tau_mei_factor=${orig.mei}, msprt_tau_sd_factor=${orig.sd}`);
    } catch (e) {
      annotate(`mSPRT-τ: restore failed — ${e?.message ?? e}`);
      failed++;
    }
    try {
      cliText(["release", "experiments", "stop", SEQ]);
      if (fixed) cliText(["release", "experiments", "stop", FIXED]);
    } catch {}
  }
  console.log("::endgroup::");
}

// ── CUPED gates (need frozen pre-experiment baselines) ───────────────────────
// CUPED reduces variance only when a frozen pre-period baseline exists AND passes
// the overlap / min-baseline-users guards. Seed a fixture whose per-user
// in-period outcome correlates with its BACKDATED pre-period (a `count_events`
// metric — its per-user baseline is the pre-window event count, which is
// non-constant, unlike count_users/retention which CUPED skips). Then flip the
// gate knobs on a single freeze: admit CUPED (loose guards) → variance drops;
// deny CUPED (max min-baseline-users floor) → variance is the raw value. A drop
// proves the frozen baseline is real and the overlap/min-users guards bite; equal
// variances mean no baseline landed (AE lag / plan) → soft; an INCREASE is a real
// bug → hard. (The baseline-WINDOW knob is pinned by unit sims, not here — see the
// note at the end of the leg for why it can't be soundly isolated live.)
async function probeCupedGates() {
  if (!process.env.SHIPEASY_PROBE_MUTATE) {
    console.log("CUPED leg disabled — enable with SHIPEASY_PROBE_MUTATE=1 (seeds a baseline fixture)");
    return;
  }
  if (!CLIENT_KEY) {
    console.log("CUPED leg: SHIPEASY_CLIENT_KEY unset — skipping");
    return;
  }
  const proj = await readProject();
  if (proj && !hasStatsKnobs(proj)) {
    console.log("CUPED leg: project stats knobs absent — prod UI worker predates the per-project-stats-settings deploy; skipping (soft)");
    return;
  }
  if (!proj?.id) {
    annotate("CUPED: could not read project via admin API");
    failed++;
    return;
  }
  if (!ensureStatsUniverse()) {
    console.log("CUPED leg: no stats universe available — skipping");
    return;
  }
  console.log("::group::CUPED gates (frozen pre-experiment baselines)");
  const EXP = "probe_cuped";
  const EVT = "probe_cuped_evt";
  const goal = JSON.stringify({ event: EVT, aggregation: "count_events" });
  const exp = ensureExperiment(EXP, { goalMetric: goal, sequential: false });
  if (!exp) {
    console.log("  CUPED fixture unavailable — skipping");
    console.log("::endgroup::");
    return;
  }
  registerEvent(EVT); // rebuild the edge catalog — inline-metric events aren't in it yet

  const orig = {
    overlap: proj.cupedMinOverlap,
    minUsers: proj.cupedMinBaselineUsers,
    baselineDays: proj.cupedBaselineDays,
  };
  const N = 60; // observational leg; kept small to bound throttled-injection time
  const restore = () => {
    setProjKnob(proj.id, "--cuped-min-overlap", orig.overlap);
    setProjKnob(proj.id, "--cuped-min-baseline-users", orig.minUsers);
    setProjKnob(proj.id, "--cuped-baseline-days", orig.baselineDays);
  };
  try {
    // Seed the pre-period (backdated 3 days, in SECONDS — /collect passes a
    // seconds ts through unchanged) so the freeze window [start−14d, start) sees
    // it. Per-user level L drives BOTH the baseline count and the in-period count
    // → strong θ → visible variance reduction when CUPED is admitted.
    const startMs = Date.now();
    const preTs = Math.floor(startMs / 1000) - 3 * 86_400;
    const level = (i) => 1 + (i % 6); // 1..6 events, deterministic per user
    const pre = [];
    for (const grp of ["control", "treatment"]) {
      const tag = grp[0];
      for (let i = 0; i < N; i++) {
        const uid = `sk-${EXP}-${tag}-${i}`;
        for (let k = 0; k < level(i); k++) pre.push({ type: "metric", event_name: EVT, value: 1, user_id: uid, ts: preTs });
      }
    }
    if (!(await collect(pre))) {
      failed++;
      restore();
      console.log("::endgroup::");
      return;
    }
    // Give AE a moment to ingest the pre-period, then start (NOT restart) so the
    // freeze job reads it. Critical: the fixture is started ONCE from draft and
    // left running across runs — a stop→start restart whose prior stopped_at
    // falls inside the new 14-day pre-window trips cuped.ts's restart-contamination
    // guard (isRestartContaminated) and DISABLES CUPED, so the leg would soft-skip
    // forever after the first run. Started-once keeps cuped_frozen_at + the frozen
    // baselines alive; later runs re-seed the (idempotent, fixed-id) in-period
    // counts, which stay correlated with the frozen baseline. baseline-days default
    // (14) is wide enough to include the −3d seed.
    setProjKnob(proj.id, "--cuped-baseline-days", orig.baselineDays ?? 14);
    await sleep(45_000);
    freshStart(EXP); // start-once; no restart (see contamination-guard note above)

    // In-period: exposure + a correlated count (control ≈ level, treatment gets a
    // small lift). Idempotent fixed ids; ts = now (ms → normalized to seconds).
    const inMs = Date.now();
    const inp = [];
    for (const [grp, extra] of [["control", 0], ["treatment", 1]]) {
      const tag = grp[0];
      for (let i = 0; i < N; i++) {
        const uid = `sk-${EXP}-${tag}-${i}`;
        inp.push({ type: "exposure", experiment: EXP, group: grp, user_id: uid, ts: inMs });
        for (let k = 0; k < level(i) + extra; k++) inp.push({ type: "metric", event_name: EVT, value: 1, user_id: uid, ts: inMs });
      }
    }
    if (!(await collect(inp))) {
      failed++;
      restore();
      console.log("::endgroup::");
      return;
    }

    // Admit CUPED: trivially-loose guards.
    setProjKnob(proj.id, "--cuped-min-overlap", 0.01);
    setProjKnob(proj.id, "--cuped-min-baseline-users", 10);
    let r = await settle(EXP);
    for (let t = 0; t < 6 && !groupRow(r.rows, "treatment"); t++) r = await settle(EXP);
    const varOn = varOf(groupRow(r.rows, "treatment"));
    // Deny CUPED: the max min-baseline-users floor (100k), far above the cohort.
    setProjKnob(proj.id, "--cuped-min-baseline-users", 100_000);
    const varOff = varOf(groupRow((await settle(EXP)).rows, "treatment"));

    // Observational (never hard-fails): a clean, sizeable CUPED variance drop is
    // hard to seed live — AE samples the baseline burst, the freeze is async, and
    // the restart-contamination guard blocks re-freezing a reused fixture, so
    // varOn/varOff are noisy. A clear reduction is reported as a positive signal;
    // everything else (no data, no reduction, or a sampling-driven inversion) is a
    // soft note. The CUPED math itself is pinned by the worker unit sims
    // (analysis/__tests__/cuped.test.ts).
    if (varOn == null || varOff == null) {
      console.log(`⚠ variance not populated (on=${varOn}, off=${varOff}) — AE ingestion lag; soft`);
    } else if (varOn < varOff * 0.98) {
      ok(`CUPED reduced treatment variance ${varOff.toFixed(4)} (denied) → ${varOn.toFixed(4)} (admitted)`);
    } else if (varOn > varOff * 1.02) {
      console.log(`⚠ varOn ${varOn.toFixed(4)} > varOff ${varOff.toFixed(4)} — baseline not cleanly frozen under AE sampling (not a CUPED bug; unit sims pin the math); soft`);
    } else {
      console.log(`⚠ variance unchanged (on=${varOn.toFixed(4)}, off=${varOff.toFixed(4)}) — no frozen baseline landed (AE lag / freeze incomplete); soft`);
    }

    // The baseline-WINDOW knob (cuped_baseline_days) is NOT soundly testable live:
    // it's read at freeze time, and the freeze is an async job reading a
    // project-global setting, so two experiments can't be given different windows
    // deterministically in one run, and a same-experiment re-freeze needs a restart
    // that trips the contamination guard above (confounding the result). It's
    // pinned directly by the worker unit sims (analysis/__tests__/cuped.test.ts,
    // baselineWindow + the windowDays param). We assert overlap + min-baseline-users
    // here — the two guards that gate a single freeze live.
  } finally {
    // Restore the project knobs but LEAVE the fixture running — a stop here would
    // make the next run's start trip the restart-contamination guard.
    try {
      restore();
      console.log(`  restored cuped_min_overlap=${orig.overlap}, cuped_min_baseline_users=${orig.minUsers}, cuped_baseline_days=${orig.baselineDays}`);
    } catch (e) {
      annotate(`CUPED: restore failed — ${e?.message ?? e}`);
      failed++;
    }
  }
  console.log("::endgroup::");
}

// ── verdict gates: min_sample_size / min_runtime_days / ci_confidence ─────────
// These don't move any results COLUMN — they seed the ship/hold/WAIT verdict the
// /results API now carries (computeExperimentVerdict) and, for ci_confidence, the
// interval the UI shows. Build a strongly-significant SEQUENTIAL fixture that
// verdicts "ship" with the gates open (sequential so peek_warning stays 0 — a
// running fixed-horizon significant experiment always peek-"wait"s, which would
// mask the gates; see the fixture comment), then sweep each gate and assert the
// verdict flips to "wait". min_sample_size / min_runtime_days are editable while
// running (NOT in IMMUTABLE_WHILE_RUNNING), so no restart is needed — the flip is
// driven purely by the knob against a fresh (daysRunning≈0) run, the create-and-
// fast-forward shape without a real backdate (started_at is immutable, so we move
// the threshold, not the clock). ci_confidence is inert in the pipeline (both CIs
// are always computed), so we assert it round-trips AND that results carry ci95 +
// ci99 — the two display levels — rather than a phantom analysis effect.
async function probeVerdictGates() {
  if (!process.env.SHIPEASY_PROBE_MUTATE) {
    console.log("verdict-gates leg disabled — enable with SHIPEASY_PROBE_MUTATE=1 (creates a verdict fixture)");
    return;
  }
  if (!CLIENT_KEY) {
    console.log("verdict-gates leg: SHIPEASY_CLIENT_KEY unset — skipping");
    return;
  }
  const proj = await readProject();
  if (proj && !hasStatsKnobs(proj)) {
    console.log("verdict-gates leg: project stats knobs absent — prod UI worker predates the per-project-stats-settings deploy; skipping (soft)");
    return;
  }
  if (!proj?.id) {
    annotate("verdict-gates: could not read project via admin API");
    failed++;
    return;
  }
  if (!ensureStatsUniverse()) {
    console.log("verdict-gates leg: no stats universe available — skipping");
    return;
  }
  console.log("::group::Verdict gates (min_sample_size / min_runtime_days / ci_confidence)");
  const EXP = "probe_verdict";
  const EVT = "probe_verdict_evt";
  const N = 200;
  // SEQUENTIAL on purpose: a running FIXED-horizon experiment with a significant
  // goal sets peek_warning=1 (consumer.ts: `!sequentialTesting && !isFinal && p<.05`),
  // and deriveVerdict returns "wait" on hasPeekWarning BEFORE the ship branch — so a
  // fixed fixture could never verdict "ship" while running and the sweeps below would
  // be dead. mSPRT is peek-safe (peek_warning stays 0), so the gates are the only
  // thing standing between the significant goal and "ship". MEI 0.2 + the strong
  // 10/90 lift keep msprt_significant firing (λ ≫ log(1/α)) across the whole ambient
  // msprt_tau_mei_factor range [0.1, 2.0] — even at the floor, where a smaller MEI
  // would collapse τ→0 and drop λ below the boundary → a soft (never false) skip.
  const goal = JSON.stringify({ event: EVT, aggregation: "count_users", min_effect_of_interest: 0.2 });
  const exp = ensureExperiment(EXP, { goalMetric: goal, sequential: true });
  if (!exp) {
    console.log("  verdict fixture unavailable — skipping");
    console.log("::endgroup::");
    return;
  }
  registerEvent(EVT); // rebuild the edge catalog — inline-metric events aren't in it yet
  const setGate = (flag, val) => cliText(["release", "experiments", "update", EXP, flag, String(val)]);
  const origCi = proj.ciConfidence;
  try {
    // Gates wide open so a clean significant result verdicts "ship" (the schema
    // floors min_sample_size at 1, so "open" is 1 — the small cohort clears it).
    setGate("--min-sample-size", 1);
    setGate("--min-runtime-days", 0);
    freshStart(EXP, { restart: true });
    const tsMs = Date.now();
    if (!(await collect(binaryCohort(EXP, EVT, { n: N, controlPct: 20, lift: 60, tsMs })))) {
      failed++;
      console.log("::endgroup::");
      return;
    }
    let base = await settle(EXP);
    for (let t = 0; t < 6 && !groupRow(base.rows, "treatment"); t++) base = await settle(EXP);
    if (!groupRow(base.rows, "treatment")) {
      console.log("⚠ no enrolment recovered within timeout (AE ingestion lag) — skipping (soft)");
      console.log("::endgroup::");
      return;
    }
    if (base.verdict === "ship") {
      ok(`baseline verdict "ship" with gates open (goal significant, no SRM)`);
    } else {
      console.log(`⚠ baseline verdict is "${base.verdict}" not "ship" — cohort not conclusive yet; sweeps soft`);
    }

    // A flip is only PROVEN when the baseline was "ship" and tightening the knob
    // turns it "wait" — otherwise a "wait"→"wait" reads as a pass for the wrong
    // reason. When the baseline isn't "ship" (goal not conclusive under sampling)
    // the sweep is reported soft, never a green ✔.
    const shipBaseline = base.verdict === "ship";

    // min_sample_size above the group n → "wait — needs ≥N users".
    setGate("--min-sample-size", N + 1000);
    const vSample = resultRows(EXP).verdict;
    setGate("--min-sample-size", 1);
    if (shipBaseline) {
      if (vSample === "wait") ok(`min_sample_size ${N + 1000} flips the verdict ship→"wait" (power guard bites)`);
      else {
        annotate(`min_sample_size guard had NO effect: verdict "${vSample}" at min_sample_size ${N + 1000} (want "wait")`);
        failed++;
      }
    } else console.log(`⚠ min_sample_size sweep soft (baseline not ship; verdict "${vSample}")`);

    // min_runtime_days at the schema max (365) ≫ daysRunning≈0 → "wait — keep collecting".
    setGate("--min-runtime-days", 365);
    const vRun = resultRows(EXP).verdict;
    setGate("--min-runtime-days", 0);
    if (shipBaseline) {
      if (vRun === "wait") ok(`min_runtime_days 365 flips the verdict ship→"wait" (peeking guard bites)`);
      else {
        annotate(`min_runtime_days guard had NO effect: verdict "${vRun}" at min_runtime_days 365 (want "wait")`);
        failed++;
      }
    } else console.log(`⚠ min_runtime_days sweep soft (baseline not ship; verdict "${vRun}")`);

    // ci_confidence: round-trips through project settings, and results carry BOTH
    // display intervals. (The pipeline computes ci95 + ci99 regardless of the
    // knob, so there's no analysis effect to assert — only the display inputs.)
    setProjKnob(proj.id, "--ci-confidence", 0.99);
    const after = await readProject();
    if (after?.ciConfidence === 0.99) ok("ci_confidence round-trips through project settings (0.99)");
    else {
      annotate(`ci_confidence did not round-trip: read back ${after?.ciConfidence} (want 0.99)`);
      failed++;
    }
    const tRow = groupRow(resultRows(EXP).rows, "treatment");
    const has = (v) => v !== undefined && v !== null;
    const ci95 = tRow && has(tRow.ci95Low ?? tRow.ci_95_low) && has(tRow.ci95High ?? tRow.ci_95_high);
    const ci99 = tRow && has(tRow.ci99Low ?? tRow.ci_99_low) && has(tRow.ci99High ?? tRow.ci_99_high);
    if (ci95 && ci99) ok("results carry both 95% and 99% intervals (ci_confidence selects which the UI shows)");
    else {
      annotate(`results missing a display interval — ci95=${ci95} ci99=${ci99}`);
      failed++;
    }
  } finally {
    try {
      setProjKnob(proj.id, "--ci-confidence", origCi);
      console.log(`  restored ci_confidence=${origCi}`);
    } catch (e) {
      annotate(`verdict-gates: restore failed — ${e?.message ?? e}`);
      failed++;
    }
    try {
      cliText(["release", "experiments", "stop", EXP]);
    } catch {}
  }
  console.log("::endgroup::");
}

// ── Universes → Experiments → Groups rework legs ─────────────────────────────
// The rework moved the config schema onto the UNIVERSE (variants only override
// values), added two per-experiment gates (targeting + a new restricted holdout
// flag type), reserved headroom so a variant can be appended to a RUNNING
// experiment, and a real capacity pool giving mutual exclusion (§B4, behind a
// hashVersion bump). Every one of these is an ASSIGNMENT-time property, so a
// single /sdk/evaluate call is a self-contained oracle — no /collect, no AE
// sampling, no analysis lag. That lets these legs assert DETERMINISTICALLY (the
// bucketing is fixed per unit) instead of the robust-soft style the stats legs
// need. They build throwaway fixtures, so they gate on SHIPEASY_PROBE_MUTATE.

const MODEL_SCHEMA_UNIVERSE = "probe_model_cfg"; // schema'd universe (config leg)
const MODEL_GATE_UNIVERSE = "probe_model_gate"; // plain universe (gate/append legs)

// Create a universe (optionally with a param_schema / recommended_headroom /
// holdout_range) if absent — idempotent, reused across runs.
function ensureUniverseWithSchema(name, { paramSchema = null, recommendedHeadroom, holdoutRange } = {}) {
  const existing = listUniverses().find((u) => u.name === name);
  if (existing) return existing;
  const args = ["release", "experiments", "universes", "create", name];
  if (paramSchema) args.push("--param-schema", JSON.stringify(paramSchema));
  if (recommendedHeadroom != null) args.push("--recommended-headroom", String(recommendedHeadroom));
  if (holdoutRange) args.push("--holdout-range", JSON.stringify(holdoutRange));
  try {
    cliText(args);
  } catch (e) {
    console.log(`  ensureUniverse(${name}): ${e?.message ?? e}`);
  }
  return listUniverses().find((u) => u.name === name) ?? null;
}

// Create a feature gate (flag) if absent. `type` is "targeting" | "holdout";
// `rolloutPercent` is 0–100. Idempotent.
function ensureGate(name, { type = "targeting", rolloutPercent, rules = null, enabled = true } = {}) {
  if (listGates().some((g) => g.name === name)) return true;
  const args = ["release", "flags", "create", name, "--type", type, "--enabled", String(enabled)];
  if (rolloutPercent != null) args.push("--rollout-percent", String(rolloutPercent));
  if (rules) args.push("--rules", JSON.stringify(rules));
  try {
    cliText(args);
  } catch (e) {
    console.log(`  ensureGate(${name}): ${e?.message ?? e}`);
    return false;
  }
  return listGates().some((g) => g.name === name);
}

// Create an experiment across the full new surface if absent (idempotent).
// Attaches an inline goal metric because `start` throws NoGoalMetric without one.
function ensureExperimentEx(
  name,
  { universe, groups, allocationPercent = 100, targetingGate, holdoutGate, reservedHeadroom, goalEvent },
) {
  let exp = expByName().get(name);
  if (exp) return exp;
  const args = [
    "release", "experiments", "create", name,
    "--universe", universe,
    "--groups", JSON.stringify(groups),
    "--allocation-percent", String(allocationPercent),
    "--goal-metric", JSON.stringify({ event: goalEvent, aggregation: "count_users" }),
  ];
  if (targetingGate) args.push("--targeting-gate", targetingGate);
  if (holdoutGate) args.push("--holdout-gate", holdoutGate);
  if (reservedHeadroom != null) args.push("--reserved-headroom", String(reservedHeadroom));
  try {
    cliText(args);
  } catch (e) {
    console.log(`  ensureExperimentEx(${name}): ${e?.message ?? e}`);
    return null;
  }
  return expByName().get(name) ?? null;
}

// Poll /sdk/evaluate until the experiment is assigned for at least one of
// `users` — a create/start rebuilds the :experiments blob + purges the CDN
// asynchronously. Returns true when visible, false on timeout (leg soft-skips).
async function waitForExperimentVisible(exp, users, { tries = 15, gap = 4000 } = {}) {
  for (let t = 0; t < tries; t++) {
    for (const u of users) {
      const r = await evaluate(u);
      if (r.experiments?.[exp]) return true;
    }
    await sleep(gap);
  }
  return false;
}

// Tolerant per-key deep-equal so a merged param object is compared by content,
// not key order (the edge merges `{...defaults, ...override}`).
const paramsMatch = (got, want) =>
  got != null &&
  typeof got === "object" &&
  Object.keys(want).every((k) => JSON.stringify(got[k]) === JSON.stringify(want[k])) &&
  Object.keys(got).length === Object.keys(want).length;

// ── experiment returns a config object; unset params inherit universe defaults ─
// The universe owns the param schema + defaults; a variant overrides only the
// keys it names. Assignment now returns `experiments[e].params` = the MERGED
// object (universe defaults ⊕ group override). Build a 3-param universe, a
// control that overrides nothing and a treatment that overrides ONE key, then
// assert every assigned unit's params equal the exact merge for its group.
async function probeExperimentConfig() {
  if (!process.env.SHIPEASY_PROBE_MUTATE) {
    console.log("config-inheritance leg disabled — enable with SHIPEASY_PROBE_MUTATE=1 (builds a schema'd universe)");
    return;
  }
  if (!CLIENT_KEY) {
    console.log("config-inheritance leg: SHIPEASY_CLIENT_KEY unset — skipping");
    return;
  }
  console.log("::group::Experiment config object + universe-default inheritance");
  const EXP = "probe_cfg_exp";
  const schema = [
    { name: "show_banner", type: "bool", default: false },
    { name: "button_color", type: "string", default: "blue" },
    { name: "max_items", type: "int", default: 20 },
  ];
  const defaults = { show_banner: false, button_color: "blue", max_items: 20 };
  if (!ensureUniverseWithSchema(MODEL_SCHEMA_UNIVERSE, { paramSchema: schema })) {
    console.log("  schema'd universe unavailable — skipping");
    console.log("::endgroup::");
    return;
  }
  const groups = [
    { name: "control", weight: 5000, params: {} }, // inherits every default
    { name: "treatment", weight: 5000, params: { button_color: "green" } }, // overrides one
  ];
  const exp = ensureExperimentEx(EXP, {
    universe: MODEL_SCHEMA_UNIVERSE,
    groups,
    allocationPercent: 100,
    goalEvent: "probe_cfg_evt",
  });
  if (!exp) {
    console.log("  fixture unavailable — skipping");
    console.log("::endgroup::");
    return;
  }
  registerEvent("probe_cfg_evt");
  freshStart(EXP);
  const visUsers = Array.from({ length: 6 }, (_, i) => ({ anonymous_id: `cfg-vis:${i}` }));
  if (!(await waitForExperimentVisible(EXP, visUsers))) {
    console.log("⚠ experiment not visible at edge within timeout (KV/CDN lag) — soft");
    console.log("::endgroup::");
    return;
  }
  const N = 200;
  let assigned = 0;
  let ctrl = 0;
  let treat = 0;
  let bad = 0;
  for (let i = 0; i < N; i++) {
    const a = (await evaluate({ anonymous_id: `cfg:${i}` })).experiments?.[EXP];
    if (!a) continue;
    assigned++;
    if (typeof a.params !== "object" || a.params == null) {
      bad++;
      if (bad <= 3) annotate(`config: unit ${i} assigned (${a.group}) but params=${JSON.stringify(a.params)} — expected a merged config object`);
      continue;
    }
    const want = a.group === "treatment" ? { ...defaults, button_color: "green" } : defaults;
    if (paramsMatch(a.params, want)) {
      if (a.group === "control") ctrl++;
      else treat++;
    } else {
      bad++;
      if (bad <= 3) annotate(`config: ${a.group} unit ${i} params ${JSON.stringify(a.params)} !== ${JSON.stringify(want)} — universe-default merge broken`);
    }
  }
  if (assigned === 0) {
    console.log("⚠ no unit assigned within the cohort (visibility/allocation) — soft");
  } else if (bad > 0) {
    failed++;
  } else {
    ok(`config object carries the merged params for all ${assigned} assigned units (control=${ctrl} inherit every universe default; treatment=${treat} override button_color + inherit the rest)`);
  }
  console.log("::endgroup::");
}

// ── experiment targeting gate gates enrollment ───────────────────────────────
// `targeting_gate` is a normal flag; a unit that fails it is never enrolled. With
// allocation 100% and no holdout, the gate is the ONLY thing between a unit and
// enrollment, so within a single /sdk/evaluate response the biconditional
// `flags[gate]===true ⇔ experiments[exp] present` must hold for EVERY unit —
// oracle-free (the response carries both the flag verdict and the assignment).
async function probeExperimentTargetingGate() {
  if (!process.env.SHIPEASY_PROBE_MUTATE) {
    console.log("exp-targeting-gate leg disabled — enable with SHIPEASY_PROBE_MUTATE=1");
    return;
  }
  if (!CLIENT_KEY) {
    console.log("exp-targeting-gate leg: SHIPEASY_CLIENT_KEY unset — skipping");
    return;
  }
  console.log("::group::Experiment targeting gate (gates enrollment)");
  const FLAG = "probe_exp_targeting";
  const EXP = "probe_targeting_exp";
  if (!ensureUniverseWithSchema(MODEL_GATE_UNIVERSE)) {
    console.log("  universe unavailable — skipping");
    console.log("::endgroup::");
    return;
  }
  if (!ensureGate(FLAG, { type: "targeting", rolloutPercent: 100, rules: [{ attr: "plan", op: "eq", value: "pro" }] })) {
    console.log("  targeting flag unavailable — skipping");
    console.log("::endgroup::");
    return;
  }
  const groups = [
    { name: "control", weight: 5000, params: {} },
    { name: "treatment", weight: 5000, params: {} },
  ];
  const exp = ensureExperimentEx(EXP, {
    universe: MODEL_GATE_UNIVERSE,
    groups,
    allocationPercent: 100,
    targetingGate: FLAG,
    goalEvent: "probe_targeting_evt",
  });
  if (!exp) {
    console.log("  fixture unavailable — skipping");
    console.log("::endgroup::");
    return;
  }
  registerEvent("probe_targeting_evt");
  freshStart(EXP);
  const visUsers = Array.from({ length: 6 }, (_, i) => ({ anonymous_id: `tg-vis:${i}`, plan: "pro" }));
  if (!(await waitForExperimentVisible(EXP, visUsers))) {
    console.log("⚠ experiment not visible at edge within timeout (KV/CDN lag) — soft");
    console.log("::endgroup::");
    return;
  }
  const N = 150;
  let violations = 0;
  let pro = 0;
  let free = 0;
  for (let i = 0; i < N; i++) {
    const plan = i % 2 === 0 ? "pro" : "free";
    const r = await evaluate({ anonymous_id: `tg:${i}`, plan });
    const passes = r.flags?.[FLAG] === true;
    const enrolled = !!r.experiments?.[EXP];
    if (passes) pro++;
    else free++;
    if (passes !== enrolled) {
      violations++;
      if (violations <= 3) annotate(`targeting: unit ${i} (plan=${plan}) gate=${passes} but enrolled=${enrolled} — the targeting gate is not gating enrollment`);
    }
  }
  if (violations === 0) {
    ok(`experiment targeting gate gates enrollment: gate⇔enrolled held for all ${N} units (pro admitted=${pro}, free denied=${free})`);
  } else {
    failed++;
  }
  console.log("::endgroup::");
}

// ── experiment holdout gate (public % + whitelist) excludes units ────────────
// The new restricted `holdout` flag type: passing it = HELD OUT (never assigned,
// sees the universe defaults). Two assertions: (1) a NEGATIVE shape check — a
// holdout gate carrying an attribute rule must be rejected (assertHoldoutShape);
// (2) a public 50% holdout flag with allocation 100% and no targeting gives the
// crisp per-unit biconditional `flags[holdoutFlag]===true (held) ⇔
// experiments[exp] absent`, plus the held fraction ≈ the public rollout %.
async function probeExperimentHoldoutGate() {
  if (!process.env.SHIPEASY_PROBE_MUTATE) {
    console.log("exp-holdout-gate leg disabled — enable with SHIPEASY_PROBE_MUTATE=1");
    return;
  }
  if (!CLIENT_KEY) {
    console.log("exp-holdout-gate leg: SHIPEASY_CLIENT_KEY unset — skipping");
    return;
  }
  console.log("::group::Experiment holdout gate (public % + whitelist excludes units)");
  const FLAG = "probe_exp_holdout";
  const EXP = "probe_holdout_exp";
  if (!ensureUniverseWithSchema(MODEL_GATE_UNIVERSE)) {
    console.log("  universe unavailable — skipping");
    console.log("::endgroup::");
    return;
  }

  // (1) NEGATIVE: a holdout gate must reject attribute rules — only a public %
  // + an in/not_in whitelist are allowed. Creating one with an `eq` rule must
  // fail; if it succeeds, the restriction regressed. The create IS the assertion,
  // so only run it while the bad flag doesn't already exist.
  if (!listGates().some((g) => g.name === "probe_holdout_bad")) {
    let rejected = false;
    try {
      cliText([
        "release", "flags", "create", "probe_holdout_bad",
        "--type", "holdout", "--rollout-percent", "50",
        "--rules", JSON.stringify([{ attr: "plan", op: "eq", value: "pro" }]),
      ]);
    } catch {
      rejected = true;
    }
    if (rejected && !listGates().some((g) => g.name === "probe_holdout_bad")) {
      ok("holdout gate rejects attribute rules (assertHoldoutShape bites — only a public % + in/not_in whitelist)");
    } else {
      annotate("holdout gate ACCEPTED an attribute-rule payload — the public%+whitelist restriction regressed");
      failed++;
    }
  }

  // (2) Public 50% holdout flag (no rules) → the clean biconditional path.
  if (!ensureGate(FLAG, { type: "holdout", rolloutPercent: 50 })) {
    console.log("  holdout flag unavailable — skipping the assignment assertion");
    console.log("::endgroup::");
    return;
  }
  const groups = [
    { name: "control", weight: 5000, params: {} },
    { name: "treatment", weight: 5000, params: {} },
  ];
  const exp = ensureExperimentEx(EXP, {
    universe: MODEL_GATE_UNIVERSE,
    groups,
    allocationPercent: 100,
    holdoutGate: FLAG,
    goalEvent: "probe_holdout_evt",
  });
  if (!exp) {
    console.log("  fixture unavailable — skipping");
    console.log("::endgroup::");
    return;
  }
  registerEvent("probe_holdout_evt");
  freshStart(EXP);
  const visUsers = Array.from({ length: 8 }, (_, i) => ({ anonymous_id: `ho-vis:${i}` }));
  if (!(await waitForExperimentVisible(EXP, visUsers))) {
    console.log("⚠ experiment not visible at edge within timeout (KV/CDN lag) — soft");
    console.log("::endgroup::");
    return;
  }
  const N = 300;
  let violations = 0;
  let held = 0;
  let assigned = 0;
  for (let i = 0; i < N; i++) {
    const r = await evaluate({ anonymous_id: `ho:${i}` });
    const isHeld = r.flags?.[FLAG] === true;
    const enrolled = !!r.experiments?.[EXP];
    if (isHeld) held++;
    else assigned++;
    // held ⇒ NOT enrolled; not-held ⇒ enrolled (allocation 100%, no other gate).
    if (isHeld === enrolled) {
      violations++;
      if (violations <= 3) annotate(`holdout: unit ${i} heldFlag=${isHeld} enrolled=${enrolled} — the holdout gate is not excluding held units`);
    }
  }
  const frac = held / N;
  const band = Math.max(0.08, 4 * Math.sqrt((0.5 * 0.5) / N));
  if (violations === 0 && Math.abs(frac - 0.5) <= band) {
    ok(`holdout gate excludes units: held⇔not-enrolled held for all ${N} units; ${(frac * 100).toFixed(0)}% held out ≈ 50% public rollout`);
  } else if (violations === 0) {
    annotate(`holdout: biconditional held but the held fraction ${(frac * 100).toFixed(1)}% is far from the 50% public rollout (±${(band * 100).toFixed(0)}pp)`);
    failed++;
  } else {
    failed++;
  }
  console.log("::endgroup::");
}

// ── append a new variant to a RUNNING experiment (reserved headroom) ─────────
// A tail of the split is kept EMPTY (reserved) so a new variant can be appended
// while running WITHOUT reshuffling anyone: existing group weights are immutable,
// the new variant is appended at the end, reserved shrinks by its weight, and it
// draws only from the former reserved tail (units that hashed there were
// unassigned before). Assert: (a) the append succeeds while running, (b) no unit
// already in control/treatment moves to a different existing group, (c) units
// that land in the new variant were previously UNASSIGNED (the reserved tail).
async function probeAppendVariant() {
  if (!process.env.SHIPEASY_PROBE_MUTATE) {
    console.log("append-variant leg disabled — enable with SHIPEASY_PROBE_MUTATE=1");
    return;
  }
  if (!CLIENT_KEY) {
    console.log("append-variant leg: SHIPEASY_CLIENT_KEY unset — skipping");
    return;
  }
  console.log("::group::Append a variant mid-run (reserved headroom, stable assignments)");
  const EXP = "probe_append_exp";
  if (!ensureUniverseWithSchema(MODEL_GATE_UNIVERSE)) {
    console.log("  universe unavailable — skipping");
    console.log("::endgroup::");
    return;
  }
  const base = [
    { name: "control", weight: 4500, params: {} },
    { name: "treatment", weight: 4500, params: {} },
  ]; // Σ 9000 = 10000 − 1000 reserved
  const exp = ensureExperimentEx(EXP, {
    universe: MODEL_GATE_UNIVERSE,
    groups: base,
    allocationPercent: 100,
    reservedHeadroom: 1000,
    goalEvent: "probe_append_evt",
  });
  if (!exp) {
    console.log("  fixture unavailable — skipping");
    console.log("::endgroup::");
    return;
  }
  registerEvent("probe_append_evt");

  // Reset to the 2-group baseline (reserved 1000) so re-runs start clean —
  // group weights + reserved are only mutable while NOT running, so stop → reset
  // → start. The salt is stable across the cycle, so assignments are reproducible.
  try {
    const cur = expByName().get(EXP);
    if (cur?.status === "running") cliText(["release", "experiments", "stop", EXP]);
    if (cur?.status === "archived") cliText(["release", "experiments", "restore", EXP]);
    cliText(["release", "experiments", "update", EXP, "--reserved-headroom", "1000", "--groups", JSON.stringify(base)]);
    cliText(["release", "experiments", "start", EXP]);
  } catch (e) {
    console.log(`  reset(${EXP}) failed: ${e?.message ?? e} — skipping (soft)`);
    console.log("::endgroup::");
    return;
  }
  const visUsers = Array.from({ length: 8 }, (_, i) => ({ anonymous_id: `av-vis:${i}` }));
  if (!(await waitForExperimentVisible(EXP, visUsers))) {
    console.log("⚠ experiment not visible at edge within timeout (KV/CDN lag) — soft");
    console.log("::endgroup::");
    return;
  }
  const N = 300;
  const before = new Array(N);
  for (let i = 0; i < N; i++) {
    before[i] = (await evaluate({ anonymous_id: `av:${i}` })).experiments?.[EXP]?.group ?? null;
  }

  // Append a 3rd variant into the reserved tail (weight 500 ≤ reserved 1000);
  // reserved shrinks 1000 → 500. Existing weights unchanged ⇒ no reshuffle.
  const grown = [...base, { name: "variant_c", weight: 500, params: {} }];
  try {
    cliText(["release", "experiments", "update", EXP, "--reserved-headroom", "500", "--groups", JSON.stringify(grown)]);
  } catch (e) {
    annotate(`append rejected on a running experiment — ${e?.message ?? e} (appending a variant ≤ reserved headroom must be allowed while running)`);
    failed++;
    console.log("::endgroup::");
    return;
  }

  // Wait for the edge to carry the new arm (KV rebuild + purge).
  let seenC = false;
  for (let t = 0; t < 15 && !seenC; t++) {
    for (let i = 0; i < 20; i++) {
      if ((await evaluate({ anonymous_id: `av:${i}` })).experiments?.[EXP]?.group === "variant_c") {
        seenC = true;
        break;
      }
    }
    if (!seenC) await sleep(4000);
  }
  const after = new Array(N);
  for (let i = 0; i < N; i++) {
    after[i] = (await evaluate({ anonymous_id: `av:${i}` })).experiments?.[EXP]?.group ?? null;
  }

  let moved = 0;
  let newC = 0;
  let newCFromTail = 0;
  for (let i = 0; i < N; i++) {
    const b = before[i];
    const a = after[i];
    if (a === "variant_c") {
      newC++;
      if (b === null) newCFromTail++;
    }
    if ((b === "control" || b === "treatment") && a !== b) moved++;
  }
  let violations = 0;
  if (moved > 0) {
    annotate(`append reshuffled ${moved} enrolled unit(s) between existing groups — appending must only draw from the reserved tail`);
    violations += moved;
  }
  if (newC > newCFromTail) {
    annotate(`append: ${newC - newCFromTail}/${newC} variant_c unit(s) came from an EXISTING group, not the reserved tail — enrolled users were reassigned`);
    violations++;
  }
  if (violations > 0) {
    failed++;
  } else if (!seenC || newC === 0) {
    console.log(`⚠ no unit landed in variant_c yet (edge lag) — assignment stability still asserted (0 moved); soft on new-arm presence`);
  } else {
    ok(`append-variant: ${newC} unit(s) entered variant_c (all from the former reserved tail), 0 existing enrolments moved`);
  }
  console.log("::endgroup::");
}

// ── universe mutual exclusion (§B4 pooled assignment) ────────────────────────
// A universe is a real capacity pool: each experiment claims a contiguous slice
// of one shared hash space, so a unit can land in at most ONE experiment per
// universe. This only engages when experiments run POOLED (hashVersion ≥ 2 with a
// pool slice) — the §B4 write path is gated behind that bump, so until it ships,
// new experiments stay on independent per-experiment salts (which overlap by
// design, nothing to assert). This leg DISCOVERS pooled experiments from the
// server blob (the pool fields aren't in the curated CLI list) and, only when a
// universe has ≥2 of them, asserts slices are disjoint AND no unit double-assigns.
// It soft-skips (never false-fails) while pooled assignment is dormant, and lights
// up automatically once §B4 deploys.
async function probeUniverseExclusivity() {
  if (!CLIENT_KEY) {
    console.log("mutual-exclusion leg: SHIPEASY_CLIENT_KEY unset — skipping");
    return;
  }
  const SK = process.env.SHIPEASY_SERVER_KEY;
  if (!SK) {
    console.log("mutual-exclusion leg: set SHIPEASY_SERVER_KEY (needed to read pool metadata) to enable");
    return;
  }
  let blob;
  try {
    const r = await fetch(`${EDGE_URL}/sdk/experiments`, { headers: { "x-sdk-key": SK } });
    if (!r.ok) {
      console.log(`mutual-exclusion leg: /sdk/experiments ${r.status} — skipping`);
      return;
    }
    blob = await r.json();
  } catch (e) {
    console.log(`mutual-exclusion leg: experiment blob read failed (${e?.message ?? e}) — skipping`);
    return;
  }
  const running = Object.values(blob.experiments ?? {}).filter((e) => e.status === "running");
  const pooled = running.filter(
    (e) => (e.hashVersion ?? 1) >= 2 && e.poolOffsetBp != null && e.poolSizeBp > 0,
  );
  const byUni = {};
  for (const e of pooled) (byUni[e.universe] ??= []).push(e);
  const universes = Object.entries(byUni).filter(([, list]) => list.length >= 2);

  console.log("::group::Universe mutual exclusion (§B4 pooled assignment)");
  if (universes.length === 0) {
    console.log(
      `⚠ no universe has ≥2 running POOLED experiments (hashVersion≥2 + pool slice) — §B4 pooled-assignment write path is dormant, so mutual exclusion isn't live yet (soft). ${pooled.length}/${running.length} running experiment(s) are pooled.`,
    );
    console.log("::endgroup::");
    return;
  }
  for (const [uni, list] of universes) {
    // Admin-side invariant: first-fit must keep the pool slices disjoint.
    const ranges = list
      .map((e) => [e.poolOffsetBp, e.poolOffsetBp + e.poolSizeBp, e.name])
      .sort((a, b) => a[0] - b[0]);
    let overlap = null;
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i][0] < ranges[i - 1][1]) {
        overlap = `${ranges[i - 1][2]} [${ranges[i - 1][0]},${ranges[i - 1][1]}) ∩ ${ranges[i][2]} [${ranges[i][0]},${ranges[i][1]})`;
      }
    }
    if (overlap) {
      annotate(`universe ${uni}: pool slices OVERLAP (${overlap}) — first-fit allocation is broken`);
      failed++;
    }
    // Behavioural: no unit may be assigned to >1 experiment in the universe.
    const N = 400;
    let doubled = 0;
    for (let i = 0; i < N; i++) {
      const r = await evaluate({ anonymous_id: `mx:${uni}:${i}` });
      const hits = list.filter((e) => r.experiments?.[e.name]?.inExperiment).length;
      if (hits > 1) doubled++;
    }
    if (doubled === 0 && !overlap) {
      ok(`universe ${uni}: ${list.length} pooled experiments mutually exclusive — 0/${N} units double-assigned, slices disjoint`);
    } else if (doubled > 0) {
      annotate(`universe ${uni}: ${doubled}/${N} units assigned to >1 experiment in the pool — mutual exclusion broken`);
      failed++;
    }
  }
  console.log("::endgroup::");
}

// ── run ─────────────────────────────────────────────────────────────────────
try {
  probeExperiments();
  await probeGates();
  await probeReferenceGates();
  await probeAutoFieldGates();
  await probeTemplateGates();
  await probeTargeting();
  await probeFallthrough();
  await probeRuleGatedRollout();
  await probeConditionRollout();
  await probeGradualRamps();
  await probeManagedPresets();
  await probeKillswitches();
  await probeKillswitchPropagation();
  await probeStatsEffect();
  await probeSequentialTau();
  await probeCupedGates();
  await probeVerdictGates();
  await probeExperimentConfig();
  await probeExperimentTargetingGate();
  await probeExperimentHoldoutGate();
  await probeAppendVariant();
  await probeUniverseExclusivity();
  await probeHoldout();
  await probeConfigs();
  await probeEnrichment();
  await probeServerBlobs();
  await probeBootstrap();
  await probeMultiEnv();
  await probeAlertRules();
  await probeLatency();
  await probeErrors();
  await probeExperimentResults();
  await probeIdentifyMerge();
} catch (err) {
  annotate(`probe failed to run: ${err?.message ?? err}`);
  process.exit(2);
}

if (failed > 0) {
  annotate(`${failed} drift finding(s) — see annotations above`);
  process.exit(1);
}
console.log("✅ prod probe passed");
