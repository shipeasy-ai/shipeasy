# Moved

The per-platform trigger install runbook is served by the CLI / MCP server so
it always matches the shipped tooling:

```bash
shipeasy trigger guide [--provider <name>]   # MCP tool: trigger_guide
```

Run with no flag to auto-detect the calling agent. Also published at
<https://docs.shipeasy.ai/get-started/triggers>. The `shipeasy-ops-trigger`
skill drives the full provisioning flow.
