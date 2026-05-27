---
description: Delete a Shipeasy killswitch
argument-hint: "<switch-name>"
---

Delete a killswitch resource. Killswitches have no public SDK reader,
so deletion only affects admin tooling + the `killswitches` map in the
published KV blob.

```
mcp tool: exp_delete_killswitch { "name": "<folder.name>" }
```

CLI fallback: `shipeasy ks delete <folder.name>`.

If you needed the killswitch to gate runtime code, you were using the
wrong primitive — see `/shipeasy:flags:create` for SDK-readable
on/off gating.
