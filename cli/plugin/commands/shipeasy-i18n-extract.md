---
description: Extract hardcoded user-visible strings and wrap them with i18n.t() from @shipeasy/sdk/client
argument-hint: "[target-dir]"
---

Run the Shipeasy i18n extraction codemod against the target directory
(default: current directory). The codemod:

1. Finds JSX text, attributes, template literals, and other translatable
   strings via AST visitors.
2. Deduplicates: strings appearing in 2+ files become `common.*` keys; strings
   that differ only by digits become parameterized.
3. Rewrites the source to call `i18n.t("<key>", "<fallback>", …)` and
   injects the import from `@shipeasy/sdk/client`.
4. Writes a flat `en.json` keys file (merge mode — safe to re-run).

Steps:

1. Preview first:
   ```bash
   shipeasy codemod i18n --dry-run --verbose $ARGUMENTS
   ```
2. If the preview looks right, apply:
   ```bash
   shipeasy codemod i18n $ARGUMENTS
   ```
3. Push the new keys to the backend and publish:
   ```bash
   shipeasy i18n push en.json --profile default --chunk default
   ```
   Or the structured equivalent via MCP: `i18n_push_keys` then
   `i18n_publish_profile`.

After applying, check `git diff` and run the project's typecheck/build to
verify no regressions. Do not commit until the user has reviewed the diff.
