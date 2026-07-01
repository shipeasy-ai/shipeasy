---
name: setup
description: End-to-end onboarding for Shipeasy in a target app or monorepo — detect subprojects, install SDK per subproject, authenticate, bind to a project, create keys, wire SDK into entry points, and verify. Trigger on "set up shipeasy", "install shipeasy", "onboard shipeasy", "first-time integration".
user-invocable: true
---

# Setting up Shipeasy in a target app

Walk the user through the **base** install every project needs. Do the steps
in order; each has a verification gate — don't advance past a failing gate.
Self-heal once, then escalate. The feature installs (`/shipeasy:flags:install`,
`/shipeasy:ops:install`, `/shipeasy:i18n:install`) pick up where this leaves off.

**Per-language specifics live in the `docs` MCP, not here.** Installation,
the `configure(...)` + `Client(user)` wiring, snippets, and framework
generators are pulled per SDK with `docs_get { sdk, path }` (or the
`shipeasy docs get --sdk <lang> <path>` CLI). This skill stays language-neutral
so it never goes stale; the docs are the version-correct source of truth and
**win on any conflict**.

## Operating rules

1. **Run every CLI command yourself** via your shell/Bash tool — never tell the
   user to run `shipeasy login`, `pnpm add …`, etc. themselves.
2. **`shipeasy login` is interactive but agent-runnable** — spawn it; it opens a
   browser, the user clicks Authorize, the CLI exits 0. Just run it and wait.
3. **Never `git commit`/`git push`/`npm publish`.** Stop at "ready to commit".
4. **Never log a server key.** Strip `sdk_server_*` from any output.
5. **One `.shipeasy` per project, always bound.** Each install target gets its
   own `.shipeasy` at its own root — carrying that app's `project_id` **and** its
   detected `sdk`/`language`. The nearest file wins on read, so the boundary is
   the app folder and never overshoots to the git root. Commit them. Use
   `shipeasy root` (not `git rev-parse --show-toplevel`) to resolve "the project
   root."
6. **One `configure(...)` per runtime.** No `src/lib/shipeasy.ts` wrappers.

## First fix: update before you debug

`unknown command/option`, an unexpected `400`/`404`, or a regression is usually
**version drift** — update and retry once before treating it as a bug. See the
`common` skill ("First fix: update before you debug") for the exact per-surface
update commands; the short form is `npm i -g @shipeasy/cli@latest` + restart the
MCP server.

---

## 0. Preconditions

```bash
node --version            # require >= 20 (surface, don't auto-upgrade)
git rev-parse --show-toplevel
```

Not in a repo and the dir is non-empty → ask before `git init`.

## 0b. Register the `shipeasy` MCP server if absent

Base onboarding can run through the CLI alone, but the feature skills (and the
`docs` lookups below) prefer the MCP server. If you already see `shipeasy__*`
tools, **skip this**. Otherwise register it for the current host (merge into any
existing `mcpServers`/`mcp` block — never clobber other servers); the per-host
table is in this repo's `INSTALL.md`. The common case:

```bash
claude mcp add shipeasy -- npx -y @shipeasy/mcp@latest   # Claude Code (-s user for global)
```

MCP tools load at session start, so newly-registered tools appear only after a
reload. Finish base onboarding now (it works over the CLI), and in the hand-off
tell the user to restart before the feature installs. Until then, use the
`shipeasy …` CLI (including `shipeasy docs get`) for everything.

---

## 1. Detect install targets (monorepo-aware)

Run the detector — it does the recursive scan and emits a per-folder
recommendation (language, install command, keys, secret store, `docs` handle,
next skills), so you don't re-derive any of it:

```bash
shipeasy detect            # human-readable, per folder
shipeasy detect --json     # structured — drive the rest of setup from this
```

Each target's recommendation carries an `action`: `install` (do steps 3–4 here),
`set_key` (SDK present, just mint + persist a key), `already_onboarded` (skip),
or `skip_workspace_root` / `skip_unsupported` (don't install). The `sdk` field is
exactly the value the `docs` lookups in step 4 take. Print the target list and
act only on the `install` / `set_key` folders.

`detect` also **writes** each real target's own `.shipeasy` with its
`sdk`/`language`/`frameworks` (non-destructively — never `project_id`); the
`recorded` array lists the files it touched. From now on `docs get <page>` in a
target defaults `--sdk` from that file, so you rarely pass it.

---

## 2. Authenticate + bind (per target)

Authenticate once, then bind **each install target in its own folder** so every
app carries its own `.shipeasy` (the folder that holds it IS that app's root).

```bash
shipeasy whoami    # skip login if already authed
shipeasy login     # opens browser; user picks/creates a project (idempotent on owner+domain)
# For each install/set_key target from step 1 — defaults to the session's
# project; pass a different project_id if the user wants apps kept separate:
( cd <target> && shipeasy bind )   # writes <target>/.shipeasy → project_id (preserves detect's sdk)
( cd <target> && shipeasy root )   # re-verify: prints the target dir + project + sdk
```

Verify: `shipeasy root` inside each target prints that target's own dir and a
`project_id` (detect already recorded its `sdk`). Self-heal: `401` →
`shipeasy logout && shipeasy login` (retry once); headless → `shipeasy login`
always prints the auth URL — surface it once for the user to open manually.
**One `.shipeasy` per project** — the nearest file wins, so binding a subproject
never mutates an ancestor.

---

## 3. Create SDK keys

Keys are **env-locked at mint** — `--env` (`dev|staging|prod`) is required for
`server`/`client` keys. Default to `prod`:

```bash
shipeasy i18n keys create --type server --env prod --json
shipeasy i18n keys create --type client --env prod --json   # only needed for browser targets
```

Capture each `key` (plaintext shown once), persist it in step 4, discard.
Verify with `shipeasy i18n keys list`.

---

## 4. Per target: install the SDK, persist the key, wire it up

For **each** target, pull its installation doc and follow it — it covers the
install command, the idiomatic secret store, the one `configure(...)` call, the
`Client(user)` usage, and any framework generator, all pinned to the version:

```
docs_get { "sdk": "<lang>", "path": "installation" }      # MCP
# CLI fallback: shipeasy docs get --sdk <lang> installation
```

Optionally install that SDK's own skill so future tasks have version-correct
syntax + snippets on hand: `shipeasy docs skill --sdk <lang> --install` delegates
to the `skills` CLI, which auto-detects the coding agents on the machine and lets
the user pick which to install into (`--agent <name>` to target one without the
picker). Use `docs_list { sdk }` to see every page/snippet available for a language.

Then:

1. **Install** with the project's existing package manager (don't switch
   pnpm↔npm, don't churn unrelated deps). React targets also get
   `@shipeasy/react`. If a registry is briefly down, note it and continue.
2. **Persist `SHIPEASY_SERVER_KEY`** to the target's idiomatic secret store —
   the installation doc names it per framework (e.g. `.env.local`, Rails
   encrypted credentials, `wrangler secret put`, platform env). Offer the
   detected store via `AskUserQuestion` (recommend it first, always include a
   plain-`.env` fallback) and write it only after the user picks. Browser
   targets also get the **client** key (`NEXT_PUBLIC_…`/`VITE_…`/`PUBLIC_…`).
3. **Wire** the SDK following the installation doc: one global `configure(...)`
   at startup + a user-bound `Client(user)` per evaluation. Prefer a framework
   generator when the doc lists one over hand-writing the initializer.

**Key safety:** confirm any `.env` is gitignored before staging; never echo a
server key into chat, commits, or PRs.

---

## 5. Offer the devtools overlay (ask first)

A platform-agnostic `<script>` tag — an in-page panel (`?se=1` or `Shift+Alt+S`)
that lists every gate/config/experiment/translation and lets the user flip each
**for their session only**; it's also the end-user bug/feature report surface.
Docs: https://docs.shipeasy.ai/feedback/devtools

Ask with `AskUserQuestion`. If yes:

```html
<script src="https://cdn.shipeasy.ai/se-devtools.js"
  data-client-api-key="<CLIENT_KEY>" data-project-id="<PROJECT_ID>"></script>
```

In Next.js, source `/se-devtools.js` in dev and the CDN URL in prod, and read
both attrs from `NEXT_PUBLIC_*` env (add `NEXT_PUBLIC_SHIPEASY_PROJECT_ID`).
Then `shipeasy install ops` (enables the feedback/errors module) and verify the
overlay mounts on `?se=1`.
If declined, note it in the hand-off; it can be added later via
`/shipeasy:ops:install`.

---

## 6. Drop the project pointer skill

Write `<repo-root>/.claude/skills/shipeasy-setup/SKILL.md` (don't overwrite an
existing one unless asked) so fresh checkouts can re-onboard:

````markdown
---
name: shipeasy-setup
description: Project pointer — Shipeasy is integrated here. Triggers on "set up shipeasy", "onboard shipeasy", "new contributor shipeasy".
---

# Shipeasy is integrated in this repo

Run `/shipeasy:setup` (plugin installed), or:

```bash
claude plugin marketplace add shipeasy-ai/shipeasy
claude plugin install shipeasy@shipeasy        # Claude Code / Codex / Copilot
npx skills add https://github.com/shipeasy-ai/shipeasy -a <agent>   # any other agent
```

Feature add-ons: `/shipeasy:flags:install`, `/shipeasy:ops:install`,
`/shipeasy:i18n:install`.
````

---

## 7. Final verification gate

```bash
shipeasy whoami && shipeasy i18n keys list && shipeasy projects current
( cd <target> && shipeasy root )                          # per install target — prints its dir + project + sdk
( cd <js-subproject> && (pnpm build || npm run build) )   # per JS subproject
```

Every line must pass before reporting done (`shipeasy root` must resolve inside
each target you onboarded).

---

## 8. Hand-off + feature menu

Report:

```
✅ Shipeasy base installed
Project:  <project_id>     Keys: server *…<last4>, client *…<last4>
Wired:    <subprojects + entry files>
Devtools: <enabled (?se=1) | declined>     Pointer: .claude/skills/shipeasy-setup/SKILL.md
MCP:      <live | JUST REGISTERED — restart your agent to load it>
Dashboard: https://app.shipeasy.ai/projects/<project_id>
```

If you registered the MCP server in 0b, lead with a **restart your agent now**
note before the menu. Then ask which feature installs to run with
`AskUserQuestion` (`multiSelect: true`, header `Feature installs`):

- **Flags & experiments** — gates, configs, kill switches, A/B experiments,
  event metrics. https://docs.shipeasy.ai/flags-experiments → `/shipeasy:flags:install`
- **Feedback, errors & alerts** — in-app reports, error tracking, alert rules.
  https://docs.shipeasy.ai/feedback → `/shipeasy:ops:install`
- **Translations (i18n)** — `i18n.t()` + CDN-shipped translations.
  https://docs.shipeasy.ai/translations → `/shipeasy:i18n:install`

Invoke the selected installs in order; if none, finish.

---

## 9. Ask the user to commit

```bash
git status && git diff --stat
git add <target>/.shipeasy .claude/skills/shipeasy-setup <subproject>/<manifest+lockfile> <entry-files>
git commit -m "chore: onboard Shipeasy base (SDK + auth + bind)"
```

Stage each target's own `.shipeasy` (one per onboarded app), not a single root file.

Confirm `.env*` is gitignored first. Never `git add -A`.

---

## 10. Offer the automated feedback trigger (always last)

Whatever features were picked, offer the scheduled, unattended agent that runs
`/shipeasy:ops:work --pr` on a cadence (daily/weekdays/weekly/6h), opening one PR
per item. Docs: https://docs.shipeasy.ai/feedback/connectors

Ask with `AskUserQuestion` (recommend yes). On yes, invoke
`/shipeasy:ops:create_trigger` (default `claude` provider) — it owns the whole
flow (provider auth, schedule, GitHub connection, the restricted `ops` key,
connector registration, and enabling `feedback` if needed). Never hand-roll the
schedule or the `ops` key here.
