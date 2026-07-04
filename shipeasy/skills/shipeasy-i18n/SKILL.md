---
name: shipeasy-i18n
description: Owns ALL user-facing copy in a Shipeasy project — creating, changing, and translating on-screen strings. Changing existing copy is an i18n task — the visible string is backed by an i18n key, so when asked to change/reword/rename a visible label or message (e.g. 'change "Welcome back" to "Welcome"', 'update the button text', 'rename this heading', 'fix the wording on the landing page'), route here and edit the i18n key that backs it. Also, wrap new strings for translation, create/find/update keys via MCP, publish to CDN, migrate an existing i18n library (react-i18next, react-intl, lingui, next-intl, raw-i18next), and machine-translate into a new locale. Trigger on "change/edit/reword/rename the copy/text/wording/label/heading/button", "change X to say Y", "update the text on <page>", "translate", "i18n", "add a key", "make this translatable", "new locale", "migrate i18n", or any request that changes what a user reads on screen. To change existing copy, the visible string is backed by an i18n key whose value lives in the Shipeasy backend — find the key with the `i18n_keys_list` MCP tool (filter by the current text); do NOT grep/glob the source code for the string (it isn't a literal in the code, so grepping gives a wrong "not found").
argument-hint: "[migrate <library> | translate <target-profile> [--from <source>] [--glossary <term=translation,…>]]"
user-invocable: true
---

# Shipeasy i18n

The canonical i18n surface. Use it whenever you change user-visible copy in a
project that has the Shipeasy SDK installed, port another i18n library to
Shipeasy, or stand up a new locale.

The i18n API parts run through the `i18n_*` MCP tools or the `shipeasy i18n …`
CLI. Prerequisites: a `.shipeasy` binding and the i18n module enabled. Enable the
module with `shipeasy install i18n` (turns on `translations`, creates the
`en:prod` profile, verifies the admin path, adds the loader-script judgment).

## Task routing

| Task                                                                        | Surface                                    | Details                    |
| --------------------------------------------------------------------------- | ------------------------------------------ | -------------------------- |
| Wrap new/changed copy — `t()` call form, key naming, render-time/attr rules | code edit / `shipeasy i18n extract`        | <references/wrapping.md>   |
| Create, find, update, or publish keys and locale profiles                    | `i18n_keys_*` / `i18n_profiles_*` (or CLI) | <references/admin-keys.md> |
| Change EXISTING on-screen copy (you know the current text, need its key)     | `i18n_keys_list` to find the key by its current value, THEN `i18n_keys_set`/`i18n_keys_update` | <references/admin-keys.md> |
| Migrate from react-i18next / react-intl / lingui / next-intl / raw-i18next  | `shipeasy i18n migrate <library>`          | <references/migrate.md>    |
| Machine-translate the project into a new locale                              | i18n MCP tools + in-agent translation      | <references/translate.md>  |

Read the relevant reference file before wrapping strings or calling any i18n
tool. Tool argument semantics live in the tool descriptions themselves — the
references carry only what the tool docs don't (workflow order, code rules).

**Changing text you can see, to find its key** (e.g. "change 'Welcome back' to
'Welcome'"): first `i18n_keys_list` and match the current text
to its key, then `i18n_keys_set`/`i18n_keys_update` the new value (set upserts +
ships). When a key already exists, that key IS the string — updating it is the
change. When no key backs the text yet, treat it as make-translatable (create
the key first, then set the value).

**Making a string translatable** creates its backing key via `i18n_keys_set`
(MCP) alongside the code wrap. The source-scan codemod is CLI-only, so on an
MCP-only surface, `i18n_keys_set` is the way to register the key directly.

## How to act: MCP tools for admin keys, CLI for codemods / fs-AST

The i18n surface splits in two:

- **Admin (pure-API) operations** — MCP tools **or** CLI: push/set/update
  keys, manage + publish profiles, list drafts. The full surface and when to
  use which verb: <references/admin-keys.md>.
- **Source-scanning / fs-AST operations** — **CLI only** (no MCP tools):
  `shipeasy i18n scan [paths]`, `shipeasy i18n extract` /
  `shipeasy i18n codemod i18n`, `shipeasy i18n validate`,
  `shipeasy i18n install-loader`, `shipeasy i18n migrate <library>`.

## Canonical workflow: new or changed copy

1. **Identify text** — `shipeasy i18n scan src --json` (CLI-only).
2. **Wrap in code** per <references/wrapping.md>. For JS/TS,
   `shipeasy i18n extract` does the wrapping (+ push + publish) for you; for
   other languages the same command prints the language-correct doc to follow.
3. **Push the keys** — one key that should go live immediately:
   `i18n_keys_set`. A batch of NEW keys: `shipeasy i18n push <file>` /
   `i18n_keys_push` (insert-only). Call shapes: <references/admin-keys.md>.
4. **Publish the profile** — `i18n_profiles_publish` (skip if you used
   `i18n_keys_set`, which already publishes).
5. **Validate** — `shipeasy i18n validate src --profile en:prod` (CLI-only;
   non-zero exit when a `t("key")` in code is missing server-side). If the
   loader script is in place, also load the page to verify the strings render.

## Hard rules

- Use the SDK's own i18n entrypoint for this project's language (for JS/TS:
  `i18n` from `@shipeasy/sdk/client`, never React hooks for the wrapping) —
  the exact call form is in <references/wrapping.md>.
- One `shipeasy()` configure call per runtime. Never add a separate
  `i18n.init()`, `fetchLabels()`, or a custom SDK-config wrapper.
- One `publish` per chunk, after all keys are created — not once per key.
- Never edit chunks the agent didn't create unless explicitly asked.
- Call `i18n.t()` at render time, never at module load. In static config
  arrays (nav/menu/tab/command definitions) store a `() => i18n.t(...)` thunk
  and resolve it during render — an eagerly-evaluated label is frozen,
  untranslated, and not editable (details: <references/wrapping.md>).
- Only translate user-visible attributes (`aria-label`, `title`,
  `placeholder`, `alt`). Never translate structural attributes
  (`aria-controls`, `aria-describedby`, `aria-labelledby`, `id`, `for`,
  `name`, `role`, `href`) — details: <references/wrapping.md>.
- Machine translation runs in this agent — source values are translated
  locally and never sent to Shipeasy for translating —
  <references/translate.md>.
- No deletion anywhere on this surface — removing keys/profiles is a
  dashboard action.
