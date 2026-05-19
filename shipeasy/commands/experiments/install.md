---
description: Enable the experiments module, smoke-test assignment, and drop a project pointer skill for A/B tests
---

Run the A/B-experiments module setup. Prereq: `/shipeasy:install` already
ran and `.shipeasy` exists.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run `/shipeasy:install` first.

2. Enable the module:

   ```bash
   shipeasy modules enable experiments
   shipeasy modules list      # expect: experiments ✓
   ```

3. Smoke-test the assignment endpoint from a server context:

   ```ts
   import { experiments } from "@shipeasy/sdk/server";
   const { group } = await experiments.assign("smoke-test", { user_id: "anon" });
   console.log({ group }); // returns the default group; no experiment exists yet
   ```

4. **Drop the project pointer skill** to
   `<repo-root>/.claude/skills/shipeasy-experiments/SKILL.md` via the
   Write tool. Do **not** overwrite an existing file unless the user
   asked for a refresh.

   ````markdown
   ---
   name: shipeasy-experiments
   description: Project pointer — Shipeasy experiments module is enabled here. Triggers on "A/B test", "experiment", "split test", "holdout", "metric significance".
   ---

   # Shipeasy A/B experiments (project pointer)

   This project has the Shipeasy `experiments` module enabled. The full
   skill lives in the `shipeasy` Claude Code plugin.

   ## With plugin installed

   - Skill: `shipeasy-experiments`
   - Commands: `/shipeasy:experiments:experiment`, `/shipeasy:experiments:install`

   ## Without the plugin

   ```bash
   claude plugin marketplace add shipeasy-ai/shipeasy
   claude plugin install shipeasy@shipeasy
   /shipeasy:install                  # if not already onboarded
   /shipeasy:experiments:install
   ```

   Cursor / Windsurf / non-Claude harness:

   ```bash
   npx @shipeasy/cli plugin install
   ```

   ## Doing the workflow by hand

   ```bash
   shipeasy modules enable experiments

   shipeasy experiments create --help
   shipeasy experiments start  <name>
   shipeasy experiments status <name>
   shipeasy experiments stop   <name>
   ```

   Read from SDK:

   ```ts
   import { experiments } from "@shipeasy/sdk/server";
   const { group, params } = await experiments.assign("checkout_button_v2", {
     user_id,
     country,
   });
   ```

   **Design rules.** Universe owns holdouts + mutual exclusion (not the
   experiment). Always include a `control`. Pre-register one success
   metric — don't add metrics post-hoc. After `stop`, don't relaunch
   under the same name (assignment hash changes and re-randomizes users).
   ````

5. Print the hand-off:

   ```
   ✅ shipeasy experiments setup complete
   Module:   experiments ✓
   Pointer:  .claude/skills/shipeasy-experiments/SKILL.md
   Next:     /shipeasy:experiments:experiment <name> or use the shipeasy-experiments skill.
   ```
