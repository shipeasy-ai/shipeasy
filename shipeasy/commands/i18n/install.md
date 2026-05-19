---
description: Enable the translations module, create the en:prod profile, install the loader if needed, and drop a project pointer skill
---

Run the i18n / translations module setup. Prereq: `/shipeasy:install`
already ran and `.shipeasy` exists.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run `/shipeasy:install` first.

2. Enable the module:

   ```bash
   shipeasy modules enable translations
   shipeasy modules list      # expect: translations ✓
   ```

3. Create the primary profile (the CLI does **not** auto-create):

   ```bash
   shipeasy i18n profiles list
   shipeasy i18n profiles create en:prod --locales en   # only if missing
   ```

   **Use `en:prod`.** It matches the default `getBootstrapHtml()` and
   server-SSR string fetch — anything else needs a manual override.

4. Loader script — only run this if the project does **not** render
   `getBootstrapHtml()` (Pages Router, plain HTML, Vite without
   bootstrap). For canonical Next.js App Router projects, skip it.

   ```bash
   shipeasy i18n install-loader --profile en:prod
   ```

5. Smoke-test the wrap-and-push flow with a single key:

   ```bash
   echo '{"smoke.test":"Smoke test value"}' > /tmp/se-smoke.json
   shipeasy i18n push /tmp/se-smoke.json --profile en:prod
   shipeasy i18n publish --profile en:prod
   rm /tmp/se-smoke.json
   ```

6. **Drop the project pointer skill** to
   `<repo-root>/.claude/skills/shipeasy-i18n/SKILL.md` via the Write
   tool. Do **not** overwrite an existing file unless the user asked
   for a refresh.

   ````markdown
   ---
   name: shipeasy-i18n
   description: Project pointer — Shipeasy translations are enabled here. Triggers on "translate", "i18n", "add a key", "make this translatable", or any request involving user-facing copy.
   ---

   # Shipeasy i18n / translations (project pointer)

   This project has the Shipeasy `translations` module enabled. The full
   skill lives in the `shipeasy` Claude Code plugin.

   ## With plugin installed

   - Skill: `shipeasy-i18n`
   - Commands: `/shipeasy:i18n:install`, `/shipeasy:i18n:extract`, `/shipeasy:i18n:migrate`

   ## Without the plugin

   ```bash
   claude plugin marketplace add shipeasy-ai/shipeasy
   claude plugin install shipeasy@shipeasy
   /shipeasy:install              # if not already onboarded
   /shipeasy:i18n:install         # enables translations + creates en:prod profile
   ```

   Cursor / Windsurf / non-Claude harness:

   ```bash
   npx @shipeasy/cli plugin install
   ```

   ## Doing the workflow by hand

   Wrap a string:

   ```tsx
   import { i18n } from "@shipeasy/sdk/client";
   <button>{i18n.t("landing.nav.cta", "Install with Claude")}</button>;
   ```

   Bulk extract + push (idempotent):

   ```bash
   shipeasy codemod i18n              # auto-detects src/app dirs
   shipeasy i18n push <generated-json> --profile en:prod --chunk default
   shipeasy i18n publish              --profile en:prod --chunk default
   ```

   Key naming: `<chunk>.<component>.<element>` (e.g. `landing.hero.title`).
   Variables: `i18n.t("k", "Hi {{name}}", { name: "Ada" })`.

   Migrate from another lib: `shipeasy codemod i18n --migrate react-i18next`
   (also: `react-intl`, `lingui`, `next-intl`, `raw-i18next`).
   ````

7. Print the hand-off:

   ```
   ✅ shipeasy i18n setup complete
   Module:   translations ✓
   Profile:  en:prod (en)
   Pointer:  .claude/skills/shipeasy-i18n/SKILL.md
   Next:     /shipeasy:i18n:extract to wrap hardcoded copy and push keys.
   ```
