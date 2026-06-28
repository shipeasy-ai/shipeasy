---
name: i18n-migrate
description: Migrate an existing i18n library (react-i18next, react-intl, lingui, next-intl, raw-i18next) to Shipeasy
argument-hint: "<library-name>"
user-invocable: true
---

Migrate the project's existing i18n library to `@shipeasy/sdk` i18n.

> **This codemod rewrites JavaScript/TypeScript sources** (the supported
> sources below — react-i18next, react-intl, lingui, next-intl, raw-i18next —
> are all JS/TS libraries, and it rewrites their call sites to the `i18n.t(...)`
> form). For a repo in another language, pull that language's i18n usage from
> the `docs` MCP: `docs_get { sdk: <lang>, path: "i18n" }` (run
> `docs_list { sdk: <lang> }` to find the handle; CLI
> `shipeasy docs get --sdk <lang> i18n`) and apply it directly. Detect the
> language from `.shipeasy` or the subproject's manifest.

Supported migration sources (`$ARGUMENTS`):

- `react-i18next`
- `react-intl`
- `lingui`
- `next-intl`
- `raw-i18next`

Steps:

1. Confirm `$ARGUMENTS` matches one of the supported sources. If not, ask the user.
2. Preview:
   ```bash
   shipeasy codemod i18n --migrate $ARGUMENTS --dry-run --verbose
   ```
3. Apply:
   ```bash
   shipeasy codemod i18n --migrate $ARGUMENTS
   ```
4. The codemod rewrites call sites (`t("…")`, `<Trans>`, `<FormattedMessage>`,
   etc.) to `i18n.t(…)`. Existing translation files (`en.json`, etc.) are
   preserved — push them with:
   ```bash
   shipeasy i18n push en.json --profile en:prod
   ```
5. Remove the old library:
   ```bash
   pnpm remove i18next react-i18next   # or matching package set
   ```
6. Show the user the full diff before they commit. Run typecheck + build.

Do not delete the old translation JSON files until the user confirms keys are
visible in the Shipeasy dashboard.
