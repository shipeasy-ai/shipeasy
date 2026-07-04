---
name: shipeasy-flags
description: Create, evaluate, and roll out Shipeasy feature gates and dynamic configs. Trigger on "feature flag", "feature gate", "rollout", "release/launch/ship a feature", "roll out to <country/region/%>", "which features are gated", "list flags/gates", "flag/targeting templates", "kill switch", "kill switch with an independent/separate off-switch", "per-channel or per-site sub-switch", "named toggle inside a kill switch" (the `switches` map on release_killswitch_create), "dynamic config", "remote config".
user-invocable: true
---

# Shipeasy feature gates & configs

A **gate** is a boolean (on/off, percentage rollout, targeting). A
**config** is a typed JSON value the SDK returns for tunable knobs. Both
share the same KV blob and the same evaluation semantics — same SDK key,
same call shape, fed by `@shipeasy/sdk`.

CRUD runs through the `release_flags_*` / `release_configs_*` /
`release_killswitch_*` MCP tools or the `shipeasy release flags|configs|killswitch …`
CLI. Prerequisites: a `.shipeasy` binding and the flags module enabled
(`shipeasy install flags`, or the guided `shipeasy setup`). The destructive verb is
**archive**, never delete. Read parameter shapes from the tool (`--help` / MCP
schema), not from here.

## Creating

**Always list before you create.** First call `release_flags_list` (or
`release_configs_list` / `release_killswitch_list`) and check whether a gate,
config, or kill switch already covers this. If one matches, **reuse or update it
— never create a duplicate**. Only create when nothing existing fits.

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

### Targeting templates

To target by **country, plan, region, browser, device, app version, your team**
(or any common condition), don't hand-guess the rule shape — start from a
template. Call `release_flags_templates_list` **with a `query`** that names the
condition (e.g. `query: "country"`, `query: "team"`) to narrow the catalog,
take the matching template's `rules`, substitute your concrete value(s), and
pass them as the `rules` arg of `release_flags_create`. Example: the `Country
is` template returns `[{ "attr": "country", "op": "in", "value": ["DE","FR","IT"] }]`
— swap the `value` array for your target countries (e.g. `["BR"]`). Still run
`release_flags_list` first to dedup against an existing gate.

Built-ins (the `@team`/`@owner` audience aliases, country, email-domain,
EU/continent presets, …) are read-only. The alias templates carry a symbol
value (`email in ["@team"]`) that resolves to the live team/owner emails at
rebuild — copy them verbatim to gate a rollout to your team. Projects can also
save their own reusable templates via `release_flags_templates_create`. Read
param shapes from the tool schema.

## Listing / auditing what exists

Any read-only ask — "which features are gated", "what flags do we have",
"list the kill switches" — is a **list, not a mutation**. Route straight to
`release_flags_list` (or `release_configs_list` / `release_killswitch_list`)
and report what comes back. Never create, update, or archive to answer a
question about current state.

## Reading from the SDK

The calls below are the exact, version-correct forms for this project's SDK
language. Use them verbatim.

Reading a gate:

{{SDK_SNIPPET:release/flags}}

Reading a config:

{{SDK_SNIPPET:release/configs}}

## Rollout playbook

1. Create the gate (`release_flags_create`) at the starting `rollout_percent`
   with the new code path gated on it.
2. Ship to production. Both code paths exist; nothing changes.
3. Ramp with `release_flags_update` — raise `rollout_percent` (`5 → 25 → 50 →
   100`), watching error/latency dashboards.
4. Once at 100% for at least one full deploy cycle, **remove the gate from
   code**. Configs/gates are a stepping stone to a release; retiring them keeps
   branching from rotting.
5. Archive the gate after code removal.

A one-shot rollout ask carries the ramp inside it — "put X behind a flag at 10%,
then ramp it to 50%", or "gradually roll out, 5% now then 100%" — so it is two
calls: `release_flags_create` at the starting percent, then `release_flags_update`
to raise it. **You MUST make BOTH calls in the same session — do not stop after
the create.** Any prompt of the form "<N>% now, then ramp to <M>%" (including a
ramp to 100%) requires the follow-up `release_flags_update` to <M>%; creating the
gate and leaving it at the starting percent is an incomplete answer.

## Kill switch pattern

For risky launches, create a separate `kill_<feature>` gate that defaults
**on** and gates the old code path. Flip to off if the new path breaks.

**MANDATORY follow-up — you MUST call the `AskUserQuestion` tool** right after
creating a kill switch for anything that can "fail" (an integration, a payment
path, a risky feature): ask whether to also add a failure metric + alert so the
team knows *when* to flip the switch. A kill switch with no alert is half a
safety net. Do this every single time — create the switch, then immediately
issue the `AskUserQuestion` offer; never skip it, and never assume the answer
yourself. This is not optional politeness; it is a required step of the kill
switch workflow.

For a first-class kill switch (the `release_killswitch_*` surface), read it
from the SDK like this:

{{SDK_SNIPPET:release/killswitches}}

**Per-call-site switches.** A kill switch can carry a `switches` map of named
boolean overrides on top of its flat value — e.g. `switches: { eu_checkout:
false }` gives an independent toggle that kills just that site/region/feature
while the rest stays live. **Setting up a new kill switch that has a named
toggle → include the `switches` map in the `release_killswitch_create` call**
(the create carries the whole switch definition). Use `release_killswitch_set`
(`switchKey` + `env`) later to flip a single existing switch. So "a kill switch
with a separate toggle for X" is one `release_killswitch_create` with
`switches: { X: … }`.

## Hard rules

- Gate **new** behavior, not old behavior. The default value is what
  users see if KV is unreachable — make it the safe path.
- Don't gate on PII. Targeting attributes should be coarse-grained
  (country, plan, account age bucket).
- Plan-level knobs (poll interval, etc.) live in
  `packages/core/src/config/plans.ts`, not in gates/configs. Those are
  server-side knobs, not customer-facing.
