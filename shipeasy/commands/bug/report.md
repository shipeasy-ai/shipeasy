---
description: File a Shipeasy bug report or feature request from the CLI
argument-hint: "<bug|feature> <title>"
---

File a bug report or feature request against the bound project. Follow
the `bugs` skill.

Prereq:

- Project bound (`.shipeasy` present).
<<<<<<<< HEAD:shipeasy/commands/bugs/bug.md
- `feedback` module enabled (`/shipeasy:bugs:install` or `shipeasy modules enable feedback`).
========
- `feedback` module enabled — run `/shipeasy:bugs:install` first if not.
>>>>>>>> f82a432 (feat: consolidate 5 plugins into single shipeasy plugin):shipeasy/commands/bug/report.md

Steps:

1. Pick the subcommand:
   - `bugs create` for something broken.
   - `features create` for something missing.
2. Run:
   ```bash
   shipeasy feedback bugs create "<title>" \
     --description "<what / where / repro>" \
     [--page-url "<url>"]
   ```
3. Confirm it landed: `shipeasy feedback bugs list` (or `features list`).
4. Don't `delete` unless the user asked — triage happens in the dashboard.
