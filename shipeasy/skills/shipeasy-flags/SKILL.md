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

## Creating

Minimal call shapes — field semantics, aliases, and constraints are documented
in the tool schema / `--help` and enforced by the API with instructive errors:

```
mcp tool: release_flags_create {
  "name": "checkout_v2",
  "enabled": true,
  "rollout_percent": 10,
  "rules": [{ "attr": "country", "op": "in", "value": ["US","CA"] }]
}
```

```
mcp tool: release_configs_create {
  "name": "search.ranking",
  "schema": { "type": "object", "properties": {
    "boost": { "type": "number" }, "model": { "type": "string" } },
    "required": ["boost", "model"] },
  "value": { "boost": 1.0, "model": "v3" }
}
```

## Reading from the SDK

The calls below are the exact, version-correct forms for this project's SDK
language (see `shipeasy-common` → "Pulling SDK call sites"). Use them verbatim.

Reading a gate:

{{SDK_SNIPPET:release/flags}}

Reading a config:

{{SDK_SNIPPET:release/configs}}

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

For a first-class kill switch (the `release_killswitch_*` surface), read it
from the SDK like this:

{{SDK_SNIPPET:release/killswitches}}

## Hard rules

- Gate **new** behavior, not old behavior. The default value is what
  users see if KV is unreachable — make it the safe path.
- Don't gate on PII. Targeting attributes should be coarse-grained
  (country, plan, account age bucket).
- Plan-level knobs (poll interval, etc.) live in
  `packages/core/src/config/plans.ts`, not in gates/configs. Those are
  server-side knobs, not customer-facing.
