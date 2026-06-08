---
description: File an operational item — a bug report or feature request — against the bound project
argument-hint: "[--type bug|feature] <title>"
---

File a bug report or feature request against the bound project. This
replaces the old `/shipeasy:bugs:report`. Follow the `bugs` skill.

Prereq:

- Project bound (`.shipeasy` present).
- `feedback` module enabled (`/shipeasy:ops:install` or
  `shipeasy modules enable feedback`).

Errors and alerts are **not** filed here — they're produced by the
platform automatically. This command only files the two human-authored
types (`bug`, `feature`).

Steps:

1. Pick the type from `--type` (default `bug`):
   - `bug` → `shipeasy feedback bugs create` (something broken).
   - `feature` → `shipeasy feedback features create` (something missing).

2. Run:

   ```bash
   shipeasy feedback bugs create "<title>" \
     --description "<what / where / repro>" \
     [--page-url "<url>"]
   # or
   shipeasy feedback features create "<title>" \
     --description "<use case>" \
     [--page-url "<url>"]
   ```

3. Confirm it landed: `/shipeasy:ops:list --type bug` (or `--type feature`).

4. Don't delete or change status here — triage happens in the dashboard.
