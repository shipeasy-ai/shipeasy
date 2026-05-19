---
name: shipeasy-flags
description: Create, evaluate, and roll out Shipeasy feature gates and dynamic configs. Trigger on "feature flag", "feature gate", "rollout", "kill switch", "dynamic config", "remote config".
user-invocable: true
---

# Shipeasy feature gates & configs

A **gate** is a boolean (on/off, percentage rollout, targeting). A **config**
is a typed JSON value the SDK returns for tunable knobs. Both share the same
KV blob and the same evaluation semantics — same SDK key, same call shape,
fed by `@shipeasy/sdk`.

## Enabling on a project

`/shipeasy:flags:install` (or `shipeasy modules enable gates && shipeasy
modules enable configs`).

## Creating

Prefer MCP tools — they validate input shapes and return typed errors:

```
mcp tool: exp_create_gate {
  "name": "checkout_v2",
  "rollout_percent": 10,
  "targeting": [{ "attribute": "country", "op": "in", "values": ["US","CA"] }],
  "default": false
}
```

```
mcp tool: exp_create_config {
  "name": "search_ranking",
  "value_type": "json",
  "default_value": { "boost": 1.0, "model": "v3" },
  "rules": [
    { "if": { "country": "DE" }, "value": { "boost": 1.2, "model": "v3" } }
  ]
}
```

CLI equivalents:

```bash
shipeasy flags create --help
shipeasy flags list
shipeasy flags update <name>      # adjust rollout / targeting
shipeasy flags archive <name>     # disable a gate without deleting
```

## Reading from the SDK

Server (one configure call already done in `layout.tsx`):

```ts
import { gates, configs } from "@shipeasy/sdk/server";
const isOn = await gates.check("checkout_v2", { country: req.country });
const ranking = await configs.get("search_ranking", { country: req.country });
```

Client:

```ts
import { gates, configs } from "@shipeasy/sdk/client";
const isOn = gates.check("checkout_v2");
const ranking = configs.get("search_ranking");
```

## Rollout playbook

1. Create the gate at `rollout_percent: 0` with the new code path gated on it.
2. Ship to production. Both code paths exist; nothing changes.
3. Ramp: `5 → 25 → 50 → 100`, watching error/latency dashboards.
4. Once at 100% for at least one full deploy cycle, **remove the gate from
   code**.
5. Archive the gate after code removal.

## Kill switch pattern

For risky launches, create a separate `kill_<feature>` gate that defaults
**on** and gates the old code path. Flip to off if the new path breaks.

## Errors → action

| Error                | Action                                              |
| -------------------- | --------------------------------------------------- |
| `409 already exists` | Either pick a new name or update the existing gate. |
| `400 invalid rule`   | Check `targeting` / `rules` shape against schema.   |
| `401`                | Re-run `shipeasy login`.                            |
| `429` plan-limit     | Surface plan limits to user.                        |

## Hard rules

- Gate **new** behavior, not old behavior. The default value is what users see
  if KV is unreachable — make it the safe path.
- Don't gate on PII. Targeting attributes should be coarse-grained (country,
  plan, account age bucket).
- Plan-level knobs (poll interval, etc.) live in `packages/core/src/config/plans.ts`,
  not in gates/configs.
