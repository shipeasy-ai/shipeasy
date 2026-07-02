# Moved

The per-platform trigger install runbook is the built-in help of the real
create command, so it always matches the shipped tooling:

```bash
shipeasy ops trigger create <provider> --help   # claude | cursor | copilot | jules (alias: gemini)
shipeasy ops trigger create <anything-else>     # prints the platform-scheduled (GitHub Actions) setup
```

Also published at <https://docs.shipeasy.ai/get-started/triggers>. The
`shipeasy-ops-trigger` skill drives the full provisioning flow.
