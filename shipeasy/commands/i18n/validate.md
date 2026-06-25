---
name: i18n-validate
description: Check that every i18n key referenced in code (i18n.t("key", …)) actually exists on the server — a CI/pre-commit drift gate
argument-hint: "[paths...] [--profile <name>]"
user-invocable: true
---

Scan source for `i18n.t("<key>", …)` references and confirm each one exists
server-side. Exits non-zero on drift, so it doubles as a pre-commit /
CI gate against "translated string renders as the raw key in prod".

Prereq: `.shipeasy` bound; `translations` module enabled
(`/shipeasy:i18n:install`).

Steps:

1. Run the check against `$ARGUMENTS` (or the whole project if no paths):

   ```bash
   shipeasy i18n validate $ARGUMENTS [--profile en:prod] --json
   ```

   - With no paths it walks the project from cwd.
   - `--profile` restricts the check to one profile; omit to check against
     all keys.
   - MCP equivalent: `i18n_validate_keys { "paths": [...] }`.

2. Read the result. `status: "ok"` → every referenced key exists; print the
   count and stop. `status: "fail"` → the `missing_keys` array lists keys in
   code that aren't on the server.

3. If keys are missing, don't hand-create them blindly — they usually mean
   the extract/push step was skipped. Offer to:
   - re-run `/shipeasy:i18n:extract` (wrap + push + publish), or
   - push a specific keys file the user points at, then publish.

4. Report: `<n> referenced, <m> missing` and the next action. Non-zero exit
   on drift is intentional — wire this into CI before the build step.
