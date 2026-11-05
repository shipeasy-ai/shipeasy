---
name: shipeasy-brain
description: "Load this skill FIRST whenever the task is to set up, seed, build, populate, extend, inspect, audit or query the Shipeasy project brain — the project's shared knowledge graph (conventions, pitfalls, decisions, concepts and facts, linked to every item, trail, PR, file, flag and metric). Trigger on: set up the brain, seed the brain, build our second brain, bootstrap project knowledge, teach the brain, remember this for the project, what does the brain know about X, is the brain complete on X, fill gaps in the brain, brain coverage, brain status, knowledge graph. Seeding runs through the MCP tools ops_brain_status and ops_brain_ingest — the status answer carries the playbook."
user-invocable: true
---

The project brain is a knowledge graph Shipeasy keeps per project. It grows by
itself from the work (every item, trail, PR, file, flag and metric becomes a
note, linked the moment anything mentions it), and from what you teach it.
What you send is **reconciled, not appended**: a note whose title matches an
existing one updates it, a later claim wins over an earlier one from the same
kind of source, a weaker source never overwrites a stronger one (a person >
verified code > a merged PR > a ticket > text sent in), and every rewrite keeps
a revision. Coding agents on the project are handed the notes near the item they
work on.

## Set up / seed the brain

1. **Read the status first** — `ops_brain_status` (CLI `shipeasy ops brain
   status`). Its `guide` field is the seeding playbook with the project's
   coverage on top; follow it. `seeded: false` means the brain has almost no
   knowledge notes yet.
2. **Read the repo's own knowledge** before the code: README, `CLAUDE.md` /
   `AGENTS.md` / `.cursorrules`, CONTRIBUTING, `docs/` and design docs / ADRs,
   the workspace layout and package manifests, CI and deploy config. Then the
   code those point at.
3. **Search before you name a note** — `ops_brain_search` (CLI `shipeasy ops
   brain search "<subject>"`) — and reuse an existing title so you update it.
4. **Write one note per durable subject** and send them in batches of up to 20
   with `ops_brain_ingest`:
   - `extract: false` — you already distilled it; Shipeasy's own model is not
     called (and not billed).
   - `source: "seed:<your agent>"`.
   - `evidence: [{path, snippet}]` — a snippet copied **verbatim** from the file
     on the default branch for every claim about the code. Verified notes
     outrank hearsay and are re-checked when the file changes; what does not
     verify comes back in `dropped`.
   - The text uses the markup: `# Title`, `type:: convention | pitfall |
     decision | concept | fact`, `summary:: <one line an agent can act on>`,
     `key:: value` facts, typed links (`depends_on:: [[Billing service]]`,
     `part_of:: [[Checkout]]`, `supersedes:: [[Old decision]]`), and inline
     `[[Other note]]`, `@gate:<key>`, `@metric:<key>`, `#<item>` and backticked
     repo paths.
5. **Finish with `ops_brain_status`** and report the notes per type and anything
   that came back in `dropped`.

Lessons, not logs: "expiry checks in auth are inclusive — compare with `<=`" is
a note; "fixed the expiry bug" is not. Re-running is safe — an unchanged note is
a no-op.

## Read the brain

- `ops_brain_search` — notes matching a topic (`type` narrows to one note type).
- `ops_brain_get` with a `slug` — one note in full: body, current facts and
  their history, held claims, and every link in and out (`item/42`,
  `flag/checkout`, `file/apps/web/src/a.ts`, `checkout-retry-policy`).
- `ops_brain_graph` — the neighbourhood of a note (both directions, `depth`
  hops), e.g. everything two hops from `item/42`.
- `ops_brain_sources` — what the brain read and what extraction cost.

## Check a topic for completeness and fill the gaps

`ops_brain_coverage` with a `topic` (or a `slug`) returns `score` (0-100), the
notes in scope, and `gaps`, worst first. A gap can be: a subject other notes link
to that nobody wrote, a thin note, a missing summary, a note that names code but
is not grounded in it, an anchor whose code changed, a held claim, a live
contradiction, a stale note, or a missing kind of knowledge ("no pitfall about
checkout yet"). `next` is the worklist. The loop:

1. `ops_brain_coverage { topic }`.
2. For each `next` entry, read what the repo or the work says, and write or
   update that note with `ops_brain_ingest` (`extract: false`, evidence for
   code claims). Reuse the existing title, so the gap closes on the same note.
3. Read coverage again. Stop when the score stops moving or `next` holds only
   what the repo cannot answer. Ask a person about those instead of guessing.

Edits by a person, settling a held claim and reverting a rewrite are done in
the dashboard, not by agents.
