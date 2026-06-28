---
name: i18n
description: Add translatable text to a Shipeasy-enabled app — wrap hardcoded strings with i18n.t(), create keys in the backend via MCP, and publish them to CDN. Trigger on "translate", "i18n", "add a key", "make this translatable", or any request involving user-facing copy changes.
user-invocable: true
---

# Adding translatable text in a Shipeasy app

This is the canonical i18n workflow. Use it whenever you change user-visible
copy in a project that has `@shipeasy/sdk` installed.

## First fix: update before you debug

Most failures here — `unknown command` / `unknown option`, a missing
subcommand, an unexpected `400`/`404`, or something that worked before — are
**version drift**: the CLI or plugin is older than the feature being invoked.
Before deeper debugging, update to latest and retry once:

- **CLI:** `npm i -g @shipeasy/cli@latest` (or one-off: `npx @shipeasy/cli@latest <cmd>`).
- **Plugin (skills + slash commands):** `/plugin marketplace update shipeasy`
  then `/plugin install shipeasy@shipeasy`. There is no `claude plugin update`;
  or open `/plugin` and enable auto-update on the `shipeasy` marketplace.
- **MCP server:** pinned to `@shipeasy/mcp@latest` — restart the session to
  pick up a new release.

Only treat it as a real bug if it still fails on the latest CLI **and** plugin.

## Enabling on a project

`/shipeasy:i18n:install` (or `shipeasy modules enable translations`,
then create the `en:prod` profile).

## How to act: MCP server / CLI for keys, workflow commands for codemods

Key-level CRUD has **no per-verb slash command** — drive it through the MCP
tools or the CLI:

- Create / push keys → `i18n_create_key`, `i18n_push_keys` (or
  `shipeasy i18n push`).
- Change one existing key's value (the only overwrite path — extract/push are
  insert-only) → `i18n_create_key` with the overwrite flag, or
  `shipeasy i18n update <key> <value>`.
- Validate that every `t("key")` in code exists server-side → `i18n_validate_keys`
  (or `shipeasy i18n validate` — non-zero exit on drift, for CI/pre-commit).
- Manage locale profiles → `i18n_profiles_list`, `i18n_create_profile` (or
  `shipeasy i18n profiles …`).
- Publish a chunk → `i18n_publish_profile` (or `shipeasy i18n publish`).

The remaining slash commands are the multi-step codemod/translation workflows
(AST scan + file edits + push + publish), which is more than a single tool call:

- `/shipeasy:i18n:extract [dir]` — wrap hardcoded strings + push + publish.
- `/shipeasy:i18n:migrate <lib>` — port another i18n library to Shipeasy.
- `/shipeasy:i18n:translate <target-profile>` — machine-translate the app
  into a new locale (Anthropic key read locally, never sent to Shipeasy).

## The pattern

Every user-facing string becomes an i18n translate call.

**Pull the i18n call form for this project's SDK language from the `docs` MCP.**
Detect the language from `.shipeasy` or the subproject's manifest
(`package.json`, `pyproject.toml`, `Gemfile`, `go.mod`, `pom.xml`,
`build.gradle*`, `composer.json`, `Package.swift`), then fetch the snippet:
`docs_get { sdk: <lang>, path: "i18n" }` (run `docs_list { sdk: <lang> }` to find
the handle; CLI `shipeasy docs get --sdk <lang> i18n`). The example below shows
the shape — use the docs snippet for the exact call.

```tsx
// Example shape — fetch the exact call for this project's language via docs_get
import { i18n } from "@shipeasy/sdk/client";

// Before:
<button>Install with Claude</button>

// After:
<button>{i18n.t("landing.nav.cta", "Install with Claude")}</button>
```

### Signature

```ts
i18n.t(
  key: string,
  fallback: string,
  variables?: Record<string, string | number>,
  description?: string,
);
```

### Key naming

`<chunk>.<component>.<element>`

- **chunk** groups related keys so they load in a single CDN fetch (e.g. `landing`, `auth`, `dashboard`, `pricing`).
- **component** is the section or component name (e.g. `hero`, `nav`, `footer`).
- **element** is the specific piece (e.g. `cta`, `title`, `badge`).

Examples: `landing.nav.cta`, `landing.hero.title`, `auth.signin.button`.

### Variables

```tsx
i18n.t("landing.hero.meta_install", "{{seconds}}s install", { seconds: "8" });
```

Stored value: `"{{seconds}}s install"`. Curly braces are placeholders.

### Call `t()` at render time — never at module load

`i18n.t()` must run **during render**, not when a module is first imported.
A call evaluated at import time bakes into a frozen string before translations
have loaded and before the edit-labels devtools can patch `t()` — so the string
**never picks up a live translation** (it's stuck on the fallback / first locale)
**and is not editable** in the click-to-edit devtools overlay.

The classic trap is a module-level config array (sidebar/nav/menu/tab
definitions, command-palette entries, schema field titles):

```tsx
// ❌ WRONG — evaluated once at import, frozen, not translatable/editable
const NAV = [{ to: "/dashboard", label: i18n.t("nav.dashboard", "Dashboard") }];

// ✅ RIGHT — store a thunk, call it during render
const NAV = [{ to: "/dashboard", label: () => i18n.t("nav.dashboard", "Dashboard") }];
// type: label: string | (() => string)
function resolveLabel(l: string | (() => string)) {
  return typeof l === "function" ? l() : l;
}
// in the component: <Item label={resolveLabel(item.label)} />
```

Strings written directly in JSX (`<h1>{i18n.t("page.title", "Title")}</h1>`) are
already render-time and need no change — this only bites pre-computed constants.

### Attributes: only translate what the user reads

Wrap translatable **user-visible** attributes — `aria-label`, `title`,
`placeholder`, `alt`. **Never** wrap structural / reference attributes:
`aria-controls`, `aria-describedby`, `aria-labelledby`, `id`, `for`, `name`,
`role`, `href`, `data-*`. Their values are IDs/relationships, not copy —
translating one breaks the control (a renamed `aria-controls` no longer matches
its panel `id`) and surfaces a junk "label" in the edit-labels overlay.

```tsx
// ❌ aria-controls is an ID reference, not copy
<button aria-controls={i18n.t("nav.submenuId", "submenu-{{id}}", { id })}>
// ✅ leave structural attributes as plain values
<button aria-controls={`submenu-${id}`} aria-label={i18n.t("nav.openMenu", "Open menu")}>
```

## Workflow

### 1. Identify text

```bash
shipeasy i18n scan src --json
```

Or: `mcp tool: i18n_scan_code { "paths": ["src"] }`.

### 2. Wrap in code

Edit each file. Import `i18n` from `@shipeasy/sdk/client`.

### 3. Create keys in the backend

```
mcp tool: i18n_create_key {
  "key": "landing.hero.title",
  "value": "Ship faster with Shipeasy",
  "chunk": "landing",
  "profile": "en:prod",
  "description": "Hero headline"
}
```

CLI fallback:

```bash
echo '{"landing.hero.title":"Ship faster with Shipeasy"}' > /tmp/keys.json
shipeasy i18n push /tmp/keys.json --profile en:prod --chunk landing
```

### 4. Publish the chunk

```
mcp tool: i18n_publish_profile { "profile": "en:prod", "chunk": "landing" }
```

This rebuilds the KV manifest and purges the CDN cache.

### 5. Validate

```
mcp tool: i18n_validate_keys { "profile": "en:prod" }
```

Confirms the keys are reachable from the CDN. If the loader script is in
place, also load the page in a browser to verify the strings render.

## Bulk migration from another i18n library

If the project already uses `react-i18next`, `react-intl`, `lingui`, or
`next-intl`, run the codemod migration:

```bash
shipeasy codemod i18n --migrate react-i18next
# or react-intl | lingui | next-intl | raw-i18next
```

Or `/shipeasy:i18n:migrate <library>`.

## Errors → action

| Error            | Action                                                          |
| ---------------- | --------------------------------------------------------------- |
| `409 key exists` | Leave it. Re-runs are idempotent.                               |
| `401`            | `shipeasy logout && shipeasy login`. Retry **once**.            |
| `429` plan-limit | Surface to user. Do not auto-upgrade.                           |
| Profile missing  | `i18n_create_profile { "name": "en:prod", "locales": ["en"] }`. |

## Hard rules

- Use `i18n` from `@shipeasy/sdk/client`, never React hooks for the wrapping.
- One `shipeasy()` call per runtime. Never call `i18n.init()`, `fetchLabels()`,
  or build a custom `lib/shipeasy.ts` wrapper.
- One `publish` per chunk, after all keys are created — not once per key.
- Never edit chunks the agent didn't create unless explicitly asked.
- Call `i18n.t()` at render time, never at module load. In static config arrays
  (nav/menu/tab/command definitions) store a `() => i18n.t(...)` thunk and
  resolve it during render — an eagerly-evaluated label is frozen, untranslated,
  and not editable.
- Only translate user-visible attributes (`aria-label`, `title`, `placeholder`,
  `alt`). Never translate structural attributes (`aria-controls`,
  `aria-describedby`, `aria-labelledby`, `id`, `for`, `name`, `role`, `href`).
