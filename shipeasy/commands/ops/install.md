---
description: Enable the feedback module + error collection, verify the devtools overlay and error capture, drop project pointer skills (feedback + see() error reporting), and add the CLAUDE.md error-handling rule
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

4. **Set up error collection (ask the user first).** Error collection is
   the **errors primitive** (`@shipeasy/sdk` ≥ 4.0.0): the client SDK's
   `autoCollect` errors group hooks `window.onerror` +
   `unhandledrejection` and wraps `fetch` (5xx + network failures),
   shipping structured `type:"error"` events to `/collect`. Those fold
   into fingerprint-grouped issues with a near-real-time occurrence
   timeline — the Errors dashboard tab and `shipeasy ops.errors`. Handled
   exceptions are reported explicitly with `see()` (next steps).

   This group is **on by default** the moment the client SDK is
   initialised (`shipeasy({ clientKey })` from `/shipeasy:setup`) — so
   there's nothing extra to enable for the happy path. Ask the user
   whether they want production error collection on:
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
   group (reports into the errors primitive — see the `shipeasy-see`
   skill for explicit `see()` reporting in catch blocks) — disable with
   `shipeasy({ clientKey, autoCollect: { errors: false } })`.
   ````

7. **Drop the see() error-reporting pointer skill.** Write the file below
   to `<repo-root>/.claude/skills/shipeasy-see/SKILL.md` via the Write
   tool (create the directory if missing). Do **not** overwrite an
   existing file unless the user asked for a refresh. This is the
   project-local trigger for the full `see` skill that ships with the
   plugin — it makes every error-handling task in this repo route through
   the see() rules.

   ````markdown
   ---
   name: shipeasy-see
   description: Project rule — error handling in this repo uses see() from @shipeasy/sdk. Triggers on try/catch, error handling, exceptions, error logging, console.error in catch blocks, "handle this error", "add error handling".
   ---

   # see() — required error reporting (project pointer)

   This project reports errors into the Shipeasy errors primitive. Every
   handled exception documents its product consequence:

   ```ts
   import { see } from "@shipeasy/sdk/client"; // or "@shipeasy/sdk/server"

   try {
     await submitOrder(order);
   } catch (e) {
     see(e).causes_the("checkout").to("use cached prices").extras({ order_id: order.id });
   }
   ```

   - Non-exception problems: `see.Violation("name").message("…").causes_the(…).to(…)`
     — never put variable data in the name (it's the fingerprint key).
   - Expected control-flow exceptions: `see.ControlFlowException(e, "because …")`
     — reports nothing, auto-capture skips it.
   - **Never** see() then `throw` (double count) · **never** an empty catch ·
     **never** `console.error`-only handling · no PII in extras.
   - If you don't know the consequence, don't catch the exception.

   The full skill (consequence-writing guide, anti-patterns, examples) is
   `see` in the `shipeasy` Claude Code plugin:

   ```bash
   claude plugin marketplace add shipeasy-ai/shipeasy
   claude plugin install shipeasy@shipeasy
   ```

   Triage the resulting issues with `/shipeasy:ops:list --type error` and
   `/shipeasy:ops:work`, or in the dashboard Errors tab.
   ````

8. **Add the CLAUDE.md error-handling rule (ask once, default yes).**
   Append the block below to the repo-root `CLAUDE.md` (create the file
   if missing). Skip if a `see()` rule is already present — never
   duplicate it. This is what makes Claude wrap error handling in see()
   on every future task, not just when the skill happens to trigger:

   ```markdown
   ## Error handling

   **HARD RULE: every handled exception is reported with `see()` from
   `@shipeasy/sdk` (client or server entrypoint).** A catch block that
   swallows, logs to console only, or rethrows after reporting is wrong:

   - Handle it → `see(e).causes_the(<subject>).to(<outcome>).extras({…})`
   - Expected control flow → `see.ControlFlowException(e, "because …")`
   - Can't name the consequence → don't catch; let an outer boundary own it
   - Never `see()` then `throw` — either handle or rethrow, never both

   See `.claude/skills/shipeasy-see/SKILL.md` for the full rules.
   ```

9. Print the hand-off:

   ```
   ✅ shipeasy ops setup complete
   Module:   feedback ✓   (events on by default → error collection)
   Wired:    devtools overlay (?se=1 on any page rendering getBootstrapHtml)
             auto error capture (uncaught/unhandled/network → errors primitive)
   Pointer:  .claude/skills/shipeasy-bugs/SKILL.md
             .claude/skills/shipeasy-see/SKILL.md
   Rule:     CLAUDE.md — handled exceptions must use see()
   Next:     /shipeasy:ops:report bug "<title>"  — file a single bug/feature
             /shipeasy:ops:list --type error     — list bugs/features/errors/alerts
             /shipeasy:ops:work                  — burn down bugs+features+errors+alerts
             shipeasy ops.errors list            — triage tracked production errors
             or have end users submit via the in-page Report panel.
   ```

10. **Offer the follow-on setup (ask the user).** The module is wired, but
    two high-value steps still need a decision. Call **AskUserQuestion**
    with `multiSelect: true` so the user can pick either, both, or neither:

    - **Question:** "Ops module is installed. What would you like to set up
      next?" (header: `Next steps`)
    - **Option A — "Wrap errors in see()"**: walk the project's handled
      exceptions (try/catch blocks, swallowed catches, `console.error`-only
      handlers) and report each through `see()` per the `shipeasy-see`
      rules. Description: "Audit catch blocks across the project and add
      see() consequence reporting to every handled exception. Docs:
      https://docs.shipeasy.ai/feedback/error-reporting"
    - **Option B — "Configure alerts"**: description "Survey the project,
      propose a few alert rules, then build each end-to-end (event → metric
      → alert) and wire the events. Docs:
      https://docs.shipeasy.ai/feedback/alerts"

    Include the matching docs link in each option's `description` exactly as
    above so the user can read what the step does before choosing.

    Act on whatever the user selects (do nothing for options they leave
    unchecked):

    - **If "Wrap errors in see()" is selected:** invoke the `see` skill and
      sweep the codebase for handled exceptions, applying `see()` reporting
      per its rules (handle → `causes_the().to().extras()`; control flow →
      `see.ControlFlowException`; never see()-then-throw, never empty
      catch, never console-only). Do not touch boundaries that already
      report (withAdmin/errorResponse, client auto-capture, SectionBoundary,
      the client-error sink) — only swallowed / control-flow catches.

    - **If "Configure alerts" is selected:** first read the project to
      understand what's worth watching (error volume, latency/5xx on the SDK
      hot path, cron/queue outcomes, key user actions), then propose **3–5
      concrete alert rules** to the user (metric + comparator + threshold +
      window + severity for each) and let them confirm or trim the set. For
      each confirmed alert, build the whole chain with the shipeasy CLI:
      1. ensure the backing **event** is emitted from the code (instrument
         it where it isn't already — wire the events);
      2. create the **metric** over that event
         (`shipeasy metrics create …`, see `/shipeasy:metrics:grammar` for
         the DSL);
      3. create the **alert rule** on that metric
         (`shipeasy alerts create …` / `/shipeasy:alerts:create`).
      Confirm each rule lands with `shipeasy alerts list`.
