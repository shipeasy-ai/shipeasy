# Runbook: `bug` items

Human-filed bug reports (devtools nub, public widget, CLI, dashboard). The
report is a human's description of a symptom — your job is to turn it into a
reproducible cause. Shared mechanics (atomic diff, gate, status lifecycle) are
in SKILL.md §1b; this is the bug-specific flow.

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

**Reopened by QA?** If the item has QA notes or comments (`ops_qa_notes_list`,
`ops_comments_list`), the newest `verification` FAIL and its "Required fixes"
checklist outrank the original steps — see SKILL.md §1a-0. A merged PR is not
evidence of a fix once QA has failed it.
