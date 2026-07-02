# Runbook: `bug` items

Human-filed bug reports (devtools nub, public widget, CLI, dashboard). The
report is a human's description of a symptom — your job is to turn it into a
reproducible cause. Shared mechanics (atomic diff, gate, status lifecycle) are
in SKILL.md §1a; this is the bug-specific flow.

1. `shipeasy ops get <handle>` — the bug fields are `title`,
   `stepsToReproduce`, `actualResult`, `expectedResult`, `priority`,
   `reporterEmail`. The auto-collected browser environment is
   `context.browser.{pageUrl,userAgent,viewport}`. Uploaded files are
   `attachments[]`.
2. **Attachments carry the repro.** Each `attachments[]` entry has a
   `fetchUrl` — `GET` it with the same key you're already using (the download
   route is ops-key allow-listed, so it works from unattended runs too). Read
   screenshots into context (the image renders to you) — the error text/UI
   state in them is often the fastest path to the cause. **Recordings**
   (`video` kind, `.webm`/`.mp4`) can't be watched: in interactive runs surface
   the path and ask whether screenshots + text suffice; in unattended/`--pr`
   runs (no reader) note the unwatched recording and **escalate** rather than
   claim a fix you couldn't confirm against it.
3. Investigate from `context.browser.pageUrl` / screenshot text / the repro
   steps. Reproduce locally if the dev server is up; a failing repro you then
   flip green is the strongest verification. Work the cause systematically —
   form a hypothesis and confirm it before changing code; don't guess.
