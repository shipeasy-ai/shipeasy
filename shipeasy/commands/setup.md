---
description: Run the Shipeasy base install — SDK, auth, project bind, keys, root-layout init, MCP registration.
argument-hint: "[--domain <production-domain>]"
---

Run end-to-end Shipeasy base onboarding. Follow the `setup` skill step
by step. Do not skip the verification gates.

Hard rules:

- **Use the Bash tool for every CLI command.** Don't ask the user to run
  `shipeasy login`, `pnpm add ...`, etc. The MCP server cannot do
  browser flows over stdio; the Bash tool can. Run the commands.
- **`shipeasy login` opens a browser** — spawn it via Bash, wait for the
  CLI to exit 0 (user clicks "Authorize" in the browser), continue.
- **Handle monorepos.** Detect every subproject (frontend + backend +
  service dirs, etc.). One `.shipeasy` lives at the monorepo root;
  per-subproject SDK installs run inside each subproject's dir.

Steps in brief (full detail in the skill):

1. Preconditions: Node ≥20, inside a git repo.
2. **Detect subprojects** — scan for `package.json`, `pyproject.toml`,
   `Gemfile`, `go.mod`, `pom.xml`, `composer.json`, `Package.swift`,
   `build.gradle*`. Classify by language (only JS has a published SDK
   today; flag the rest for manual follow-up).
3. `shipeasy login` (via Bash) at the monorepo root. Browser opens; user
   picks an existing project or fills in name + production domain to
   create a new one. CLI auto-writes `.shipeasy` on return. Commit it.
4. `shipeasy keys create --type server` + `--type client` — same pair
   used by every subproject.
5. For each JS subproject: `cd <dir> && pnpm add @shipeasy/sdk [@shipeasy/react]`,
   persist keys to that subproject's `.env.local` (or its detected
   secret store).
6. For each JS entry point: add the single `await shipeasy({...})` call
   (root layout / `main.tsx` / `src/server.ts` depending on framework).
   For Next.js App Router also render `getBootstrapHtml()` into `<head>`.
7. Verify: `shipeasy whoami`, `shipeasy keys list`, per-subproject build.
8. Print the hand-off report and stop. **Do not run `git commit`.**

When done, point the user at the three install sections:

```
/shipeasy:flags:install   # gates + configs + kill switches + experiments + events
/shipeasy:ops:install     # feedback (bugs + feature requests) + errors + alerts
/shipeasy:i18n:install    # translations
```
