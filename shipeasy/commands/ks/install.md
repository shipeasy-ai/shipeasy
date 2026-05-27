---
description: Verify killswitches are reachable on the bound project (no separate module toggle)
---

Per-feature install for `ks` (killswitches). Prereq: `/shipeasy:setup`
already run and `.shipeasy` exists.

Killswitches are a standalone admin resource — there is **no per-killswitch
module toggle**. They ride in the same KV blob configs publish through,
so enabling `/shipeasy:configs:install` is recommended if not already
done. This command only verifies the admin path.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

2. Smoke-test the admin path:

   ```bash
   shipeasy ks list           # [] or rows, never 403
   ```

3. Print the hand-off:

   ```
   ✅ kill switches ready
   Next:    /shipeasy:ks:create <folder.name>   # first killswitch.
            For runtime code-path gating, use /shipeasy:flags:create.
   ```
