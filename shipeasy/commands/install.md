---
description: Run the Shipeasy base install — SDK, auth, project bind, keys, root-layout init, MCP registration. Required before any feature install.
argument-hint: "[--domain <production-domain>]"
---

Run end-to-end Shipeasy base onboarding. Follow the `shipeasy-setup` skill
step by step. Do not skip the verification gates.

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

8. **Drop a project-level pointer skill so future contributors can re-run
   the onboarding without already having the plugin installed.** Write
   the file below to `<repo-root>/.claude/skills/shipeasy-setup/SKILL.md`
   via the Write tool (create the directory if missing). Do **not**
   overwrite an existing file unless the user asked for a refresh.

   ````markdown
   ---
   name: shipeasy-setup
   description: Project pointer — Shipeasy is integrated here. Triggers on "set up shipeasy", "onboard shipeasy", "shipeasy install", "new contributor shipeasy".
   ---

   # Shipeasy is integrated in this repo

   This project uses Shipeasy. The full onboarding skill lives in the
   `shipeasy` Claude Code plugin. This file is just a pointer so new
   contributors and fresh checkouts can find their way without already
   having the plugin loaded.

   ## If you already have the plugin

   Run `/shipeasy:install` or invoke the `shipeasy-setup` skill.

   ## If the plugin is not installed yet

   ```bash
   claude plugin marketplace add shipeasy-ai/shipeasy
   claude plugin install shipeasy@shipeasy
   /shipeasy:install
   ```

   Cursor / Windsurf / non-Claude harness:

   ```bash
   npx @shipeasy/cli plugin install
   ```

   Either path drops the skills + commands into `.claude/`.

   ## What `/shipeasy:install` does

   - Authenticates the developer (`shipeasy login` — opens a browser).
   - Reuses or creates the bound Shipeasy project recorded in `.shipeasy`
     at the repo root (do not delete this file).
   - Mints fresh server + client SDK keys, persists them to each
     subproject's `.env.local` (or detected secret store).
   - Wires `shipeasy({...})` into the entry point of each JS subproject.

   ## Feature add-ons

   After base is in place, run any of:

   - `/shipeasy:bugs:install` — in-app bug reports
   - `/shipeasy:flags:install` — feature gates, configs, kill switches
   - `/shipeasy:experiments:install` — A/B experiments + metrics
   - `/shipeasy:i18n:install` — translations
   ````

9. Print the hand-off report and stop. **Do not run `git commit`.**

When done, tell the user which feature install commands to run next:

```
/shipeasy:experiments:install   # A/B tests + metrics
/shipeasy:flags:install         # feature gates + configs + killswitches
/shipeasy:i18n:install          # translations
/shipeasy:bugs:install          # in-app bug reports
```
