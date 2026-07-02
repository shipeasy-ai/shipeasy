# @shipeasy/skills-eval

Behavioural eval for the shipped skills. It drives **headless `claude -p`** with
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
# 1. Seed draft cases from every skill's `Trigger on "…"` phrases.
pnpm --filter @shipeasy/skills-eval seed          # all skills (won't clobber edits)
pnpm --filter @shipeasy/skills-eval seed -- flags --force   # regenerate one

# 2. Refine cases/*.json by hand (see "Case format"). Drafts land as
#    tools_match:"none" (nothing asserted) — turn a trigger phrase into a natural
#    request and promote the real tool(s) to "all"/"any". cases/shipeasy-flags.json
#    and cases/shipeasy-alerts.json are worked examples.

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

### Knobs

| env | default | meaning |
| --- | --- | --- |
| `SHIPEASY_EVAL_K` | `3` | runs per case (raise to 5 to smooth flake) |
| `SHIPEASY_EVAL_THRESHOLD` | `0.67` | pass fraction (0..1) |
| `SHIPEASY_EVAL_MODE` | `execute` | `execute` = real MCP calls; `plan` = capture intended tool_use, no side effects |
| `SHIPEASY_EVAL_MODEL` | `haiku` | `--model` for the run |
| `SHIPEASY_EVAL_CLAUDE_BIN` | `claude` | claude binary |

## Case format

```jsonc
{
  "id": "shipeasy-flags/create-gate",
  "prompt": "Create a feature flag called checkout_v2 that's on for 10% of users.",
  "expect_skill": "shipeasy-flags",       // bare skill name that must fire
  "expect_tools": ["release_flags_create"],
  "tools_match": "all",                    // "all" | "any" | "none" (informational)
  "forbid_tools": ["release_flags_archive"], // must NOT be called
  "note": "canonical create path"
}
```

Tool names are the **suffix** (no `mcp__…__` prefix) — the harness namespaces the
server as `shipeasy`, so `release_flags_create` is matched as
`mcp__shipeasy__release_flags_create` in the transcript.

## ⚠️ Version-sensitive flags

The headless invocation lives in **one place** — `buildClaudeArgs()` in
[`src/run.ts`](src/run.ts). It assumes current `claude` CLI behaviour:
`--output-format stream-json --verbose`, `--mcp-config`/`--strict-mcp-config`,
`--permission-mode bypassPermissions|plan`, `--append-system-prompt`, and that a
Skill invocation surfaces as a `tool_use` block named `Skill`. **Smoke-test once**
against your installed `claude` before trusting a red result:

```bash
claude -p "list my feature flags" --output-format stream-json --verbose \
  --mcp-config .eval-workdir/mcp-config.json --strict-mcp-config \
  --permission-mode bypassPermissions --model haiku | grep '"name"'
```

If a flag name has drifted or the Skill block is shaped differently, adjust
`buildClaudeArgs()` and `parseTranscript()` (the two seams) — everything else is
version-independent.
