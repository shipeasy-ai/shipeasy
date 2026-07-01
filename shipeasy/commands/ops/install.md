---
name: ops-install
description: Enable the feedback module + error collection, wire the devtools overlay and see() error reporting per the project's language docs, and add the CLAUDE.md error-handling rule. Language-agnostic — pulls the live per-language docs page rather than hard-coding any one SDK.
user-invocable: true
---

Per-project install for the **ops module** — the in-app feedback overlay
(bug reports + feature requests), auto-collected production errors, `see()`
error reporting, and metric-threshold alerts. One of the three install
sections (`ops` / `flags` / `i18n`).

This command is a **thin, language-agnostic wrapper**. It does not embed
any single SDK's snippets — it detects the project's language(s), pulls the
live docs page for each, and follows that page for the SDK lib + wiring. The
docs are the version-correct source of truth; this command never goes stale
against a particular SDK's API.

Prereq: `/shipeasy:setup` already ran successfully and `.shipeasy` exists at
the repo root (base setup installs the SDK + the one `configure(...)` boot
this builds on). If it didn't, stop and send the user to `/shipeasy:setup`.

## First fix: update before you debug

Most failures here — `unknown command` / `unknown option`, a missing
subcommand, an unexpected `400`/`404` — are **version drift**. Update to
latest and retry once before treating anything as a bug:

- **CLI:** `npm i -g @shipeasy/cli@latest` (or one-off `npx @shipeasy/cli@latest <cmd>`).
- **Plugin (skills + slash commands):** `/plugin marketplace update shipeasy`
  then `/plugin install shipeasy@shipeasy`.

---

## 1. Confirm base is in place

```bash
shipeasy root >/dev/null 2>&1 && echo OK   # a .shipeasy is bound at or above cwd
```

If the check fails, stop and tell the user to run `/shipeasy:setup` first.

---

## 2. Provision the ops module (pure CLI)

The module enable + verification is now a single binary command — run it with
the **Bash tool** and relay its output:

```bash
shipeasy install ops
```

It enables `feedback` (+ `events` for error collection) and verifies the
queue + errors admin paths are reachable (never `403`). A non-zero exit means
the module didn't enable — surface the error before continuing. No rebuild
needed; devtools picks it up on next load.

> `shipeasy install ops` needs `@shipeasy/cli` ≥ 2.2.0. On `unknown command`,
> update once (`npm i -g @shipeasy/cli@latest`) and retry — there is no
> `shipeasy modules enable` command; `shipeasy install <module>` is the only
> module enable path.

Everything below is the part the binary can't own: **wiring the SDK into your
code**, which is language- and framework-specific. That's why this stays a
skill rather than collapsing fully into the CLI.

---

## 3. Detect the project's language(s) and pull the matching docs

Base setup already recorded the install targets. Re-detect if unsure (same
scan as `/shipeasy:setup` step 1: `package.json`, `pyproject.toml`,
`Gemfile`, `go.mod`, `pom.xml`, `composer.json`, `Package.swift`,
`build.gradle*`). For **each** target, pull its per-language docs page and
follow it — do **not** hard-code snippets from memory:

| Target manifest             | Language       | Pull this docs page                         |
| --------------------------- | -------------- | ------------------------------------------- |
| `package.json` (server/Node)| node / ts      | https://docs.shipeasy.ai/sdks/node-typescript |
| `package.json` (browser/React)| browser     | https://docs.shipeasy.ai/sdks/browser-react |
| `pyproject.toml`            | python         | https://docs.shipeasy.ai/sdks/python        |
| `Gemfile`                   | ruby           | https://docs.shipeasy.ai/sdks/ruby          |
| `go.mod`                    | go             | https://docs.shipeasy.ai/sdks/go            |
| `composer.json`             | php            | https://docs.shipeasy.ai/sdks/php           |
| `pom.xml`                   | java           | https://docs.shipeasy.ai/sdks/java          |
| `build.gradle(.kts)`        | java / kotlin  | https://docs.shipeasy.ai/sdks/kotlin        |
| `Package.swift`             | swift          | https://docs.shipeasy.ai/sdks/swift         |

Each page's **"Errors & feedback"** section is the per-language source of
truth for the two ops surfaces below — `see()` error reporting (every
language) and the devtools overlay (any project with a browser surface).
Also pull the universal pages once:

- Devtools overlay (platform-agnostic `<script>` tag): https://docs.shipeasy.ai/feedback/devtools
- `see()` error reporting: https://docs.shipeasy.ai/feedback/error-reporting
- Errors dashboard & triage: https://docs.shipeasy.ai/feedback/errors

Use WebFetch to pull these. If a page is briefly unreachable, note it and
fall back to the SDK's shipped README (`/shipeasy:setup` step 4c) — never
substitute hard-coded snippets from training data.

---

## 4. Wire the devtools overlay (browser surfaces only — ask first)

The overlay is a **standalone `<script>` tag** that works on any platform
(Next.js, Rails, Django, Laravel, static HTML) — it's the same panel end
users file bug/feature reports from, and it does not require the server SDK.
Only relevant for a project with a browser-rendered surface; skip for a
headless service.

Ask before adding it (`AskUserQuestion`, single-select) — don't enable it
silently. If the user confirms, follow the **"Add the script tag"** section
of https://docs.shipeasy.ai/feedback/devtools — the current shape is:

```html
<script
  src="https://cdn.shipeasy.ai/se-devtools.js"
  data-client-api-key="YOUR_CLIENT_KEY"
  data-project-id="YOUR_PROJECT_ID"
></script>
```

Both attributes are required (the script logs a clear `console.error` and
bails if either is missing). For framework-specific placement (e.g. the
Next.js App Router `app/layout.tsx` dev-vs-prod `src`), follow the docs
page. Verify it mounts: open any page with `?se=1` appended (or press
`Shift+Alt+S`).

> The old `getBootstrapHtml()` inline loader is gone — never render it. The
> overlay is loaded by the declarative `<script>` tag above (or, inside a
> JS bundle, the SDK's `loadDevtools()` — see the browser-react docs page).

---

## 5. Error collection + see() reporting (ask before turning collection on)

Two layers, both part of the same SDK — no separate error SDK, no second key:

- **Auto-collected client errors (browser/JS only).** The client SDK's
  `autoCollect` errors group wraps `fetch` (5xx + network failures, each
  named to a specific endpoint) and ships `type:"error"` events to
  `/collect`. It's **on by default** the moment the client SDK is
  initialised — nothing extra to enable. Ask the user whether to keep it on:
  - **Keep on (default):** confirm the client init has no
    `autoCollect: { errors: false }` override.
  - **Opt out:** narrow the client init per the browser-react docs page
    (`autoCollect: { errors: false }`), leaving vitals + engagement intact.

  It does **not** blanket-capture `window.onerror` / `unhandledrejection`
  (those produced generic, unactionable issues).

- **`see()` for handled exceptions (every language).** Handled exceptions
  are reported explicitly with `see()`, which folds them into the
  fingerprint-grouped errors primitive with a product consequence. The exact
  grammar is per-language — follow the **"Errors & feedback"** section of the
  docs page you pulled in step 3 (e.g. `causes_the().to()` in Python/Ruby/JS,
  `causesThe().to()` in Go/PHP/Java/Kotlin/Swift). Don't add a separate
  error-reporting SDK or `init` call — `see()` rides the same boot.

Verify capture once events flow:

```bash
shipeasy ops list --type error  # [] until the first error lands; never 403
```

---

## 6. Smoke-test the CLI mirror (already covered by step 2)

`shipeasy install ops` (step 2) already verified the queue + errors paths are
reachable. If you want to eyeball the rows after wiring:

```bash
shipeasy ops list --type bug              # returns [] or rows, never 403
shipeasy ops list --type feature_request
shipeasy ops list --type error           # auto-filed error tickets
```

A `403` here means the module didn't enable — re-run `shipeasy install ops`.

---

## 7. Skills are installed via the generic command — do NOT hand-write them

The `ops` and `see` skills (and the rest of the platform) ship in the
**Shipeasy plugin**. Because you reached this command as a slash command,
the plugin is already installed and both skills are live — **there is
nothing to write here.** Do **not** generate `.claude/skills/*/SKILL.md`
files by hand: hand-copied skill bodies drift out of sync with the published
skills and break silently. The repo already carries the breadcrumb pointer
that base `/shipeasy:setup` drops (`.claude/skills/shipeasy-setup/SKILL.md`),
which lists every install command including this one.

If a contributor's checkout is missing the skills, they install them with
the generic, always-current command — never a hand-written copy:

```bash
# Claude Code / Codex / Copilot (native plugin → all skills incl. ops + see)
claude plugin marketplace add shipeasy-ai/shipeasy
claude plugin install shipeasy@shipeasy

# Any other agent (Cursor, Windsurf, Gemini, OpenCode, Continue, …)
npx skills add https://github.com/shipeasy-ai/shipeasy -a <agent>
```

---

## 8. Add the CLAUDE.md error-handling rule (ask once, default yes)

Append the block below to the repo-root `CLAUDE.md` (create it if missing).
**Skip if a `see()` rule is already present** — never duplicate it. This is
what makes the agent wrap error handling in `see()` on every future task,
not just when the skill happens to trigger:

```markdown
## Error handling

**HARD RULE: every handled exception is reported with `see()` from the
Shipeasy SDK (client or server entrypoint).** A catch block that swallows or
logs to console only is wrong (reporting then re-throwing is fine — the
occurrences link as a `caused_by` chain):

- Handle it → `see(e).causes_the(<subject>).to(<outcome>).extras({…})`
  (camelCase `causesThe` in Go/PHP/Java/Kotlin/Swift)
- Expected control flow → `see.ControlFlowException(e).because("because …")`
- Can't name the consequence → don't catch; let an outer boundary own it

Full grammar: the `see` skill (Shipeasy plugin) and
https://docs.shipeasy.ai/feedback/error-reporting.
```

---

## 9. Hand-off report

```
✅ shipeasy ops setup complete
Module:   feedback ✓   (events on by default → error collection)
Wired:    devtools overlay (?se=1 on any browser surface) <enabled | declined | n/a — headless>
          auto error capture (network failures → errors primitive)
          see() error reporting per the project's language docs
Skills:   ops + see — live via the installed plugin (no hand-written copies)
Rule:     CLAUDE.md — handled exceptions must use see()
Next:     ops_create  { "type": "bug", "title": "<title>" }   — file one (or `shipeasy ops bug "<title>"`)
          ops_list    { "type": "error" }                     — list bugs/features/errors/alerts
          /shipeasy:ops:work                                   — burn down bugs+features+errors+alerts
          or have end users submit via the in-page Report panel.
```

---

## 10. Offer the follow-on setup (ask the user)

The module is wired, but two high-value steps still need a decision. Call
**AskUserQuestion** with `multiSelect: true` so the user can pick either,
both, or neither.

- **Question:** "Ops module is installed. What would you like to set up
  next?" (header: `Next steps`)
- **Option A — "Wrap errors in see()"**: "Audit catch blocks across the
  project and add `see()` consequence reporting to every handled exception
  (per the project's language). Docs:
  https://docs.shipeasy.ai/feedback/error-reporting"
- **Option B — "Configure alerts"**: "Survey the project, propose a few
  alert rules, then build each end-to-end (event → metric → alert) and wire
  the events. Docs: https://docs.shipeasy.ai/feedback/alerts"

Act on whatever the user selects (do nothing for unchecked options):

- **"Wrap errors in see()":** invoke the `see` skill and sweep the codebase
  for handled exceptions, applying `see()` per its rules and the project's
  language grammar (handle → `causes_the().to().extras()`; control flow →
  `see.ControlFlowException(e).because(…)`; `see()`-then-`throw` is fine,
  never an empty catch, never console-only). Do **not** touch boundaries that
  already report (e.g. `withAdmin`/`errorResponse`, client auto-capture,
  framework error boundaries, the client-error sink) — only swallowed /
  control-flow catches.

- **"Configure alerts":** read the project to understand what's worth
  watching (error volume, latency/5xx on the hot path, cron/queue outcomes,
  key user actions), then propose **3–5 concrete alert rules** (metric +
  comparator + threshold + window + severity) and let the user confirm or
  trim. For each confirmed rule, build the whole chain:
  1. ensure the backing **event** is emitted from the code (instrument it
     where it isn't already);
  2. create the **metric** over that event (`metrics_create` MCP tool /
     `shipeasy metrics create …`; `metrics_grammar` for the DSL);
  3. create the **alert rule** (`ops_alerts_create` MCP tool /
     `shipeasy ops alerts create …`).
  Confirm each rule lands with `ops_alerts_list` / `shipeasy ops alerts list`.
