---
description: Enable the feedback module, verify the devtools overlay, and drop a project pointer skill for bug reports + feature requests
---

Run the feedback-module setup for Shipeasy. Prereq: `/shipeasy:install`
already ran successfully and `.shipeasy` exists at the repo root.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run `/shipeasy:install` first.

2. Enable the module:

   ```bash
   shipeasy modules enable feedback
   shipeasy modules list      # expect: feedback ✓
   ```

3. Verify the devtools overlay (the same overlay end users use to submit
   reports). `getBootstrapHtml()` lazily injects `se-devtools.js` when
   the URL contains `?se` / `?se_devtools`. Confirm by loading any page
   with `?se=1` appended.

   If the panel never appears, base setup is incomplete — send the user
   back to `/shipeasy:install` to render `getBootstrapHtml()` into `<head>`.

4. Smoke-test the CLI mirror:

   ```bash
   shipeasy feedback bugs list           # returns [] or rows, never 403
   shipeasy feedback features list
   ```

5. **Drop the project pointer skill.** Write the file below to
   `<repo-root>/.claude/skills/shipeasy-bugs/SKILL.md` via the Write
   tool (create the directory if missing). Do **not** overwrite an
   existing file unless the user asked for a refresh.

   ````markdown
   ---
   name: shipeasy-bugs
   description: Project pointer — Shipeasy feedback module is enabled here. Triggers on "bug report", "feature request", "feedback", "user-reported issue", "report a bug".
   ---

   # Shipeasy bug reports + feature requests (project pointer)

   This project has the Shipeasy `feedback` module enabled. The full
   skill lives in the `shipeasy` Claude Code plugin.

   ## With plugin installed

   - Skill: `shipeasy-bugs`
   - Commands: `/shipeasy:bugs:bug`, `/shipeasy:bugs:fix`, `/shipeasy:bugs:install`

   ## Without the plugin

   ```bash
   claude plugin marketplace add shipeasy-ai/shipeasy
   claude plugin install shipeasy@shipeasy
   /shipeasy:install            # if not already onboarded
   /shipeasy:bugs:install       # enables feedback + verifies overlay
   ```

   Cursor / Windsurf / non-Claude harness:

   ```bash
   npx @shipeasy/cli plugin install
   ```

   ## Doing the workflow by hand

   ```bash
   shipeasy modules enable feedback

   shipeasy feedback bugs create "Title" --description "what / where / repro"
   shipeasy feedback bugs list --status open --json
   shipeasy feedback bugs update <id> --status in_progress
   shipeasy feedback bugs update <id> --status ready_for_qa
   shipeasy feedback features create "Title" --description "…"
   shipeasy feedback features list
   ```

   Status lifecycle: `open → triaged → in_progress → ready_for_qa →
   resolved` (or `wont_fix`). Developers flip to `ready_for_qa` after
   the fix; QA flips to `resolved` after dashboard verification.

   The in-page overlay opens on any URL with `?se=1` appended (requires
   `getBootstrapHtml()` rendered into `<head>` by base setup).
   ````

6. Print the hand-off:

   ```
   ✅ shipeasy bugs setup complete
   Module:   feedback ✓
   Wired:    devtools overlay (?se=1 on any page rendering getBootstrapHtml)
   Pointer:  .claude/skills/shipeasy-bugs/SKILL.md
   Next:     /shipeasy:bugs:bug "<title>"   — file a single report
             /shipeasy:bugs:fix             — burn down the open queue
             or have end users submit via the in-page Report panel.
   ```
