---
name: i18n-extract
description: Extract hardcoded user-visible strings and wrap them with i18n.t() from @shipeasy/sdk/client
argument-hint: "[target-dir]"
user-invocable: true
---

You are running an automated i18n extraction. Do not pause to ask the user
clarifying questions. Do not propose alternatives. Run the command and report.

**The whole pipeline is now one CLI verb.** `shipeasy i18n extract` runs the
AST codemod (wrap strings with `i18n.t()` + write a flat keys file), then
pushes the keys (insert-only) and publishes them — what this skill used to do
in three steps. Run it with the **Bash tool**.

## Steps

1. Run the orchestrator (auto-detects source dirs when `$ARGUMENTS` is empty):

   ```bash
   shipeasy i18n extract $ARGUMENTS
   ```

   - JS/TS projects: codemod → push → publish, all in one call.
   - **Non-JS/TS projects** (exit code 2): there is no codemod yet. The command
     prints the per-language docs pointer. Follow it — pull
     `shipeasy docs get --sdk <lang> i18n`, apply the wrapping by hand, then
     `shipeasy i18n push <file> --profile en:prod`. Detect the language from
     `.shipeasy` or the subproject's manifest.

   Useful flags: `--dry-run` (preview, no writes/push), `--no-publish` (push
   but hold the CDN publish), `--profile <name>` (default `en:prod`).

2. Show the user the change footprint:

   ```bash
   git diff --stat
   ```

## Rules

- **Do not ask** which directories to scan — the codemod auto-detects and is
  idempotent + reversible via `git`.
- **Do not run `--dry-run`** unless the user explicitly typed `dry-run` in the
  slash-command arguments.
- **Do not commit.** Stop after `git diff --stat`.
- If the command errors (exit 1), show the error and stop — don't "self-heal".
  Exit code 2 is the non-JS/TS path above, not an error.

## Final report (one short paragraph)

- files modified / keys pushed (from the command output),
- one-line `git diff --stat` summary,
- next command the user might want: `npm run build` (or `pnpm build`).
