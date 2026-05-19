---
description: Enable the gates + configs modules, smoke-test the read path, and drop a project pointer skill for feature flags
---

Run the gates/configs/killswitches module setup. Prereq:
`/shipeasy:install` already ran and `.shipeasy` exists.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run `/shipeasy:install` first.

2. Enable the modules (independent toggles — enable what you need):

   ```bash
   shipeasy modules enable gates
   shipeasy modules enable configs
   shipeasy modules list      # expect: gates ✓ configs ✓
   ```

   (Kill switches reuse the `gates` module; no separate toggle.)

3. Smoke-test the read path from a server context:

   ```ts
   import { gates, configs } from "@shipeasy/sdk/server";
   console.log(await gates.check("smoke-test")); // false (no such gate)
   console.log(await configs.get("smoke-config", "fallback")); // "fallback"
   ```

4. **Drop the project pointer skill** to
   `<repo-root>/.claude/skills/shipeasy-flags/SKILL.md` via the Write
   tool. Do **not** overwrite an existing file unless the user asked
   for a refresh.

   ````markdown
   ---
   name: shipeasy-flags
   description: Project pointer — Shipeasy gates + configs are enabled here. Triggers on "feature flag", "feature gate", "rollout", "kill switch", "dynamic config", "remote config".
   ---

   # Shipeasy feature gates + configs (project pointer)

   This project has the Shipeasy `gates` and `configs` modules enabled.
   The full skill lives in the `shipeasy` Claude Code plugin.

   ## With plugin installed

   - Skill: `shipeasy-flags`
   - Commands: `/shipeasy:flags:flag`, `/shipeasy:flags:install`

   ## Without the plugin

   ```bash
   claude plugin marketplace add shipeasy-ai/shipeasy
   claude plugin install shipeasy@shipeasy
   /shipeasy:install            # if not already onboarded
   /shipeasy:flags:install      # enables gates + configs
   ```

   Cursor / Windsurf / non-Claude harness:

   ```bash
   npx @shipeasy/cli plugin install
   ```

   ## Doing the workflow by hand

   ```bash
   shipeasy modules enable gates
   shipeasy modules enable configs

   shipeasy flags create --name checkout_v2 --percent 0
   shipeasy flags list
   shipeasy flags update checkout_v2 --percent 25
   ```

   Read from SDK:

   ```ts
   import { gates, configs } from "@shipeasy/sdk/server"; // or /client
   if (await gates.check("checkout_v2", { user_id })) {
     /* new path */
   }
   const ranking = await configs.get("search_ranking", { country });
   ```

   **Rollout pattern.** Start at `rollout_percent: 0`, default `false`
   (safe path on KV failure). Ramp 5 → 25 → 50 → 100 manually. Once at
   100% for a full deploy cycle, remove the gate from code, then
   `shipeasy flags archive <name>`.

   **Kill switch.** Create a separate `kill_<feature>` gate defaulting
   **on** that guards the old path. Flip off if the new path breaks.
   ````

5. Print the hand-off:

   ```
   ✅ shipeasy flags setup complete
   Modules:  gates ✓ configs ✓
   Pointer:  .claude/skills/shipeasy-flags/SKILL.md
   Next:     /shipeasy:flags:flag <name> [percent] or use the shipeasy-flags skill.
   ```
