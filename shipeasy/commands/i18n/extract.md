---
name: i18n-extract
description: Extract hardcoded user-visible strings and wrap them with i18n.t() from @shipeasy/sdk/client
argument-hint: "[target-dir]"
user-invocable: true
---

You are running an automated i18n extraction. Do not pause to ask the user
clarifying questions. Do not propose alternatives. Just run the steps below
and report at the end.

## Steps

1. Apply the codemod against `$ARGUMENTS` (or auto-detected source dirs if
   empty — the CLI handles detection):

   ```bash
   shipeasy codemod i18n $ARGUMENTS
   ```

   The CLI auto-detects targets when no argument is given (it walks `app/`,
   `src/`, `components/`, `lib/`, `pages/` if they exist). It writes:
   - rewritten source files (`i18n.t("<key>", "<fallback>", …)` calls + the
     `import { i18n } from "@shipeasy/sdk/client"` line),
   - a flat `src/i18n/en.json` (or `i18n/en.json` if no `src/`) with the
     extracted key/value pairs (merge mode — safe to re-run).

2. Locate the generated keys file and push + publish:

   ```bash
   FILE=$(test -f src/i18n/en.json && echo src/i18n/en.json || echo i18n/en.json)
   shipeasy i18n push "$FILE" --profile en:prod --chunk default
   shipeasy i18n publish --profile en:prod --chunk default
   ```

3. Show the user the change footprint and tell them to review:

   ```bash
   git diff --stat
   ```

## Rules

- **Do not ask the user** which directories to scan or whether to apply.
  The codemod is idempotent and reversible via `git`. Just run it.
- **Do not run with `--dry-run`** unless the user explicitly typed `dry-run`
  in their slash-command arguments.
- **Do not commit.** Stop after `git diff --stat`.
- If the codemod errors, show the error and stop — don't try to "self-heal"
  by switching directories or editing the config.

## Final report (one short paragraph)

- files scanned / files modified / total keys pushed,
- the keys file path,
- one-line `git diff --stat` summary,
- the next command the user might want: `npm run build` (or `pnpm build`).
