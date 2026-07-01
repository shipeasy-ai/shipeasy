---
name: i18n-install
description: Enable the translations module, create the en:prod profile, and (if needed) inject the loader script
user-invocable: true
---

Per-feature install for `i18n` (translations).

**The module enable + profile creation is now a pure CLI command** — the logic
lives in the binary (`shipeasy install i18n`), which enables the `translations`
module, ensures the primary profile exists, and verifies the admin path. Run it
with the **Bash tool**. The only thing the binary can't decide is whether your
project needs the loader script (step 3) — that's the one judgment this command
keeps.

> **First, update before you debug.** An `unknown command` here is almost
> always version drift (`shipeasy install` needs `@shipeasy/cli` ≥ 2.2.0).
> Update and retry once: `npm i -g @shipeasy/cli@latest`, and refresh the
> plugin: `/plugin marketplace update shipeasy`.

## Steps

1. Confirm the base is in place. If this fails, stop and tell the user to run
   `/shipeasy:setup` first:

   ```bash
   shipeasy root >/dev/null 2>&1 && echo OK   # a .shipeasy is bound at or above cwd
   ```

2. Run the installer (uses `en:prod` by default — it matches the default
   bootstrap + server-SSR string fetch; anything else needs a manual override):

   ```bash
   shipeasy install i18n
   ```

   This enables `translations`, creates the `en:prod` profile if missing, and
   verifies the profiles endpoint. Relay its output; a non-zero exit means the
   module didn't enable — surface the error.

3. **Loader script — only if the project does NOT render the default
   bootstrap** (Pages Router, plain HTML, Vite, …). For canonical Next.js App
   Router projects, skip it; the bootstrap already injects the loader. The CLI
   auto-detects the framework and injects into the right file:

   ```bash
   shipeasy i18n install-loader --profile en:prod
   ```

   Use `--print` to see the tag without writing, or `--path <file>` to target a
   specific entry file.

4. Smoke-test the wrap-and-push flow with a single key (optional):

   ```bash
   echo '{"smoke.test":"Smoke test value"}' > /tmp/se-smoke.json
   shipeasy i18n push /tmp/se-smoke.json --profile en:prod
   shipeasy i18n publish --profile en:prod
   rm /tmp/se-smoke.json
   ```

## Next

Use `/shipeasy:i18n:extract` to wrap hardcoded copy and push keys, or the
`i18n` skill for guided edits.
