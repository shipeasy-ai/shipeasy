# Migration conventions (shared target model)

Read this first, then the platform reference for your source. This file is the
**Shipeasy side** of every migration — the target model, the resource-type
decision, the operator vocabulary, the plan-file + resume rules, and the
interactive execute sequence. The platform files carry only the source-specific
half (how to read the source, and how its operators map onto the table below).

Shipeasy CRUD runs through the `release_flags_*` / `release_configs_*` /
`release_experiments_*` / `release_killswitch_*` / `release_experiments_universes_*`
MCP tools (or the `shipeasy release …` CLI). **Read exact parameter shapes from
the tool schema / `--help`** — the shapes below are the mapping intent, not a
frozen payload. The destructive verb is **archive**, never delete.

---

## Migration overview banner (display at the start of every `plan` run)

```
═══════════════════════════════════════════════════════════════
  <Platform> → Shipeasy migration
═══════════════════════════════════════════════════════════════

  Two independent phases: definitions first, then code.

  PHASE 1 — Definitions   (plan flags → execute)
    Recreate every gate / config / experiment in Shipeasy with its
    targeting rules, rollout %, variants, and holdouts.
    Result: the resources exist in Shipeasy.

  PHASE 2 — Code          (plan code → execute)
    Repoint the code that reads them onto @shipeasy/sdk — one flag per
    PR. Result: the app reads Shipeasy; the old SDK is removed.

  Why flags first?  Code can't resolve a flag that isn't in Shipeasy yet.
  Why one PR per flag?  Small, reviewable, independently shippable.
═══════════════════════════════════════════════════════════════
```

Then say which phase this run enters. For `plan code`, remind the user Phase 1
must be complete — the resources must exist in Shipeasy before code can resolve
them.

---

## The project (where flags live)

Shipeasy has no "client" object to choose — a **project** is the unit, bound
once via `.shipeasy` and confirmed with `projects_current`. Everything you
create lands in the bound project. If `projects_current` fails, the project
isn't set up: stop and route the user to `shipeasy setup` (or `shipeasy-setup`).
There is no per-flag "add to client" step — creating the resource is enough.

**Unit of randomization.** The source's per-user / per-group bucketing identity
maps to Shipeasy's unit. For gates/configs the SDK buckets on
`user_id ?? anonymous_id` by default; a per-group source flag (bucket on
company/account) maps to a gate `stack` entry's `bucketBy`, or an experiment's
`bucket_by` / universe `unit_type`. Record the source's unit per resource and
carry it across; you do **not** stand up an "entity schema" first (Shipeasy
targets on plain attributes — see below).

---

## Pick the Shipeasy resource type

Every source flag becomes exactly one of these. Decide per source resource:

| Source shape | Shipeasy resource | Why |
|---|---|---|
| Boolean on/off, with optional targeting + % rollout | **gate** (`release_flags_create`) | Native boolean + rollout + rules |
| Boolean with an **ordered waterfall** of audience rules, each with its own pass % | **gate** with a `stack` | The gatekeeper stack is an ordered, first-match-wins waterfall (see below) |
| A structured/typed value that is the **same for everyone** (or per-env) | **config** (`release_configs_create`) | Config is one typed value + JSON schema |
| A/B/n **test** — randomized assignment to weighted variants that carry params | **experiment** (`release_experiments_create`) | Groups carry `params`; the universe owns holdouts/mutual-exclusion |
| A structured value that varies by **deterministic audience** (not a randomized test) | **gate(s) + config**, or flag for review | Shipeasy configs don't hold per-audience variants; see "Targeted configs" |
| A separate always-on safety toggle to kill a path | **kill switch** (`release_killswitch_create`) | First-class off-switch, optional per-site `switches` map |

Route read-only asks ("what do we have") to the `*_list` tools; never create to
answer a question. **Always `*_list` before you create** and reuse/update a
match instead of duplicating.

### Gates: flat rules vs the stack

- **Simple gate** — one set of ANDed conditions + a single rollout. Use flat
  `rules: [{ attr, op, value }]` (all ANDed) plus `rollout_percent` (0–100).
- **Waterfall gate** — the source has an *ordered* list of rules where the first
  match wins and each rule has its own pass %. Use the gate **`stack`**: an
  ordered array of entries evaluated top-down, first hit wins:
  - `condition` entry: `{ pass: "all" | "any", rules: [...], rolloutPct, bucketBy? }`
    — its `rules` matched (all, or any) AND the caller falls in `rolloutPct`
    (basis points, 0–10000) → the gate returns true and evaluation stops.
    `pass: "any"` gives OR **within** one entry.
  - `rollout` entry: `{ rolloutPct, bucketBy? }` — a rule-less "everyone at N%"
    step; use it for a source "Public"/"Everyone" default rule at the bottom.
  Emit **one entry per source rule, in source order.** Fold each source rule's
  pass/fail percentage into that entry's `rolloutPct` (a rule that passes 25% of
  matched users → `rolloutPct: 2500`). A matched-but-failed caller does **not**
  fall through in a first-match-wins source, and the stack matches that: a
  matched entry that loses its rollout bucket returns false for that caller
  without trying lower entries only if it *matched*; if it didn't match, the
  next entry is tried. (Confirm the exact `stack` field shape from the
  `release_flags_create` schema.)

### Experiments carry the variant values

For a multivariant test, the group **params** carry the per-variant values —
`groups: [{ name, weight, params }]`, weights in basis points summing to
**10000**. `allocation_percent` (0–100) is the fraction of eligible units that
enter the test at all; the rest stay out (control at the call site). Restrict
eligibility with `targeting_gate: "<gate>"` (a separate gate), not by stuffing
conditions into the groups. Universe (`universe`, default `"default"`) owns
holdouts + mutual exclusion — see "Holdouts".

### Targeted configs (deterministic value-by-audience)

Shipeasy configs hold **one** value (optionally per-env), not a per-audience
waterfall of values. If a source "dynamic config" returns *different structured
values to different audiences* deterministically (not as a randomized test):

- If it's really a **test** → model it as an **experiment** (groups = the
  values).
- If it's deterministic targeting → create the **config** with the
  default/"no-match" value, and gate the alternate value(s) behind **feature
  gate(s)**: the call site reads the gate and picks which config (or which
  branch) applies. Record this decomposition in the plan and flag it for the
  user — it is the one shape that isn't a 1:1 resource.

---

## Targeting: attributes + operators

Shipeasy targets on **plain attributes** on the evaluation context — there is no
entity/context-schema to provision first. Rules are `{ attr, op, value }`;
a resource's flat `rules[]` are **ANDed**; OR within one attribute is a single
`in` with a list; cross-attribute OR needs a `stack` `condition` with
`pass: "any"`.

**Built-in, request-derived attributes** (auto-enriched — no need to pass them):
`country`, `continent`, `is_eu`, `region`, `city`, `timezone`, `user_agent`,
`browser` (`chrome`/`firefox`/`safari`/`edge`/`opera`/`other`), `os`
(`windows`/`macos`/`linux`/`android`/`ios`/`other`), `device`
(`mobile`/`tablet`/`desktop`), `referrer`, `locale`. Anything else (`plan`,
`email`, `app_version`, `account_age`, custom fields) is a **custom attribute**
the app supplies in the SDK call context — record which custom attributes the
migrated rules need so Phase 2 wires them into the SDK context.

### Operator vocabulary (the mapping target)

Every source operator maps to one of these 16. Each platform file translates
its own operators into this set; this is the canonical target.

| Shipeasy `op` | Meaning | `value` |
|---|---|---|
| `eq` / `neq` | equals / not-equals | scalar |
| `in` / `not_in` | is / isn't one of | array of scalars |
| `gt` / `gte` / `lt` / `lte` | numeric compare | number |
| `semver_gt` / `semver_gte` / `semver_lt` / `semver_lte` | dotted-version compare (`"1.2.3"`; pre-release after `-` stripped) | version string |
| `contains` | substring (string) or membership (list attr) | scalar |
| `regex` | JS-flavour regex test | pattern string |
| `gate_pass` | caller passes another gate | that gate's name |
| `exp_in` | caller is in an experiment variant | group name, `"$holdout"`, or `"$any"` (with `attr` = experiment name) |

**Shipeasy has native `contains` and `regex`** — the general string matches
that Confidence-style migrations mark BLOCKED usually translate directly here.
`not_in` and `neq` give native negation (no wrapper needed). `gate_pass` lets a
source "passes gate X" condition reference the migrated gate X directly instead
of inlining its rules. `exp_in` covers "in experiment group" conditions.

**Genuinely un-mappable** (mark BLOCKED in the plan, surface for manual review):
arbitrary code/JS conditions, analysis-only/ML audiences with no rule
definition, and reusable "segment" objects whose backing is an uploaded ID list
too large to inline (small ID lists → `in`/`not_in` on the unit attribute;
large ones → BLOCKED unless the app can send a membership attribute).

**Case sensitivity.** Shipeasy string compares are case-sensitive. If the source
matched case-insensitively, note in the plan that the SDK context value must be
normalized (e.g. lowercased) to match, or use `regex` with a case-insensitive
pattern.

---

## Naming

Shipeasy resource names are stable keys. Keep the source key where it's already
clean; otherwise normalize and **record the old→new mapping in the plan** so the
code phase can find the right call sites. Prefer preserving the source key
verbatim when valid — it keeps Phase 2's find/replace unambiguous.

---

## User-facing communication rules

- **Never expose internal detail.** Don't show raw rule payloads, `op` names, or
  JSON in chat. Say "country is US or CA", "app version ≥ 1.2.0", "plan is not
  free". The plan **file** may contain the machine payloads; the conversation
  stays human-readable.
- **Never echo a source secret** (API key/token) into chat or the plan file.
  Store it only as a session env var; if the user pastes one inline, keep a
  placeholder like `<your-…-api-key>` in the plan.
- **Step tracker** (display at start + after each step; update in place):

  ```
  ───── Plan flags ──────────────────────────────────
    [1] Scan <platform>   ○ pending
    [2] Map the unit      ○ pending
    [3] Generate plan     ○ pending
  ────────────────────────────────────────────────────
  ```

  Markers: `○ pending`, `◉ in progress`, `⏸ awaiting user`, `✓ done`,
  `⊘ skipped`. Use `⏸ awaiting user` whenever a question is open — silence,
  a re-run, or an ambiguous reply is **never** consent; re-ask.

- **Execute progress bar** (20 chars, `█` done / `░` remaining):

  ```
  ───── Execute migration ───────────────────────────
    Unit: user_id  |  Resources: 15
    Progress: [██████░░░░░░░░░░░░░░] 5/15 (1 skipped)
    Current:  pricing-experiment
  ────────────────────────────────────────────────────
  ```

---

## Plan files: resume + progressive writes

Both phases write a **resumable** plan file and update it after every step, so a
closed session can pick up where it stopped.

- Paths: `.claude/plans/<platform>-flag-migration-<date>.md` and
  `.claude/plans/<platform>-code-migration-<date>.md`.
- **Resume check (do first, every run).** Glob for an existing plan. If found
  with a `## Generation status` that is not `complete`, resume from the first
  incomplete step ("Found an in-progress plan. Resuming from step N."). If
  `complete`, ask whether to start fresh or reuse. If none, start fresh.
- Every plan opens with a `## Generation status` table
  (`✓ complete` / `◉ in progress` / `○ not started`) plus an **Overall** line.
  Write each step's data to the file **as that step completes** — never batch to
  the end.

### Plan flags: steps

1. **Scan the source.** Paginate to exhaustion (see the platform file for the
   API + pagination). Ask once up front whether to include archived resources
   (default: no). For each resource capture: key, description, type
   (→ gate/config/experiment/killswitch), the unit it buckets on, enabled state
   (migrate a disabled resource but keep it off — `enabled: false` or
   `rollout_percent: 0`), its ordered rules/variants/rollout, and any
   holdouts/segments referenced. Append to the plan in batches.
2. **Map the unit.** Map each distinct source unit id to a Shipeasy unit
   (`user_id`, an `anonymous_id`, or a `bucketBy`/`unit_type` like
   `company_id`). Educate then ask; wait for an explicit pick.
3. **Generate the plan.** Confirmation gate first: summarize the unit mapping
   and that **every resource defaults to `[ ] Migrate  [ ] Skip` (neither
   ticked)**; the user opts each one in during review. Wait for explicit
   confirm. Then, per resource, write the intended Shipeasy call (resource type,
   translated rules via the platform's operator table, rollout/weights, a
   positive- and negative-case check to run at execute), and the `[ ] Migrate
   [ ] Skip` checkbox. Emit source waterfall rules as an ordered gate `stack` in
   source order.

Tell the user where the plan is and that migration is **opt-in** — `execute`
refuses any resource with neither box ticked.

### Plan code: steps

1. **Detect language & framework** (dependency manifest + the source SDK's
   import pattern).
2. **Detect the migration style** — this branches everything:
   - **Provider swap** — the app already reads flags through **OpenFeature**
     (standard `getBooleanValue` / `useFlag` call sites behind a registered
     provider, official or hand-written). Then Phase 2 is a **one-file provider
     swap**: register Shipeasy's OpenFeature provider (see the SDK docs /
     `docs_get`), and **leave every call site unchanged**. Re-home any business
     semantics the old provider encoded (on/off-string modelling, conditional
     payloads) into the Shipeasy **resource model** (a config value, a gate) or
     a thin wrapper — don't silently drop it.
   - **Call-site rewrite** — the app calls the source SDK directly. Rewrite each
     call site onto `@shipeasy/sdk` (steps below).
3. **Fetch the SDK guide** for the detected language via the `docs_*` tools /
   `{{SDK_SNIPPET:…}}` and put the **actual** snippets in the plan (not a
   "fetch it later" note). Relevant snippet keys: `release/flags`,
   `release/configs`, `release/killswitches`, `release/experiments`,
   `metrics/track`, `ops/see`.
4. **Scan the codebase** for source-SDK usage; group files by the flag they
   read.
5. **Generate transform rules** (source call → Shipeasy SDK call) and a plan
   **grouped by flag** — one flag = one PR.

---

## Execute: interactive, one unit at a time

`execute <plan-file>` walks the plan step by step. **Never auto-continue** —
checkpoint after each resource / PR and wait for the user.

**Flag (definitions) plans.** Read the plan; the unit mapping is already in it —
don't re-ask. **Refuse to proceed if any resource has neither `[x] Migrate` nor
`[x] Skip`** — list them and ask the user to tick a box. For each `[x] Migrate`
resource, in order:

1. Describe it in plain English (name + rules + rollout/variants).
2. Ask: "Create this in Shipeasy? [Yes / Skip / Pause]".
3. On yes: `*_list` to dedup, then create it (gate/config/experiment/killswitch
   per the plan). For an experiment, ensure its `universe` exists first
   (`release_experiments_universes_list` → `…_create`) and its `goal_metric`
   /events (see `shipeasy-metrics`); create it as a **draft** — do **not** start
   it. For a config that decomposed into gate+config, create both.
4. **Verify both a positive and a negative case** before calling it migrated:
   read it back (`release_flags_list` / `release_experiments_get`) and confirm a
   context that should match does, and one that shouldn't doesn't. Include the
   custom attributes the rules use in the check context, or targeting can't
   evaluate.
5. Checkpoint: "[Continue / Pause]?" Update the plan's progress + the tracker.

End with the final summary (migrated / skipped / failed).

**Code plans.** If the style is **provider swap**, it's a single PR that swaps
the registered provider and leaves call sites alone, then verify — no per-flag
loop. Otherwise, one flag = one PR:

1. First, one-time SDK setup — install `@shipeasy/sdk`, add the single
   `shipeasy({ serverKey })` (server) / `shipeasy({ clientKey })` (browser)
   configure call at startup (one configure per side; never a custom wrapper).
   Ask before installing / editing.
2. Per flag: branch `migrate/<flag>-to-shipeasy`, apply the transform rules to
   its files, run lint + type-check, commit, open a PR titled
   `feat: migrate <flag> from <platform> to Shipeasy`, show the link, then
   checkpoint.

Update the plan's progress table after every step so the run stays resumable.

---

## Holdouts, mutual exclusion, universes

- **Holdouts** live on the **universe** (`holdout_range: [lo, hi]`, an inclusive
  slice of 0–9999; 1% = a 100-bucket slice like `[0, 99]`), not on individual
  experiments — set them with `release_experiments_universes_create/update`. A
  source per-experiment holdout maps to a universe holdout shared by the
  experiments that should honor it; note the reshaping in the plan.
- **Mutual exclusion** (a source "layer" / "exclusion group" of experiments that
  must not overlap) maps to putting those experiments in the **same universe** —
  one universe partitions its population so a unit is in at most one of its
  experiments. Independent experiments that may co-run go in **different**
  universes.
