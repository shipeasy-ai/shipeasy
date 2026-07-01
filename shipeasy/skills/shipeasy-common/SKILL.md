---
name: shipeasy-common
description: Shared prerequisites and troubleshooting for every Shipeasy skill — the .shipeasy project binding, updating the CLI/MCP/plugin when something breaks, how the three interchangeable surfaces (MCP tools, the shipeasy CLI, the Admin API) relate, pulling SDK call sites from the docs, enabling feature modules, and the archive-not-delete rule. Trigger on "shipeasy not working", "shipeasy unknown command", "update shipeasy CLI/MCP", ".shipeasy file", "shipeasy login/auth/bind", "how do MCP and CLI relate", or any Shipeasy setup/troubleshooting question not specific to one feature.
user-invocable: true
---

# Shipeasy — shared prerequisites & troubleshooting

Foundation the feature skills (`shipeasy-flags`, `shipeasy-experiments`,
`shipeasy-metrics`, `shipeasy-alerts`, `shipeasy-ops`, `shipeasy-i18n`,
`shipeasy-see`) build on. They link here instead of restating any of it.

## The three surfaces are interchangeable

Every day-to-day operation — create / list / update / archive gates, configs,
kill switches, experiments, metrics, alert rules, ops items, i18n keys — is
backed by **one admin API**, reachable three equivalent ways. Pick whichever is
available; they do the same thing:

1. **MCP tools** (`release_flags_*`, `release_experiments_*`, `metrics_*`,
   `ops_*`, `i18n_*`, …) when the `shipeasy` MCP server is registered. Prefer
   these — they validate input shapes and return typed errors.
2. **The `shipeasy` CLI** (`shipeasy release flags …`, `shipeasy metrics …`, …)
   as the fallback when the MCP server isn't registered (e.g. a bare skills-CLI
   install). Same operations, same names.
3. **The Admin API** (`POST/GET/PATCH /api/admin/*`) directly, when you're
   scripting outside both. The MCP tools and CLI are thin clients over it.

If one surface is unavailable, **try another** — they are not different features.
There are **no per-verb workflow skills** for CRUD; dedicated workflow skills
are reserved for multi-step flows (the `shipeasy-*-install` skills, the i18n
codemods, `shipeasy-ops-work`).

**Read parameter shapes from the tool, not from a skill.** The exact params,
enums, ranges, and id-vs-name rules for any operation live in the tool itself —
`shipeasy <command> --help`, the MCP tool's schema, or `docs_get`. The feature
skills call out only the non-obvious traps; for everything else, consult the
tool. This keeps guidance from going stale when the tools change.

## First fix: update before you debug

Most failures — `unknown command` / `unknown option`, a missing subcommand, an
unexpected `400` / `404`, or something that worked before — are **version
drift**: the tooling is older than the feature being invoked. Update to latest
and retry **once** before treating it as a bug:

- **CLI:** `npm i -g @shipeasy/cli@latest` (one-off: `npx @shipeasy/cli@latest <cmd>`).
- **MCP server:** pinned to `@shipeasy/mcp@latest`; it auto-pulls the newest
  release on restart — restart the session / MCP host to pick it up.
- **In Claude Code** (plugin skills): `/plugin marketplace update shipeasy`
  then `/plugin install shipeasy@shipeasy` (there is no `claude plugin
  update`), or enable auto-update on the `shipeasy` marketplace via `/plugin`.

Only treat it as a real bug if it still fails on the latest CLI **and** MCP.

## Project binding (`.shipeasy`)

Everything is scoped to the project bound in the current directory. **One
`.shipeasy` per project** — the folder that holds the file **is** the project
root. Reads walk **up** from the cwd to the *nearest* `.shipeasy` (like git and
`.git`), so a subproject's own file shadows any ancestor and the walk **stops
there** — it never overshoots to the git root above it. A monorepo with several
apps therefore has several `.shipeasy` files, one per app; commit them.

**Use `shipeasy root`, not `git rev-parse --show-toplevel`,** whenever you need
"the project root" — it returns the nearest `.shipeasy` dir (the Shipeasy
boundary) and exits non-zero when nothing is bound. Alongside `project_id`, a
`.shipeasy` also records the detected `language`/`sdk`/`frameworks` (written by
`shipeasy detect`).

```bash
shipeasy root      # print the nearest .shipeasy dir (+ project_id / sdk); the project boundary
shipeasy whoami    # server call — shows the session's project; skip login if already authed
shipeasy login     # opens a browser; user picks/creates a project (idempotent)
shipeasy logout    # then login again to recover from a 401
```

Self-heal: `401` → `shipeasy logout && shipeasy login` (retry once); headless →
`shipeasy login` prints the auth URL, surface it for the user to open. Never log
a server key (`sdk_server_*`); strip it from any output.

## Enabling a feature module

Modules are enabled per-project with one install command (idempotent on the
bound `.shipeasy`):

- `shipeasy install flags` — gates, configs, kill switches, experiments, events,
  **and** alert rules. Guided: the `shipeasy-flags-install` skill.
- `shipeasy install ops` — feedback (bug/feature reports) + error collection.
  Guided: the `shipeasy-ops-install` skill.
- `shipeasy install i18n` — translations + the `en:prod` profile. Guided: the
  `shipeasy-i18n-install` skill.

The base SDK install / auth / bind that precedes any of these is the
`shipeasy-setup` skill.

## Pulling SDK call sites from the docs

The customer app may be in any SDK language (ts / python / ruby / go / php /
java / kotlin / swift) — **never assume TypeScript/Next.js.** When a skill needs
an SDK call site (`flags.track`, `flags.getExperiment`, `flags.get`,
`i18n.t`, `see()`, …), pull the exact, version-correct form from the `docs`
surface rather than hand-writing it — namespaces and method names differ per
SDK, so never assume the TypeScript spelling:

1. Read the language from the nearest `.shipeasy` — its `sdk` field, written by
   `shipeasy detect` (run `detect` first if the file has no `sdk` yet). Fall back
   to the subproject's manifest (`package.json`, `pyproject.toml`, `Gemfile`,
   `go.mod`, `pom.xml`, `build.gradle*`, `composer.json`, `Package.swift`).
2. Fetch the snippet: `docs_get { path: "<page>" }` — `sdk` defaults to the
   `.shipeasy` `sdk` when omitted, so you rarely pass it explicitly (run
   `docs_list {}` to find the handle). Pass `sdk` only to override. CLI fallback:
   `shipeasy docs get <page>` (add `--sdk <lang>` to override).

For SDK-heavy tasks, you can also install that language's own skill so
version-correct syntax + snippets stay on hand: `shipeasy docs skill --sdk
<lang> --install` (MCP: `docs_skill`) delegates to the `skills` CLI and
auto-detects the coding agents on the machine.

Example shapes in the feature skills are **shape only** — the docs are the
source of truth and win on any conflict.

## Archive, don't delete

**Deletion is UI-only** across every resource — the plugin and CLI ship no
delete command or tool. The destructive verb everywhere is **`archive`** (hides
the resource, preserves history); actual deletion is a human call made in the
dashboard. The work loops never delete a record.
