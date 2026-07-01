---
name: flags
description: Create, evaluate, and roll out Shipeasy feature gates and dynamic configs. Trigger on "feature flag", "feature gate", "rollout", "kill switch", "dynamic config", "remote config".
user-invocable: true
---

# Shipeasy feature gates & configs

A **gate** is a boolean (on/off, percentage rollout, targeting). A
**config** is a typed JSON value the SDK returns for tunable knobs. Both
share the same KV blob and the same evaluation semantics — same SDK key,
same call shape, fed by `@shipeasy/sdk`.

## First fix: update before you debug

Most failures here — `unknown command` / `unknown option`, a missing
subcommand, an unexpected `400`/`404`, or something that worked before — are
**version drift**: the CLI or MCP server is older than the feature being
invoked. Before deeper debugging, update to latest and retry once:

- **CLI:** `npm i -g @shipeasy/cli@latest` (or one-off: `npx @shipeasy/cli@latest <cmd>`).
- **MCP server:** pinned to `@shipeasy/mcp@latest` — restart the session/agent
  to pick up a new release.
- **In Claude Code (plugin skills + slash commands):**
  `/plugin marketplace update shipeasy` then `/plugin install shipeasy@shipeasy`
  (there is no `claude plugin update`), or open `/plugin` and enable auto-update.

Only treat it as a real bug if it still fails on the latest CLI **and** MCP server.

## Enabling on a project

Run `shipeasy install flags` — the one platform install that folds gates,
configs, kill switches, experiments, and events into a single enable. In Claude
Code you can instead invoke `/shipeasy:flags:install`, which delegates to the
same CLI command.

## How to act: always the MCP server or the CLI

There are **no per-verb slash commands** for gates, configs, or kill switches.
Every create / list / update / archive / toggle goes through one of two
surfaces, preferred in this order:

1. **MCP tools** (`release_flags_*`, `release_configs_*`, `release_killswitch_*`)
   when the `shipeasy` MCP server is registered — they validate input shapes and
   return typed errors.
2. **The `shipeasy` CLI** (`shipeasy release flags|configs|killswitch …`) as the
   fallback when MCP isn't available (e.g. a skills-CLI install on a host that
   hasn't registered the server yet).

Deletion is **UI-only** — there is no delete tool or command; archive instead.

## Creating

Prefer MCP tools — they validate input shapes and return typed errors:

```
mcp tool: release_flags_create {
  "name": "checkout_v2",
  "enabled": true,
  "rollout_percent": 10,
  "rules": [{ "attr": "country", "op": "in", "value": ["US","CA"] }]
}
// rollout_percent is 0–100 (friendly alias); rollout_pct is basis points
// (0–10000). rules are AND-combined { attr, op, value }; ops: eq/neq/in/
// not_in/gt/gte/lt/lte/contains/regex.
```

```
mcp tool: release_configs_create {
  "name": "search.ranking",
  "schema": {
    "type": "object",
    "properties": { "boost": { "type": "number" }, "model": { "type": "string" } },
    "required": ["boost", "model"]
  },
  "value": { "boost": 1.0, "model": "v3" }
}
// Configs are JSON-Schema-first: `schema` (draft 2020-12, top-level
// type:object) + `value` (one JSON object for all envs, or a { env: value }
// map). The name is `folder.name` form. Per-env edits go through the
// draft → publish path (release_configs_draft / release_configs_publish).
```

CLI equivalents (the fallback when MCP isn't registered):

```bash
shipeasy release flags create --help
shipeasy release flags list
shipeasy release flags update <name>      # adjust rollout / targeting
shipeasy release flags archive <name>     # disable a gate without deleting

shipeasy release configs create|list|update|archive --help
shipeasy release killswitch create|list|set|unset|update|archive --help
```

## Reading from the SDK

**Pull the call site for this project's SDK language from the `docs` MCP.**
Detect the language from `.shipeasy` or the subproject's manifest
(`package.json`, `pyproject.toml`, `Gemfile`, `go.mod`, `pom.xml`,
`build.gradle*`, `composer.json`, `Package.swift`), then fetch the snippet:
`docs_get { sdk: <lang>, path: "release/flags", name: "checkout_v2" }` for gates
and `docs_get { sdk: <lang>, path: "release/configs", name: "search_ranking" }`
for configs (run `docs_list { sdk: <lang> }` to find the handle; CLI
`shipeasy docs get --sdk <lang> release/flags --name checkout_v2`). The example
below shows the shape — use the docs snippet for the exact call.

```ts
// Example shape (TypeScript) — fetch the exact call for THIS project's
// language via docs_get; do not assume TS/Next.js.
// Server (one configure call already done at app startup):
import { gates, configs } from "@shipeasy/sdk/server";
const isOn = await gates.check("checkout_v2", { country: req.country });
const ranking = await configs.get("search_ranking", { country: req.country });

// Client:
import { gates, configs } from "@shipeasy/sdk/client";
const isOnClient = gates.check("checkout_v2");
const rankingClient = configs.get("search_ranking");
```

## Rollout playbook

1. Create the gate at `rollout_percent: 0` with the new code path gated on it.
2. Ship to production. Both code paths exist; nothing changes.
3. Ramp: `5 → 25 → 50 → 100`, watching error/latency dashboards.
4. Once at 100% for at least one full deploy cycle, **remove the gate from
   code**. Configs/gates are not a substitute for releases; leaving them
   in forever creates branching that rots.
5. Archive the gate after code removal.

## Kill switch pattern

For risky launches, create a separate `kill_<feature>` gate that defaults
**on** and gates the old code path. Flip to off if the new path breaks.

## Hard rules

- Gate **new** behavior, not old behavior. The default value is what
  users see if KV is unreachable — make it the safe path.
- Don't gate on PII. Targeting attributes should be coarse-grained
  (country, plan, account age bucket).
- Plan-level knobs (poll interval, etc.) live in
  `packages/core/src/config/plans.ts`, not in gates/configs. Those are
  server-side knobs, not customer-facing.
