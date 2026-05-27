---
description: Delete a Shipeasy dynamic config
argument-hint: "<config-name>"
---

Delete a config. The admin API does **not** check for call-site usage
— `configs.get` will silently fall through to the SDK-side fallback
once the config is gone.

Before deleting, verify no live call sites:

```bash
rg -n 'configs\.get\(["'\'']<name>["'\'']' .
```

If matches exist, either remove them first or leave the config in
place — deletion turns every read into a fallback-default read with no
warning.

Then:

```
mcp tool: exp_delete_config { "name": "<name>" }
```

CLI fallback: `shipeasy configs delete <name>`.
