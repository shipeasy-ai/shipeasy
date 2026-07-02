# Runbook: `bug` items

Human-filed bug reports (devtools nub, public widget, CLI, dashboard). The
report is a human's description of a symptom — your job is to turn it into a
reproducible cause. Shared mechanics (atomic diff, gate, status lifecycle) are
in SKILL.md §1a; this is the bug-specific flow.

1. `shipeasy ops get <handle>` — read `title`, `description`, `pageUrl`,
   `priority`, `context`, `attachments[]`.
2. **Attachments carry the repro.** For each entry in `attachments[]`, fetch
   its URL. Read screenshots into context (the image renders to you) — the
   error text/UI state in them is often the fastest path to the cause.
   **Recordings** (`.webm`/`.mp4`) can't be watched: in interactive runs surface
   the path and ask whether screenshots + text suffice; in unattended/`--pr`
   runs (no reader) note the unwatched recording and **escalate** rather than
   claim a fix you couldn't confirm against it.
3. Investigate from `pageUrl` / stack frame / screenshot text. Reproduce
   locally if the dev server is up; a failing repro you then flip green is the
   strongest verification. Work the cause systematically — form a hypothesis
   and confirm it before changing code; don't guess.
