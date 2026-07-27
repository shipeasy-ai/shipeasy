# Moved

Trigger setup now lives in the CLI. Run:

```bash
shipeasy setup triggers                     # pick a platform, opens its guided setup
shipeasy setup triggers --platform claude   # preselect (claude|codex|cursor|copilot|gemini|jules)
```

`shipeasy setup` also offers it as an inline step. The command opens the
platform's onboarding modal on the dashboard's Triggers tab
(`/dashboard/<projectId>/settings?tab=triggers&onboard=<platform>`), which walks
you through the platform-specific fields and secrets — the same surface that
manages the trigger afterwards.

The low-level connector plumbing is still available under
`shipeasy ops trigger create <provider> --help` and `shipeasy ops trigger prep`,
and the reference is published at <https://docs.shipeasy.ai/get-started/triggers>.
(The old `shipeasy-ops-trigger` skill has been removed — `shipeasy setup triggers`
replaces it.)
