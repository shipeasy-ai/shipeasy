---
name: skills-eval
description: How to run the behavioural skills-eval — drive headless `claude -p` with prompts and assert the right Shipeasy skill fires, the right MCP tools get called, and the resulting server state is correct. Covers prerequisites (local backend + token), the seed/eval/test commands, every SHIPEASY_EVAL_* option, the report columns, the case format, and common recipes (run one skill, A/B a skill removal, outcome + dedup checks). Trigger on "run the skills eval", "run skills-eval", "eval the skills", "test the shipeasy skills", "does the skill route", "skill routing eval", "check the eval".
user-invocable: true
---

# Running the skills-eval

`marketplace/skills-eval` (`@shipeasy/skills-eval`) is the **behavioural** eval
for the shipped skills. It drives headless `claude -p` with realistic prompts and
scores the tool-call transcript on several dimensions:

- **skill** — did the expected Skill fire?
- **tools** — were the expected MCP tools called (with defensive `*_list`, OR-groups)?
- **args** — did a tool call carry the right params (country, emails, event name)?
- **ask** — did the agent clarify via AskUserQuestion when it should?
- **state** — did the resource actually land on the server (outcome verification)?
- **clean** — did it avoid forbidden tools (a read-only ask never mutates)?

It is the runtime layer above `@shipeasy/skills-contract` (which is static — "every
tool a skill *mentions* exists"). Two speeds:

| command | checks | needs a model? | live backend? |
| --- | --- | --- | --- |
| `pnpm --filter @shipeasy/skills-eval test` | the parser/scorer logic (unit tests) | no | no |
| `pnpm --filter @shipeasy/skills-eval eval` | prompt → skill → tools → **server state** | **yes** (Haiku) | **yes** (`:3100`) |

`test` is free and runs in CI. `eval` spawns real `claude` processes against a
local backend, costs tokens, and takes ~2–4 min per case — run it on demand.

## Prerequisites for `pnpm eval`

1. **`claude` on PATH**, authenticated (macOS keychain works; else `ANTHROPIC_API_KEY`).
2. **The local MCP built**: `pnpm --filter @shipeasy/mcp build` (the run launches
   `marketplace/mcp/bin/mcp.js`).
3. **A local admin backend on `:3100` with seeded data + a minted admin key.** This
   is the `apps/ui` e2e server (`next dev -p 3100`, seeded `e2e-project-id`). If it's
   down, a `curl -s localhost:3100/api/admin/gates` returns nothing — bring it back
   before running. The bearer + project id come from
   `apps/ui/contract-tests/.contract-env.json` (see that harness for how it's minted).

Quick env setup (bash):

```bash
export SHIPEASY_EVAL_TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('apps/ui/contract-tests/.contract-env.json')).bearer)")
export SHIPEASY_EVAL_PROJECT_ID=e2e-project-id
export SHIPEASY_EVAL_BASE_URL=http://localhost:3100
```

## Commands

```bash
# 1. (optional) Seed one draft flow-stub per skill from its Trigger-on phrases.
pnpm --filter @shipeasy/skills-eval seed
pnpm --filter @shipeasy/skills-eval seed -- flags --force   # regenerate one skill

# 2. Run the eval.
pnpm --filter @shipeasy/skills-eval eval                 # all cases
pnpm --filter @shipeasy/skills-eval eval -- flags        # cases whose file/id matches "flags"
pnpm --filter @shipeasy/skills-eval eval -- ab-test      # a single case by id substring

# 3. Fast unit tests (parser/scorer/case validity) — no model needed.
pnpm --filter @shipeasy/skills-eval test
pnpm --filter @shipeasy/skills-eval type-check
```

Output is a per-case matrix + a "Misses" section + a "Server state after runs"
section. Exit code is non-zero if any case is below threshold. Per-run transcripts
and the report land in `skills-eval/.eval-workdir/` (git-ignored).

## Options (all `SHIPEASY_EVAL_*` env vars)

| env | default | meaning |
| --- | --- | --- |
| `SHIPEASY_EVAL_TOKEN` | — (**required**) | admin SDK key (`X-SDK-Key`) minted vs the local backend |
| `SHIPEASY_EVAL_PROJECT_ID` | — (**required**) | project id for the `.shipeasy` binding + admin calls |
| `SHIPEASY_EVAL_BASE_URL` | `http://localhost:3100` | local admin API base |
| `SHIPEASY_EVAL_K` | `3` | runs per case (raise to 5 to smooth routing flake) |
| `SHIPEASY_EVAL_THRESHOLD` | `0.67` | pass fraction (0..1) per asserted dimension |
| `SHIPEASY_EVAL_MODE` | `execute` | `execute` = real MCP calls; `plan` = capture intended tool_use, no side effects |
| `SHIPEASY_EVAL_MODEL` | `haiku` | `--model`; routing must survive the cheapest model |
| `SHIPEASY_EVAL_CLAUDE_BIN` | `claude` | the claude binary to spawn |
| `SHIPEASY_EVAL_TIMEOUT_MS` | `240000` | per-run spawn timeout |
| `SHIPEASY_EVAL_APP_DIR` | sdk-ts guide example | app copied into the sandbox as read material (`""` = bare) |
| `SHIPEASY_EVAL_EXCLUDE_SKILLS` | — | comma-separated skill dirs to drop from the sandbox (A/B a skill's value) |

The filter is a positional arg after `--`: it matches a case file name **or** a case id substring.

## How a run is sandboxed (why results are trustworthy)

Each case runs headless in a throwaway `.eval-workdir` with an **MCP-only
lockdown** — `Bash`, `Edit`, `Write`, `Agent` are disallowed. So the run:

- **can't touch the real repo** (no shell, no edits),
- is **forced onto the MCP surface** we assert on (can't fall back to the CLI),
- keeps every tool call in the top-level transcript (no subagents).

The sandbox gets: a copy of the chosen example app (+ a checkout fixture), all
shipped skills under `.claude/skills/`, a `.shipeasy` binding, and an isolated
`XDG_CONFIG_HOME` config pointing the MCP at the local backend — so it never reads
or clobbers your real `~/.config/shipeasy` prod session.

## Case format (`cases/<skill>.json`)

```jsonc
{
  "id": "shipeasy-flags/ship-then-ramp",
  "prompt": "Put the new checkout behind a flag at 10%, then ramp it to 50%.",
  "expect_skill": "shipeasy-flags",          // OR expect_skills: ["a","b"] — all must fire
  "expect_tools": ["release_flags_list", ["release_flags_create", "release_flags_enable"]],
  "tools_match": "all",                       // "all" | "any" | "none" (informational)
  "forbid_tools": ["release_flags_archive"],  // must NOT be called
  "assert_args": [{ "tool": "release_flags_create", "contains": ["US", "alice@acme.com"] }],
  "expect_ask": false,                        // true → agent must call AskUserQuestion
  "expect_state": { "flags": ["checkout"] },  // resource must exist on the server after
  "setup": { "flags": ["dedupe_checkout"] },  // pre-create (flags/events only) — for dedup cases
  "expect_no_duplicate": { "flags": ["dedupe_checkout"] }, // count didn't grow → agent reused
  "note": "…"
}
```

- **`expect_tools`** entries are a tool name, or an **OR-group** (array = any-of), so a
  case can require a `*_list` dedup check AND one-of several terminal actions.
- **`expect_state`** / **`expect_no_duplicate`** query the admin API after the run —
  the authoritative "did it actually get created / not duplicated" outcome check.
  Types: `events`, `metrics`, `experiments`, `flags`, `killswitches`, `alerts`, `ops`
  (matched by name/title substring). `setup` can only pre-create `flags` + `events`.
- Prompts are capped at 140 chars (a `cases.test.ts` guard) — write them like a human speaks.

## Common recipes

```bash
# Just one skill's cases
pnpm --filter @shipeasy/skills-eval eval -- experiments

# Smoother scoring (routing is nondeterministic on Haiku)
SHIPEASY_EVAL_K=5 pnpm --filter @shipeasy/skills-eval eval -- flags

# A/B whether a skill is load-bearing: run once normally, once without it, compare
# (this is how shipeasy-common, then shipeasy-setup, were shown to be
#  non-essential and removed — the excluded run routed equal-or-better)
SHIPEASY_EVAL_EXCLUDE_SKILLS=shipeasy-see pnpm --filter @shipeasy/skills-eval eval -- flags

# Capture intended tool_use without executing (no server side effects)
SHIPEASY_EVAL_MODE=plan pnpm --filter @shipeasy/skills-eval eval -- flags

# Point at a different example app for code-instrumentation flows
SHIPEASY_EVAL_APP_DIR=$PWD/../packages/server-sdks/sdk-go/examples/guide \
  pnpm --filter @shipeasy/skills-eval eval -- experiments
```

## Interpreting results / gotchas

- **Routing is nondeterministic on Haiku** — a case can fire the skill 0% on one run
  and 100% on the next. Use `K≥5` before treating a red as real; `K=1` is a smoke test.
- **Outcome vs process** — a case can create the resource correctly (`state ✓`) yet
  fail because it skipped the asserted `*_list` step (`tools ✗`). The state column is
  the authoritative "did it work"; the tool column measures *how*.
- **Dedup cases are outcome-gated** (`tools_match: "none"`): the point is that no
  duplicate is created, however the agent gets there.
- **`state` shows `new` vs `existing`** — a resource created by a prior run reads as
  "existing". Clear test resources via the admin API for a clean "new" signal.
- **Backend hang** — many heavy runs back-to-back can hang the `:3100` dev server; if
  `curl localhost:3100/api/admin/gates` stops responding, restart it, then re-run.
- **Never run concurrent `eval` invocations** — they overload the one backend. Sequence them.
