---
description: Migrate an existing i18n library (react-i18next, react-intl, lingui, next-intl, raw-i18next) to Shipeasy
argument-hint: "<library-name>"
---

Migrate the project's existing i18n library to `@shipeasy/sdk` i18n.

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
   shipeasy i18n push en.json --profile default
   ```
5. Remove the old library:
   ```bash
   pnpm remove i18next react-i18next   # or matching package set
   ```
6. Show the user the full diff before they commit. Run typecheck + build.

Do not delete the old translation JSON files until the user confirms keys are
visible in the Shipeasy dashboard.
