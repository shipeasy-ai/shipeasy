# Migrating an existing i18n library to Shipeasy

Migrate the project's existing i18n library to `@shipeasy/sdk` i18n.

**The migration is one CLI verb.** `shipeasy i18n migrate <library>` runs
the codemod that rewrites call sites (`t("…")`, `<Trans>`, `<FormattedMessage>`,
etc.) to `i18n.t(…)`, then pushes any existing translation file and publishes.
Run it with the **Bash tool**.

Supported sources: `react-i18next`, `react-intl`, `lingui`, `next-intl`,
`raw-i18next`.

## Steps

1. Confirm the requested library matches a supported source. If not, ask the
   user.

2. Preview, then apply:

   ```bash
   shipeasy i18n migrate <library> --dry-run    # preview the rewrite
   shipeasy i18n migrate <library>              # apply + push + publish
   ```

   - JS/TS projects: codemod → push → publish in one call. The command prints
     the `pnpm remove <library>` line to run next.
   - **Non-JS/TS projects** (exit code 2): no codemod — follow the printed docs
     pointer (`shipeasy docs get --sdk <lang> i18n`) and apply by hand.

3. Remove the old library (the command tells you which), then show the full diff
   and run typecheck + build:

   ```bash
   pnpm remove i18next react-i18next   # or the matching package set
   git diff
   ```

Do not delete the old translation JSON files until the user confirms keys are
visible in the Shipeasy dashboard. Do not commit — stop after the diff.
