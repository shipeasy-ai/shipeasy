---
description: Enable the translations module, create the en:prod profile, and (if needed) inject the loader script
---

Run the per-plugin setup for `shipeasy@polylang`. Prereq: `shipeasy@base`
is already installed and `.shipeasy` exists.

Steps:

1. Confirm base is in place:

   ```bash
   test -f .shipeasy && shipeasy whoami | grep -q "Bound dir" && echo OK
   ```

   If the check fails, stop and tell the user to run
   `claude plugin install shipeasy@base` + `/shipeasy-setup` first.

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
   `getBootstrapHtml()` (Pages Router, plain HTML, Vite, …). For canonical
   Next.js App Router projects, skip it; the bootstrap already injects the
   loader.

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

6. Print the per-plugin hand-off:
   ```
   ✅ shipeasy@polylang setup complete
   Module:    translations ✓
   Profile:   en:prod (en)
   Next:      Use the `shipeasy-i18n` skill or `/shipeasy-i18n-extract`
              to wrap hardcoded copy and push keys.
   ```
