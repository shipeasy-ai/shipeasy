---
name: shipeasy-setup
description: End-to-end onboarding for Shipeasy in a target app or monorepo — detect subprojects, install SDK per subproject, authenticate, bind to a project, create keys, wire SDK into entry points, and verify. Trigger on "set up shipeasy", "install shipeasy", "onboard shipeasy", "first-time integration".
user-invocable: true
---

# Setting up Shipeasy in a target app

**`shipeasy setup` does almost all of this itself.** The CLI now runs the whole
deterministic half of onboarding as one command — preconditions, monorepo target
detection, login + per-target project binding, agent/MCP wiring, SDK key minting,
package installs, key persistence, module enables — and then writes the
*remaining* code-editing steps (the part that needs judgement) to
`shipeasy-wiring.md`. Your job is to run that command and complete that file.

So the flow is short:

1. **Run `shipeasy setup`** yourself via your shell/Bash tool (never tell the
   user to run it). It prompts as it goes; answer from the user's stated intent,
   or pass flags to skip prompts (`--yes`, `--env prod`, `--agents …`,
   `--features flags,ops`, `--devtools`/`--no-devtools`). It detects that an
   agent is driving it and ends by printing a **directive addressed to you**.
2. **Read `shipeasy-wiring.md`** at the repo root and **complete every unchecked
   step**, following the operating rules written at the top of that file. It is
   self-contained and version-correct — it tells you exactly which
   `shipeasy docs get --sdk <lang> <page>` to pull for each target's install +
   `configure(...)` wiring, and the file is the source of truth on any conflict.
3. **Delete `shipeasy-wiring.md`** once all its gates pass, then hand the user
   the `git add` list from its hand-off section. **Do not commit or push.**

That's the happy path. The rest of this file is backup: what the command covers,
the invariants to keep, and what to do if it isn't available.

## What `shipeasy setup` already did (don't redo it)

- **Preconditions** — Node ≥ 20, git repo (offers `git init`).
- **Detection** — recursive monorepo scan; each real target got its own
  `.shipeasy` carrying its `sdk`/`language`/`frameworks`.
- **Auth + bind** — browser login (interactive but agent-runnable — it opens a
  browser, the user clicks Authorize, the CLI exits 0), then bound the repo root
  **and every install target** to the project.
- **Agents** — wired the coding agents it detected (Claude Code plugin;
  Cursor/Codex/Copilot MCP + instruction files; universal `AGENTS.md`).
- **Keys** — minted env-locked `server` (+ `client` for browser targets) keys
  and persisted them into each target's gitignored env file with the
  framework-correct public var name.
- **Installs** — ran the SDK package install where a package manager could do it
  durably (JS pms, poetry, `go get`, composer). Manifest-first ecosystems
  (Gemfile, Maven/Gradle, SwiftPM, bare pip) are left as a step in the doc.
- **Modules** — enabled whatever feature groups were chosen (flags/i18n/ops) and
  the ops module if the devtools overlay was accepted.
- **Pointer skill + verification** — wrote
  `.claude/skills/shipeasy-onboarded/SKILL.md` and ran the auth/keys/bind gate.

## Invariants to keep while completing the wiring

These mirror the doc's own rules — hold them even if you improvise:

1. **Never log or commit a server key.** Strip `sdk_server_*` from any output.
   Values already live in each target's gitignored env file; reference var
   **names** only.
2. **One `configure(...)` per runtime**, at the entry point. No
   `src/lib/shipeasy.ts` wrappers, no separate `i18n.init()` / `flags.configure()`
   — the SDK owns its own init.
3. **One `.shipeasy` per project.** The nearest file wins; a subproject's file
   shadows any ancestor. Use `shipeasy root` (not `git rev-parse`) to resolve
   "the project root."
4. **Never `git commit`/`git push`/`npm publish`.** Stop at "ready to commit"
   and hand the user the file list.
5. **The per-language `docs` win on any conflict** with these notes. Pull them
   with `shipeasy docs get --sdk <lang> <page>` (inside a target, `--sdk`
   defaults from its `.shipeasy`); `shipeasy docs list --sdk <lang>` shows every
   page. Optionally install a language's own skill:
   `shipeasy docs skill --sdk <lang> --install`.

## First fix: update before you debug

`unknown command/option`, an unexpected `400`/`404`, or a regression is usually
**version drift** — update and retry once before treating it as a bug:
`npm i -g @shipeasy/cli@latest` (+ restart the MCP server). See the
`shipeasy-common` skill for the per-surface update commands.

## If `shipeasy setup` isn't available or you need to drive it by hand

If the `shipeasy` CLI isn't installed, install it (`npm i -g @shipeasy/cli@latest`)
or invoke via `npx @shipeasy/cli setup`. If a step of the command fails and you
need to run the pieces individually, they map to these subcommands — run each
yourself and honour the same invariants:

```bash
shipeasy detect --json                     # per-folder targets + recommendations
shipeasy login                             # browser auth; picks/creates a project
( cd <target> && shipeasy bind )           # one .shipeasy per install target
shipeasy sdk keys create --type server --env prod --json
shipeasy sdk keys create --type client --env prod --json   # browser targets only
shipeasy install <flags|i18n|ops>          # enable a feature module group
shipeasy docs get --sdk <lang> installation            # version-correct wiring
( cd <target> && shipeasy root )           # verify each target's bind
```

Then persist the keys to each target's idiomatic secret store, wire the one
`configure(...)` per runtime, and run the verification gate. The devtools
overlay (`https://cdn.shipeasy.ai/se-devtools.js`, `?se=1` / Shift+Alt+S) is a
`<script>` tag read from public env — offer it, then `shipeasy install ops`.

## Feature add-ons (after base setup)

Once the wiring is done and verified, offer the feature installs the user hasn't
enabled yet, and the automated feedback trigger:

- **Flags & experiments** — `shipeasy install flags`; how-to: the `shipeasy-flags` skill
- **Feedback, errors & alerts** — `shipeasy install ops`; how-to: the `shipeasy-ops` skill
- **Translations (i18n)** — `shipeasy install i18n`; how-to: the `shipeasy-i18n` skill
- **Automation trigger** — `shipeasy setup triggers` (a scheduled agent that
  fixes queue items as PRs, unattended). `shipeasy setup` also offers it inline;
  the command opens the hosted, guided setup wizard for the chosen platform.
