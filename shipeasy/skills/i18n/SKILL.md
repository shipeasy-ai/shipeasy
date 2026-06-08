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

## Slash commands

- `/shipeasy:i18n:extract [dir]` — wrap hardcoded strings + push + publish.
- `/shipeasy:i18n:migrate <lib>` — port another i18n library to Shipeasy.
- `/shipeasy:i18n:validate [paths]` — CI/pre-commit gate: every `t("key")`
  in code exists server-side (non-zero exit on drift).
- `/shipeasy:i18n:update <key> <value>` — change one existing key's value
  (the only overwrite path — extract/push are insert-only).
- `/shipeasy:i18n:profiles [list|create <name>]` — manage locale profiles.
- `/shipeasy:i18n:translate <target-profile>` — machine-translate the app
  into a new locale (Anthropic key read locally, never sent to Shipeasy).

## The pattern

Every user-facing string becomes an `i18n.t()` call:

```tsx
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
