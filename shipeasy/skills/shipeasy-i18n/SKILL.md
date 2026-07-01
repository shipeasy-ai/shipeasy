---
name: shipeasy-i18n
description: Add translatable text to a Shipeasy-enabled app — wrap hardcoded strings with i18n.t(), create keys in the backend via MCP, and publish them to CDN. Trigger on "translate", "i18n", "add a key", "make this translatable", or any request involving user-facing copy changes.
user-invocable: true
---

# Adding translatable text in a Shipeasy app

This is the canonical i18n workflow. Use it whenever you change user-visible
copy in a project that has `@shipeasy/sdk` installed.

**Prerequisites live in the `shipeasy-common` skill** — the MCP ⇄ CLI ⇄ API
surfaces, updating on version drift, and the `.shipeasy` binding. Enable the
module with `shipeasy install i18n` (turns on `translations`, creates the
`en:prod` profile, verifies the admin path); the `shipeasy-i18n-install` skill
wraps it and adds the loader-script judgment. The i18n surface has one
topic-specific split, below.

## How to act: MCP tools for admin keys, CLI for codemods / fs-AST

The i18n surface splits in two:

- **Admin (pure-API) operations** — work over the MCP tools **or** the CLI:
  - Push NEW keys (insert-only; existing keys untouched) → `i18n_keys_push`
    (or `shipeasy i18n push <file>`).
  - Set one key's value **and publish it live** in a single call → `i18n_keys_set`
    (upsert + profile-wide publish).
  - Change one existing key's value without publishing (the only pure-overwrite
    path; needs the key's id) → `i18n_keys_update { id, value }`
    (or `shipeasy i18n update <key> <value>`).
  - Manage locale profiles → `i18n_profiles_list`, `i18n_profiles_create`
    (or `shipeasy i18n profiles list/create`).
  - Publish a profile → `i18n_profiles_publish { profileId }`
    (or `shipeasy i18n publish`).
  - List staged translation drafts → `i18n_drafts_list`.
- **Source-scanning / fs-AST operations** — **CLI only** (these are no longer
  MCP tools):
  - Find translatable strings → `shipeasy i18n scan [paths]`.
  - Wrap + extract via codemod → `shipeasy i18n extract` / `shipeasy i18n codemod i18n`.
  - Validate that every `t("key")` in code exists server-side → `shipeasy i18n validate`
    (non-zero exit on drift, for CI/pre-commit).
  - Inject the loader script → `shipeasy i18n install-loader`.

### One-shot "change a string and ship it"

To change one string's value AND make it live in a single step, use the
**set-and-publish** tool `i18n_keys_set`:

```
mcp tool: i18n_keys_set { "key": "home.cta", "value": "Get started" }                     # → default profile, published live
mcp tool: i18n_keys_set { "key": "home.cta", "value": "Commencer", "profile": "fr:prod" } # → a named profile
```

- `profile` is optional — omit it to target the project's **default**-marked
  profile (the one seeded as `en:prod`); pass a name to target another locale.
- It inserts the key if it's new and overwrites it if it exists (no "key not
  found"), then publishes the whole profile (KV rebuild + CDN purge) and returns
  the publish result.
- Prefer this over `push` (insert-only, never overwrites) + a separate
  `publish` when you just want to correct/replace one live string.

Note: any single-key edit (`shipeasy i18n update`, the devtools overlay, or
`i18n_keys_set`) **already rebuilds KV + purges the CDN** — a separate `publish`
is only needed after an insert-only `push`, or to re-ship after a failed purge.

### Find a key by its value

`i18n_keys_list` searches **both key name and value** via `q`:

```
mcp tool: i18n_keys_list { "q": "Get started" }                            # any profile
mcp tool: i18n_keys_list { "profile_id": "<id>", "q": "Commencer" }        # one profile
```

Use it to locate the key behind a piece of on-screen copy before changing it.

The multi-step codemod/translation workflows (AST scan + file edits + push +
publish) are driven by single CLI verbs:

- `shipeasy i18n extract [dir]` — wrap hardcoded strings + push + publish.
- `shipeasy i18n migrate <lib>` — port another i18n library to Shipeasy.
- Machine-translating into a new locale (Anthropic key read locally, never sent
  to Shipeasy) has no single CLI verb — orchestrate it via the i18n MCP tools
  (`i18n_profiles_create` → `i18n_drafts_list` → publish).

The `shipeasy-i18n-extract`, `shipeasy-i18n-migrate`, and
`shipeasy-i18n-translate` skills drive these same CLI/MCP paths end-to-end.

## The pattern

Every user-facing string becomes an i18n translate call.

Pull the i18n call form for this project's language from the `docs` surface (see
`shipeasy-common` → "Pulling SDK call sites"): `docs_get { sdk: <lang>, path: "i18n" }`.
The snippet below is **shape only**.

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

> Applies to component/UI frameworks (React, Vue, Svelte, …). The trap is the
> same in any language with module-level evaluation; the JSX below is the JS/TS
> shape — use the `docs_get` snippet for your SDK.

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

> Applies to HTML/JSX templates (web SDKs). Native UI toolkits have the same
> split between user-visible labels and structural identifiers — wrap only the
> former.

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

(Source scanning is CLI-only — there is no MCP tool for it.)

### 2. Wrap in code

Edit each file. Import the i18n entrypoint for this project's SDK language
(for JS/TS: `i18n` from `@shipeasy/sdk/client` — see the docs_get note above).

### 3. Push the keys to the backend

For one key that should also go **live immediately** (upsert + publish):

```
mcp tool: i18n_keys_set {
  "key": "landing.hero.title",
  "value": "Ship faster with Shipeasy",
  "profile": "en:prod",
  "description": "Hero headline"
}
```

For a batch of NEW keys (insert-only; publish separately in step 4), push a
flat `{ "<key>": "<value>" }` JSON file:

```bash
echo '{"landing.hero.title":"Ship faster with Shipeasy"}' > /tmp/keys.json
shipeasy i18n push /tmp/keys.json --profile en:prod --chunk landing
```

(MCP equivalent: `i18n_keys_push { profile_id, chunk, keys: [{ key, value }] }`.)

### 4. Publish the profile

```
mcp tool: i18n_profiles_publish { "profileId": "<profile id>", "chunk": "landing" }
```

(Or `shipeasy i18n publish --profile en:prod --chunk landing`.) This rebuilds
the KV manifest and purges the CDN cache. Publishing is profile-wide — the
`chunk` is an audit label only. Skip this if you used `i18n_keys_set`, which
already publishes.

### 5. Validate

```bash
shipeasy i18n validate src --profile en:prod
```

CLI-only — confirms every `t("key")` referenced in code exists server-side
(non-zero exit on drift). If the loader script is in place, also load the page
in a browser to verify the strings render.

## Bulk migration from another i18n library

If the project already uses `react-i18next`, `react-intl`, `lingui`, or
`next-intl` (or `raw-i18next`), run the migration verb:

```bash
shipeasy i18n migrate react-i18next
# or react-intl | lingui | next-intl | raw-i18next
```

This codemods the call sites, pushes any existing translation file, and
publishes — one command. (Guided: the `shipeasy-i18n-migrate` skill.)

## Hard rules

- Use the SDK's own i18n entrypoint for this project's language (for JS/TS:
  `i18n` from `@shipeasy/sdk/client`, never React hooks for the wrapping) —
  fetch the exact call via `docs_get`.
- One `shipeasy()` configure call per runtime. Never add a separate
  `i18n.init()`, `fetchLabels()`, or a custom SDK-config wrapper.
- One `publish` per chunk, after all keys are created — not once per key.
- Never edit chunks the agent didn't create unless explicitly asked.
- Call `i18n.t()` at render time, never at module load. In static config arrays
  (nav/menu/tab/command definitions) store a `() => i18n.t(...)` thunk and
  resolve it during render — an eagerly-evaluated label is frozen, untranslated,
  and not editable.
- Only translate user-visible attributes (`aria-label`, `title`, `placeholder`,
  `alt`). Never translate structural attributes (`aria-controls`,
  `aria-describedby`, `aria-labelledby`, `id`, `for`, `name`, `role`, `href`).
