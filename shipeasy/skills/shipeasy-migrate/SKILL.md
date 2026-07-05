---
name: shipeasy-migrate
description: Migrate feature flags, configs, and experiments from another platform INTO Shipeasy — Statsig, Eppo, Optimizely, PostHog, or Confidence. This is an on-demand, intentionally-invoked workflow; it does NOT fire on ambient flag/experiment phrasing (that is `shipeasy-flags` / `shipeasy-experiments`). Trigger ONLY on an explicit "migrate from <platform> to Shipeasy" request or a direct `shipeasy-migrate` invocation — e.g. "migrate our Statsig gates to Shipeasy", "move our Eppo/Optimizely/PostHog/Confidence flags over to Shipeasy", "port my LaunchDarkly-via-OpenFeature setup to Shipeasy".
argument-hint: "<statsig|eppo|optimizely|posthog|confidence> [plan flags | plan code | execute <plan-file>]"
user-invocable: true
---

# Migrate to Shipeasy

Move feature flags, dynamic configs, and experiments from another
experimentation platform **into Shipeasy**, then migrate the code that reads
them onto `@shipeasy/sdk`.

This skill is **intentionally invoked** — a customer runs it when they decide to
migrate. It is not one of the auto-triggering area skills. Never start a
migration off ambient "feature flag" / "A/B test" phrasing; those belong to
`shipeasy-flags` / `shipeasy-experiments`. Start only on an explicit
"migrate from `<platform>` to Shipeasy" ask (or a direct invocation of this
skill).

## Supported sources

| Platform | Source read via | Reference |
|----------|-----------------|-----------|
| **Statsig** (gates, dynamic configs, experiments) | Statsig Console API (`curl`) | <references/statsig.md> |
| **Eppo** (flags, allocations, experiments) | Eppo REST API (`curl`) | <references/eppo.md> |
| **Optimizely** Feature Experimentation (flags, rollouts, A/B) | Optimizely REST API (`curl`) | <references/optimizely.md> |
| **PostHog** (feature flags, multivariate) | PostHog MCP | <references/posthog.md> |
| **Confidence** (flags, variants, targeting) | Confidence MCP / REST | <references/confidence.md> |

Every migration shares one target model, one plan/execute flow, and one
operator-mapping discipline. That shared half lives in
**<references/conventions.md>** — read it first, then the platform file for the
source you are migrating from.

## The two phases

Every migration is **flags first, then code** — the two are independent runs.

```
Phase 1 — Definitions   (plan flags → execute)
  Recreate every gate / config / experiment in Shipeasy with its targeting,
  rollout, variants, and holdouts. Result: the resources exist in Shipeasy.

Phase 2 — Code          (plan code → execute)
  Once the resources exist, repoint the code that reads them onto
  @shipeasy/sdk — one flag per PR. Result: the app reads from Shipeasy and the
  old SDK is removed.
```

**Why flags first?** The code can't resolve a flag that doesn't exist in
Shipeasy yet. **Why one PR per flag?** Small, reviewable, independently
shippable; one flag's issues don't block the rest.

## Commands

Invoked by name, the skill takes a platform then a phase verb —
`shipeasy-migrate <platform> <phase>`:

| Command | Does |
|---------|------|
| `shipeasy-migrate <platform> plan flags` | Phase 1: scan the source, build the flag-definitions plan |
| `shipeasy-migrate <platform> plan code` | Phase 2: scan the codebase, build the code-transform plan |
| `shipeasy-migrate <platform> execute <plan-file>` | Walk a plan interactively, step by step |

`<platform>` is one of `statsig`, `eppo`, `optimizely`, `posthog`,
`confidence`. If the platform is missing from the invocation, ask which one
before doing anything.

## How to run one

1. **Confirm the platform** and which phase (`plan flags`, `plan code`, or
   `execute`). Display the migration overview banner from
   <references/conventions.md> at the start of any `plan` run.
2. **Read <references/conventions.md>** — the shared target model, the
   gate/config/experiment decision, the operator vocabulary, the plan-file +
   resume rules, and the interactive execute sequence.
3. **Read the platform reference** (`references/<platform>.md`) — its source
   API, its type mapping, and its source→Shipeasy operator table.
4. Run the phase per those two files. Plans are written to
   `.claude/plans/<platform>-{flag,code}-migration-<date>.md` and are
   **resumable** — always do the resume check first.

## Prerequisites (both phases)

- **Shipeasy side:** a `.shipeasy` binding with the flags module enabled
  (`shipeasy install flags`, or the guided `shipeasy setup`). Confirm with
  `projects_current`. Phase 2 also uses the SDK docs (`docs_*` MCP tools /
  `{{SDK_SNIPPET:…}}`) to emit version-correct SDK code for the project's
  language.
- **Source side:** an API key or MCP connection for the platform you are
  leaving — see that platform's reference for exactly what to obtain and how to
  store it. **Never** echo a source secret back into chat or write it to the
  plan file; keep it only as a session environment variable.

The destructive verb on the Shipeasy side is **archive**, never delete — same
as everywhere else in Shipeasy. Read parameter shapes from the MCP tool schema
/ `--help`, not from these files.
