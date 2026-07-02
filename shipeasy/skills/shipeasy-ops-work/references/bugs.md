# Runbook: `bug` items

Human-filed bug reports (devtools nub, public widget, CLI, dashboard).

1. `shipeasy ops get <handle>` — read `title`, `description`, `pageUrl`,
   `priority`, `context`, `attachments[]`.
2. For each entry in `attachments[]`, fetch its URL. **Read screenshots into
   context** (the image renders to you). **Recordings** (`.webm`/`.mp4`) can't
   be watched — surface the path and ask whether screenshots+text suffice;
   don't silently skip.
3. Flip to `in_progress` (skip if already):
   `shipeasy ops update <handle> --status in_progress`.
4. Investigate from `pageUrl` / stack frame / screenshot text. Reproduce
   locally if the dev server is up. Reuse `superpowers:systematic-debugging`
   when the cause isn't obvious — don't guess.
5. Fix the **root cause**. No drive-by refactors, no swallowing, no deleting
   the failing assertion. Keep the diff scoped to this bug. Run the relevant
   gate (unit tests touching the file, `pnpm type-check` if TS changed, reload
   the page for UI fixes).
6. `--status resolved` only if confidently fixed + verified; `--status
   ready_for_qa` if it needs human verification. Can't fix? Leave it
   `in_progress`, write a one-paragraph hand-off note, **and escalate via
   `ops notify`** (the skill's "Escalate" section) — then move on.
