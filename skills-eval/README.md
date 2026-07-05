# @shipeasy/skills-eval

Behavioural eval for the shipped skills. It drives a **headless agent** —
`claude -p` by default, or `copilot -p` with `--copilot` (see [Runner](#runner--claude-default-or-copilot)) — with
prompts and asserts, from the tool-call transcript, that:

1. the **right Skill fires** (`shipeasy-flags`, `shipeasy-alerts`, …), and
2. the **right MCP tools get called** (`release_flags_create`, `ops_alerts_create`, …),
3. and **forbidden** tools don't (a read-only ask never mutates; "pause" is an
   update, not an archive).

This is the runtime layer **above** [`@shipeasy/skills-contract`](../skills-contract).
The contract test is static — "every tool a skill *mentions* exists." This one is
behavioural — "a prompt actually *routes* to that skill and calls that tool."
Because routing is probabilistic, a case passes on a **threshold of K runs**, not
a single boolean.

## Two layers, two speeds

| | what it checks | needs a model? | runs in CI |
| --- | --- | --- | --- |
| `pnpm test` (this pkg) | the parser + scorer logic (unit tests) | no | yes |
| `pnpm eval` (this pkg) | prompt → skill → tool routing (live) | **yes** (Haiku) | no — manual/nightly |

`pnpm test` is deterministic and free. `pnpm eval` spawns real `claude`
processes against a **local** backend and costs tokens — run it on demand.

## The loop

```bash
# 1. Seed one draft flow-stub per skill from its `Trigger on "…"` phrases.
pnpm --filter @shipeasy/skills-eval seed          # all skills (won't clobber edits)
pnpm --filter @shipeasy/skills-eval seed -- flags --force   # regenerate one

# 2. Write the real cases by hand. These are INTEGRATION tests, not unit tests:
#    a handful of realistic, full-flow prompts per skill — "Create an experiment
#    that splits 50/50 on the checkout_conversion metric and start it" — each
#    asserting the WHOLE tool sequence (release_experiments_create +
#    release_experiments_start) with tools_match:"all", plus forbid_tools guards.
#    Prefer few, focused flows over many thin one-liners. cases/shipeasy-experiments.json
#    and cases/shipeasy-flags.json are the worked examples.

# 3. Run the eval (see prerequisites below).
pnpm --filter @shipeasy/skills-eval eval          # all cases
pnpm --filter @shipeasy/skills-eval eval -- flags # cases whose file/id matches "flags"
```

Output is a skill × pass-rate matrix plus the specific misses (wrong skill fired,
expected tool never called, forbidden tool called). Exit code is non-zero if any
case is below threshold. Per-run transcripts and the report land in
`.eval-workdir/` (git-ignored).

## Prerequisites for `pnpm eval`

- **`claude` on PATH** and **`ANTHROPIC_API_KEY`** set (headless has no keychain).
- The **local shipeasy MCP built**: `pnpm --filter @shipeasy/mcp build` (the run
  launches `marketplace/mcp/bin/mcp.js`; override with `SHIPEASY_EVAL_MCP_*` if
  you'd rather point at `npx @shipeasy/mcp@latest`).
- A **local admin backend with seeded data** and a minted admin key (next section).

### Point it at local dev

The MCP reads its API base URL and token from an isolated config file the harness
writes (`getGeneratedClient()` uses `app_base_url` from it) — so pointing at local
dev is just three env vars. **Do not** use `SHIPEASY_CLI_TOKEN`/`SHIPEASY_PROJECT_ID`
here: that path forces the hardcoded prod URLs.

```bash
export SHIPEASY_EVAL_BASE_URL=http://localhost:3100   # apps/ui dev server (admin API)
export SHIPEASY_EVAL_PROJECT_ID=e2e-project-id
export SHIPEASY_EVAL_TOKEN=sdk_admin_...              # minted vs the local backend
```

Minting a local admin key: the admin API is served by `apps/ui` (Next.js route
handlers under `src/app/api/admin/*`). The pattern is in
[`apps/ui/contract-tests/bootstrap.mjs`](../../apps/ui/contract-tests/bootstrap.mjs):
seed a project into the local miniflare D1, forge an Auth.js session cookie, then
`POST /api/admin/keys` to get an `sdk_admin_*` bearer. Reuse that (or run the
contract-tests bootstrap) and feed the key in as `SHIPEASY_EVAL_TOKEN`.

The harness writes everything into an isolated `XDG_CONFIG_HOME` under
`.eval-workdir/`, so it **never reads or clobbers your real `~/.config/shipeasy`
prod session**.

### Model — cheapest, on purpose

The eval defaults to **Haiku** (`SHIPEASY_EVAL_MODEL=haiku`). Routing must survive
the cheapest model: if a case only passes on a bigger model, the *skill
description* is too weak — fix the description, don't bump the model. Override only
to diagnose (`SHIPEASY_EVAL_MODEL=sonnet`).

### Runner — claude (default) or copilot

The same cases can be driven by **Claude Code** (`claude -p`, default) or by the
**GitHub Copilot CLI** (`copilot -p`). Pick the runner with a user argument —
`--copilot` (or `--agent copilot`), or `SHIPEASY_EVAL_AGENT=copilot`:

```bash
pnpm --filter @shipeasy/skills-eval eval -- --copilot            # all cases, via copilot
pnpm --filter @shipeasy/skills-eval eval -- --copilot flags      # one skill, via copilot
```

Copilot **forces the cheapest GPT model** (`gpt-5-mini`) for the same reason
claude forces Haiku — routing must survive the small model, not lean on a bigger
one. Override only to diagnose: `SHIPEASY_EVAL_COPILOT_MODEL=gpt-5`.

The copilot runner keeps the same MCP-only lockdown: it denies the `shell` and
`write` tools (no repo edits, no falling back to the prod `shipeasy` CLI),
`--disable-builtin-mcps` drops the github server, and `--disable-mcp-server
shipeasy` drops any installed prod plugin server — the eval's own local-backend
server is registered under the distinct name `shipeasy_eval`, so tools resolve to
local D1 only. Copilot discovers the sandbox `.claude/skills/`, so it fires the
same `shipeasy-*` skills; if an installed plugin exposes the short name (`flags`),
the parser maps it back (`flags` → `shipeasy-flags`).

### Model — cheapest, on purpose

The eval defaults to **Haiku** (`SHIPEASY_EVAL_MODEL=haiku`) for claude and
**gpt-5-mini** for copilot. Routing must survive the cheapest model: if a case
only passes on a bigger model, the *skill description* is too weak — fix the
description, don't bump the model. Override only to diagnose
(`SHIPEASY_EVAL_MODEL=sonnet`, `SHIPEASY_EVAL_COPILOT_MODEL=gpt-5`).

### Knobs

| env | default | meaning |
| --- | --- | --- |
| `SHIPEASY_EVAL_K` | `3` | runs per case (raise to 5 to smooth flake) |
| `SHIPEASY_EVAL_THRESHOLD` | `0.67` | pass fraction (0..1) |
| `SHIPEASY_EVAL_MODE` | `execute` | `execute` = real MCP calls; `plan` = capture intended tool_use, no side effects |
| `SHIPEASY_EVAL_AGENT` | `claude` | runner: `claude` or `copilot` (or pass `--copilot` / `--agent <name>`) |
| `SHIPEASY_EVAL_MODEL` | `haiku` | `--model` for the **claude** runner |
| `SHIPEASY_EVAL_CLAUDE_BIN` | `claude` | claude binary |
| `SHIPEASY_EVAL_COPILOT_MODEL` | `gpt-5-mini` | `--model` for the **copilot** runner (cheapest GPT) |
| `SHIPEASY_EVAL_COPILOT_BIN` | `copilot` | copilot binary |

## Case format

Write prompts the way a **human actually speaks** ("I want to measure how many
checkouts get completed", not "call metrics_create"), and prefer a few realistic
FULL-FLOW cases over many thin ones.

```jsonc
{
  "id": "shipeasy-experiments/event-metric-experiment",
  "prompt": "We don't track checkout completions yet, but I want to A/B test a new green checkout button. Set up the event, a conversion metric, and draft the experiment — don't start it, I'll review first.",
  "expect_skill": "shipeasy-experiments",   // OR expect_skills: ["a","b"] — all must fire
  "expect_tools": ["metrics_events_create", "metrics_create", "release_experiments_create"],
  "tools_match": "all",                      // "all" | "any" | "none" (informational)
  "forbid_tools": ["release_experiments_start"], // must NOT be called (draft only)
  "assert_args": [                            // param-level: input must contain substrings
    { "tool": "release_experiments_create", "contains": ["control"] }
  ],
  "expect_ask": false,                        // true → agent must call AskUserQuestion
  "note": "the real dependency chain: event -> metric -> experiment"
}
```

Fields:

- **`expect_skill` / `expect_skills`** — the Skill(s) that must fire. Use the plural
  for cross-skill flows (e.g. flags → alerts); every listed skill must appear.
- **`expect_tools` + `tools_match`** — `"all"` (every tool), `"any"` (at least one),
  `"none"` (candidates, not asserted — the seed default).
- **`forbid_tools`** — must not be called. Powers the read-only guards ("what flags
  do we have?" must not create) and safety rules ("pause" is an update, not an archive).
- **`assert_args`** — param-level checks: `{ tool?, contains: [] }`. The named tool's
  call (or, if `tool` is omitted, **any** call) must have a JSON-stringified input
  containing every substring. This verifies the agent passed the country/emails/event
  the prompt described — and that a "file a bug for that" actually carries the context.
- **`expect_ask`** — the agent must clarify via AskUserQuestion (e.g. after a kill
  switch, offer to add a failure metric + alert).

Tool names are the **suffix** (no `mcp__…__` prefix) — the harness namespaces the
server as `shipeasy`, so `release_flags_create` is matched as
`mcp__shipeasy__release_flags_create` in the transcript. The valid names are
snapshotted in `src/catalog.ts` and drift-checked by `catalog.test.ts`.

Some committed cases are **aspirational** (marked in `note`) — they encode desired
behaviour the skills don't guide yet (e.g. offer an alert after a kill switch). A
red result there is a to-do for the *skill*, not a harness bug.

### Convention: defensive listing

The cases encode the agent behaviour we *want*, so most flows assert defensive
`*_list` calls:

- **List to dedup before any create.** "A/B test a green checkout button" lists
  events, metrics and experiments before creating each — don't create a second
  metric that already exists. Same for flags, kill switches, alerts.
- **List to resolve an id before acting on a named resource.** "Start the
  checkout-button experiment" / "Mute the signup-conversion alert" must list to
  find the id first, then start / update it.

The exception is **ops bug/feature filing** — a new free-text report is additive,
with no id to resolve or natural dedup key, so those cases stay create-only.

## ⚠️ Version-sensitive flags

Each runner's headless invocation lives in **one place** — `buildClaudeArgs()` /
`buildCopilotArgs()` in [`src/run.ts`](src/run.ts). Claude assumes
`--output-format stream-json --verbose`, `--mcp-config`/`--strict-mcp-config`,
`--permission-mode bypassPermissions|plan`, `--append-system-prompt`, and that a
Skill invocation surfaces as a `tool_use` block named `Skill`. Copilot assumes
`--output-format json` (JSONL), `--allow-all-tools` with `--deny-tool
shell/write`, `--disable-builtin-mcps`, `--additional-mcp-config @<file>`, and
that tool calls ride on `assistant.message` events (MCP via `mcpToolName`, skills
via the builtin `skill` tool). **Smoke-test once** against your installed CLI
before trusting a red result:

```bash
# claude
claude -p "list my feature flags" --output-format stream-json --verbose \
  --mcp-config .eval-workdir/mcp-config.json --strict-mcp-config \
  --permission-mode bypassPermissions --model haiku | grep '"name"'

# copilot
copilot -p "list my feature flags" --output-format json --allow-all-tools \
  --additional-mcp-config @.eval-workdir/mcp-config.copilot.json \
  --model gpt-5-mini | grep -o '"mcpToolName":"[^"]*"'
```

If a flag name has drifted or the transcript shape is different, adjust the
matching `build*Args()` and the format branch in `parseTranscript()` (the two
seams) — everything else is version-independent.
