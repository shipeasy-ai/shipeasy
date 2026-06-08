---
description: Enable the feedback module + error collection, verify the devtools overlay and error capture, and drop a project pointer skill for bug reports, feature requests, and production errors
---

Run the ops-module setup for Shipeasy — the in-app feedback overlay
(bug reports + feature requests), auto-collected production errors, and
metric-threshold alerts. This is one of the three install sections
(`ops` / `flags` / `i18n`) and is the single feedback install — it
replaces the old per-feature `/shipeasy:bugs:install`.

Prereq: `/shipeasy:setup` already ran successfully and `.shipeasy`
exists at the repo root.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run `/shipeasy:setup` first.

2. Enable the feedback module:

   ```bash
   shipeasy modules enable feedback
   shipeasy modules list      # expect: feedback ✓
   ```

3. Verify the devtools overlay (the same overlay end users use to submit
   reports). `getBootstrapHtml()` lazily injects `se-devtools.js` when
   the URL contains `?se` / `?se_devtools`. Confirm by loading any page
   with `?se=1` appended.

   If the panel never appears, base setup is incomplete — send the user
   back to `/shipeasy:setup` to render `getBootstrapHtml()` into `<head>`.

4. **Set up error collection (ask the user first).** Error collection
   rides the **events system**: the client SDK's `autoCollect` errors
   group hooks `window.onerror` + `unhandledrejection` and wraps `fetch`,
   shipping `__auto_js_error` and `__auto_network_error` (5xx + network
   failures) to `/collect`. Those fold into the project's tracked-errors
   inbox, viewable read-only via `shipeasy ops.errors`.

   This group is **on by default** the moment the client SDK is
   initialised (`shipeasy({ clientKey })` from `/shipeasy:setup`), and
   the `events` module is on by default too — so there's nothing extra to
   enable for the happy path. Ask the user whether they want production
   error collection on:
   - **Keep it on (default):** confirm the client `shipeasy({ clientKey })`
     call has no `autoCollect: { errors: false }` override, then verify
     capture once events flow in:

     ```bash
     shipeasy ops.errors list        # [] until the first error lands; never 403
     ```

   - **Opt out:** narrow the client init to disable just that group,
     leaving vitals + engagement intact:

     ```ts
     // a "use client" component, once at startup
     shipeasy({ clientKey, autoCollect: { errors: false } });
     ```

   Do not add a separate error-reporting SDK, wrapper, or `init` call —
   error collection is part of the same SDK and the same `shipeasy()`
   entry point (see the SDK design rules).

5. Smoke-test the CLI mirror:

   ```bash
   shipeasy feedback bugs list           # returns [] or rows, never 403
   shipeasy feedback features list
   shipeasy ops.errors list              # read-only tracked errors
   ```

6. **Drop the project pointer skill.** Write the file below to
   `<repo-root>/.claude/skills/shipeasy-bugs/SKILL.md` via the Write
   tool (create the directory if missing). Do **not** overwrite an
   existing file unless the user asked for a refresh.

   ````markdown
   ---
   name: shipeasy-bugs
   description: Project pointer — Shipeasy feedback module is enabled here. Triggers on "bug report", "feature request", "feedback", "user-reported issue", "report a bug", "production error".
   ---

   # Shipeasy bug reports, feature requests + errors (project pointer)

   This project has the Shipeasy `feedback` module enabled and
   auto-collects production errors through the events system. The full
   skill lives in the `shipeasy` Claude Code plugin.

   ## With plugin installed

   - Skill: `shipeasy-bugs`
   - Commands: `/shipeasy:ops:report`, `/shipeasy:ops:list`, `/shipeasy:ops:work`, `/shipeasy:ops:install`

   ## Without the plugin

   ```bash
   claude plugin marketplace add shipeasy-ai/shipeasy
   claude plugin install shipeasy@shipeasy
   /shipeasy:setup            # if not already onboarded
   /shipeasy:ops:install        # enables feedback + error collection + verifies overlay
   /shipeasy:ops:list           # list bugs / features / errors / alerts (--type filter)
   /shipeasy:ops:work           # burn down bugs + features + errors + alerts, one-by-one
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

   shipeasy ops.errors list              # auto-tracked production errors (read-only)
   shipeasy ops.errors get <id>
   ```

   Status lifecycle: `open → triaged → in_progress → ready_for_qa →
   resolved` (or `wont_fix`). Developers flip to `ready_for_qa` after
   the fix; QA flips to `resolved` after dashboard verification.

   The in-page overlay opens on any URL with `?se=1` appended (requires
   `getBootstrapHtml()` rendered into `<head>` by base setup). Error
   collection is on by default via the client SDK's `autoCollect` errors
   group — disable with `shipeasy({ clientKey, autoCollect: { errors: false } })`.
   ````

7. Print the hand-off:

   ```
   ✅ shipeasy ops setup complete
   Module:   feedback ✓   (events on by default → error collection)
   Wired:    devtools overlay (?se=1 on any page rendering getBootstrapHtml)
             auto error capture (__auto_js_error / __auto_network_error → /collect)
   Pointer:  .claude/skills/shipeasy-bugs/SKILL.md
   Next:     /shipeasy:ops:report bug "<title>"  — file a single bug/feature
             /shipeasy:ops:list --type bug       — list bugs/features/errors/alerts
             /shipeasy:ops:work                  — burn down bugs+features+errors+alerts
             shipeasy ops.errors list            — triage tracked production errors
             or have end users submit via the in-page Report panel.
   ```
