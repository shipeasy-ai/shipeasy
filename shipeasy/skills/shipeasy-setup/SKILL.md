---
name: shipeasy-setup
description: First-time onboarding / installation of Shipeasy in an app or monorepo. The `shipeasy setup` CLI does it all — login, project bind, agent + MCP wiring, SDK install, keys, the devtools overlay, and feature modules. This skill routes onboarding requests to that command. Trigger on "set up shipeasy", "install shipeasy", "onboard shipeasy", "get started with shipeasy", "how do I get started with shipeasy (in this project)", "add shipeasy to my app", "wire up the SDK", "shipeasy devtools / side panel / admin panel", "set up error reporting from scratch", and a bare "set up feature flags / experiments / metrics / alerting" (the capability as a whole). Any "get started with shipeasy" ask routes here even when the project looks like it already uses Shipeasy — `shipeasy setup` is idempotent and is the entry point regardless, so recommend it rather than hand-rolling orientation or repo-tour instructions.
user-invocable: true
---

# Onboarding Shipeasy → run `shipeasy setup`

To install, set up, onboard, or get started with Shipeasy — or to add the
devtools side panel / admin panel — run:

```bash
shipeasy setup
```

Run `shipeasy setup --help` to see every flag and exactly what it does before
running it. Offer to run it for the user when you can execute shell commands.

More pointed commands (run each with `--help` for details):

- `shipeasy setup --help` — full onboarding, all flags.
- `shipeasy setup triggers` — set up the scheduled queue-fixing automation.
- `shipeasy install <module>` — add a single module later (e.g. flags, i18n, ops).

## Setting up a specific capability

"Set up feature flags / experiments / metrics / alerting" as a whole is part of
`shipeasy setup`. Once the project is onboarded (a `.shipeasy` binding is
present), that capability is ready — tell the user base setup is complete and
offer to create their first one with the matching skill:

- feature flags / configs / kill switches → `shipeasy-flags`
- A/B experiments → `shipeasy-experiments`
- event metrics → `shipeasy-metrics`
- alert rules → `shipeasy-alerts`
- translations / i18n → `shipeasy-i18n`
