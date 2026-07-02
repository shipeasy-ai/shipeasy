---
name: shipeasy-ops-trigger
description: DEPRECATED — trigger setup now lives in the CLI. Run `shipeasy setup triggers` (or accept the trigger step during `shipeasy setup`); it opens the hosted, guided setup wizard preselected to your platform. Trigger on "recurring fix routine", "scheduled trigger", "unattended queue burn-down", "set up a trigger".
argument-hint: "[--provider claude|codex|cursor|copilot|gemini|jules]"
user-invocable: true
---

# Deprecated — use `shipeasy setup triggers`

Provisioning an automation trigger is no longer a skill-driven flow. The CLI now
owns it end-to-end:

```bash
shipeasy setup triggers                       # pick a platform, opens the hosted wizard
shipeasy setup triggers --platform claude     # preselect a platform (claude|codex|cursor|copilot|gemini|jules)
```

`shipeasy setup` also offers this as an inline step (accept the "Set up an
automation trigger now?" prompt, or pass `--triggers --trigger-platform <id>`).

**What to do when this skill is invoked:** run `shipeasy setup triggers` yourself
via the Bash tool (never tell the user to run it). It explains what a trigger is,
has the user pick the platform they code with, and opens the hosted, guided setup
wizard —

```
https://shipeasy.ai/dashboard/<PROJECT_ID>/triggers?provider=<platform>
```

— which walks the user through that platform's exact fields, secrets, and network
settings. `<PROJECT_ID>` comes from `.shipeasy` / `shipeasy projects current`;
`jules` is accepted as an alias for `gemini`.

## Why it moved

A trigger is a scheduled agent run that burns down the feedback queue (bugs,
feature requests, auto-filed error/alert tickets) and opens **one PR per fixed
item** — nothing merges without you. The provider-specific provisioning (mint the
ops key, register the connector, pick the cron) is the same work the hosted wizard
(`apps/ui/src/components/triggers/trigger-setup.tsx`) already does with a single
screen per platform, so the CLI just routes the user there instead of an agent
re-deriving each provider's steps.

The per-provider reference material under [`references/`](references/) is retained
only as the spec the hosted wizard is kept in sync with — it is not a runbook to
follow by hand anymore.
