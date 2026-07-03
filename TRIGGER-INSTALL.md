# Moved

Trigger setup now lives in the CLI. Run:

```bash
shipeasy setup triggers                     # pick a platform, opens the hosted guided wizard
shipeasy setup triggers --platform claude   # preselect (claude|codex|cursor|copilot|gemini|jules)
```

`shipeasy setup` also offers it as an inline step. The command opens the hosted,
guided setup wizard (`/dashboard/<projectId>/triggers?provider=<platform>`),
which walks you through the platform-specific fields and secrets.

The low-level connector plumbing is still available under
`shipeasy ops trigger create <provider> --help` and `shipeasy ops trigger prep`,
and the reference is published at <https://docs.shipeasy.ai/get-started/triggers>.
(The old `shipeasy-ops-trigger` skill has been removed — `shipeasy setup triggers`
replaces it.)
