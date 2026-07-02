---
name: shipeasy-flags
description: Create, evaluate, and roll out Shipeasy feature gates and dynamic configs. Trigger on "feature flag", "feature gate", "rollout", "kill switch", "dynamic config", "remote config".
user-invocable: true
---

# Shipeasy feature gates & configs

A **gate** is a boolean (on/off, percentage rollout, targeting). A
**config** is a typed JSON value the SDK returns for tunable knobs. Both
share the same KV blob and the same evaluation semantics — same SDK key,
same call shape, fed by `@shipeasy/sdk`.

**Prerequisites live in the `shipeasy-common` skill** — the MCP ⇄ CLI ⇄ API
surfaces (`release_flags_*` / `release_configs_*` / `release_killswitch_*`, or
`shipeasy release flags|configs|killswitch …`), updating on version drift, the
`.shipeasy` binding, `shipeasy install flags` to enable (guided: the
`shipeasy install flags` (or `shipeasy setup`)), and archive-not-delete.
Read parameter shapes from the tool (`--help` / MCP schema), not from here.

> **Pull the SDK snippet for this product's language.** Before writing any
> gate/config evaluation code, fetch the exact, version-correct call from the
> SDK docs and use it verbatim:
> `shipeasy docs get --sdk <lang> release/flags` (and `release/configs`).
> `shipeasy docs list --sdk <lang>` lists every page/snippet; `<lang>` defaults
> from `.shipeasy`. The fetched snippet is the source of truth.

## Creating

Shapes below are the ones people get wrong — everything else is in the tool:

```
mcp tool: release_flags_create {
  "name": "checkout_v2",
  "enabled": true,
  "rollout_percent": 10,
  "rules": [{ "attr": "country", "op": "in", "value": ["US","CA"] }]
}
// Gotcha: rollout_percent is the friendly 0–100 alias; rollout_pct is basis
// points (0–10000). rules are AND-combined.
```

```
mcp tool: release_configs_create {
  "name": "search.ranking",
  "schema": { "type": "object", "properties": {
    "boost": { "type": "number" }, "model": { "type": "string" } },
    "required": ["boost", "model"] },
  "value": { "boost": 1.0, "model": "v3" }
}
// Gotcha: configs are JSON-Schema-first — `schema` (draft 2020-12, top-level
// type:object) + `value` (one object for all envs, or a { env: value } map).
// Per-env edits go through the draft → publish path, not a flat update.
```

## Reading from the SDK

Pull the call site for this project's SDK language from the `docs` surface (see
`shipeasy-common` → "Pulling SDK call sites"): `docs_get { sdk: <lang>, path:
"release/flags", name: "checkout_v2" }` for gates,
`docs_get { sdk: <lang>, path: "release/configs", name: "search_ranking" }` for
configs. The snippet below is **shape only**.

Gates and configs are both read off the one `flags` facade — `flags.get` for a
gate, `flags.getConfig` for a config. Do not assume TS/Next.js; fetch the exact
call for this project's language via `docs_get`.

```ts
// Server — flags.get takes the User as its 2nd arg (configure() ran at startup).
import { flags } from "@shipeasy/sdk/server";
const user = { user_id: req.userId, country: req.country };
const isOn = flags.get("checkout_v2", user); // boolean
const ranking = flags.getConfig("search_ranking"); // typed config value
```

```ts
// Client — the user is set once via shipeasy({ clientKey }) / identify().
import { flags } from "@shipeasy/sdk/client";
const isOnClient = flags.get("checkout_v2"); // boolean
const rankingClient = flags.getConfig("search_ranking");
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
