---
name: flags-install
description: One-shot install for the whole flags + experimentation platform — gates, dynamic configs, kill switches, A/B experiments, and event metrics
user-invocable: true
---

Per-project install for the **flags platform** — gates, dynamic configs, kill
switches, A/B experiments, and the event stream that powers metrics +
experiment success criteria. There is no per-feature install; this one command
turns on the whole platform.

**This is now a pure CLI command** — the install logic lives in the binary
(`shipeasy install flags`), which enables every module, ensures the admin read
paths are reachable, and prints the hand-off. There is nothing to reason about;
run it with the **Bash tool** and relay its output.

> **First, update before you debug.** An `unknown command` / `unknown option`
> here is almost always version drift (`shipeasy install` needs
> `@shipeasy/cli` ≥ 2.2.0). Update and retry once:
> `npm i -g @shipeasy/cli@latest` (or `npx @shipeasy/cli@latest install flags`),
> and refresh the plugin: `/plugin marketplace update shipeasy`.

## Steps

1. Confirm the base onboarding is in place. If this fails, stop and tell the
   user to run `/shipeasy:setup` first:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

2. Run the installer and relay its output verbatim:

   ```bash
   shipeasy install flags
   ```

   It enables `gates`, `configs`, `events`, and `experiments` (kill switches
   ride the same KV blob — no separate module), verifies each admin read path
   is reachable (never `403`), and prints the enabled modules + next steps. A
   non-zero exit means a module didn't enable — surface the error; don't claim
   success.

That's the whole install. The other two install sections are
`/shipeasy:ops:install` (feedback + production errors) and
`/shipeasy:i18n:install` (translations).

## After it succeeds

Point the user at how to create resources — via the `shipeasy` MCP server, the
CLI, or the higher-level skills (all delegate to the same surface):

```
release_flags_create       { "name": "<name>", "rollout_percent": <n> }              # gate
release_configs_create     { "name": "<folder.name>", "schema": { ... }, "value": ... } # dynamic config
release_killswitch_create  { "name": "<folder.name>" }                               # kill switch
ops_alerts_create          { "name": "<name>", "metricId": "<id>", "comparator": "gt", "threshold": <n> }  # alert rule
```

Workflows that involve codebase analysis live in the area skills:

- `/shipeasy:experiments` — design + draft an A/B test (analyze the codebase,
  propose a variation point + success metric, instrument events, draft).
- `/shipeasy:metrics` — analyze + instrument + create a metric.

Or just ask — the `flags`, `experiments`, `metrics`, and `alerts` skills carry
the guidance and always delegate to the MCP server or CLI.
