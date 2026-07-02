---
name: shipeasy-ops-trigger
description: Provision a recurring, unattended trigger that runs the shipeasy-ops-work loop in --pr mode on a schedule — one PR per fixed item. Provider-pluggable; the per-provider runbook is the built-in help of `shipeasy ops trigger create <provider>`. Trigger on "recurring fix routine", "scheduled trigger", "unattended queue burn-down".
argument-hint: "[--provider claude|cursor|copilot|windsurf|codex|cline|openclaw|opencode|continue|gemini] [--frequency 4h|6h|daily|weekdays|weekly] [--dry-run]"
user-invocable: true
---

This skill is **provider-pluggable**: every provider schedules the **same work**
(the `shipeasy-ops-work` `--pr` loop) and differs only in what schedules it, how
the run is launched, and how it authenticates. The core skill is a **router** —
do the shared prep, resolve the provider, then follow that provider's reference.

## 1. Shared prerequisites (verify in order; stop at the first failure)

```bash
shipeasy root >/dev/null 2>&1 && echo ".shipeasy OK"   # base onboarding + bound project (walks up)
shipeasy login                                      # idempotent — no-op if already logged in
shipeasy whoami | grep -q "feedback" || echo "RUN shipeasy install ops"   # feedback module on
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git remote -v | grep -q github.com \
  && echo "GitHub repo OK"
```

- No `.shipeasy` → run the `shipeasy-setup` skill; stop.
- `feedback` module absent → run the `shipeasy-ops-install` skill; stop.
- No `github.com` remote → the routine opens real PRs and has nowhere to push;
  stop and have the user point the project at a GitHub repo.

## 2. Shared hard rules

- **Use the Bash tool for every `shipeasy` command** — don't ask the user to run
  them.
- **Restricted key, never your login token.** The flow mints a dedicated `ops`
  key (queue reads + status flips + `feedback/:id/link-pr` + create-only dev ops;
  no edits/deletes; auto-extends its 7-day expiry on use). Say this to the user.
- **Never print secrets.** Never echo the minted `ops` key into chat.
- **Don't fire a paid run without telling the user.** A verify run spends tokens
  and may open a real PR. Confirm first.
- **Respect `--dry-run`** — print the plan + prompt, mint nothing.
- **UI-only steps → open the dashboard, don't narrate them.** Several providers
  have configuration that only exists in a browser (a Codex Cloud environment,
  a repo's Agents secret store, a routine's network allowlist / fire token).
  Don't hand-walk the user through these in chat — **open the filtered trigger
  page** and let the UI explain (see below). Do the CLI/API side yourself first
  (mint the key, register the connector), then send them to finish the browser
  bit.

## Opening the filtered trigger page

When a step is browser-only, open the dashboard triggers page **preselected to
the resolved provider** — the page (`trigger-setup.tsx`) then walks the user
through that provider's exact fields, secrets, and network settings:

```
https://shipeasy.ai/dashboard/<PROJECT_ID>/triggers?provider=<provider>
```

- `<PROJECT_ID>` — from `.shipeasy` / `shipeasy projects current`.
- `<provider>` — the resolved provider (`jules` is accepted as an alias for
  `gemini`; unknown values fall back to the picker).
- Open it with the Bash tool (`open <url>` on macOS, `xdg-open` on Linux) or, if
  you can't open a browser, print the link for the user to click.

The provider reference marks which of its steps are browser-only.

## 3. Resolve the provider

1. `--provider` in `$ARGUMENTS` wins.
2. Omitted → default to **the harness you are running in** (Claude Code →
   `claude`, Codex → `codex`, Cursor → `cursor`, Copilot → `copilot`, Gemini →
   `gemini`/`jules`). A platform outside the guided ones stays as-is.
3. Genuinely ambiguous → ask the user (the five guided providers below +
   "other platform").

## 4. Dispatch to the provider reference

Each guided provider mirrors its flow on the dashboard triggers page
(`apps/ui/src/components/triggers/trigger-setup.tsx`) — keep the reference in
sync with that page. Read the matching reference and follow it end-to-end.

| Resolved provider | Mechanism | Follow |
| --- | --- | --- |
| `claude` | Anthropic cloud **routine** (hybrid split via `RemoteTrigger`) | [`references/claude.md`](references/claude.md) |
| `codex` | **GitHub Actions** cron → Codex Cloud task | [`references/codex.md`](references/codex.md) |
| `cursor` | **cold-fire** connector (Shipeasy launches a Cursor cloud agent) | [`references/cursor.md`](references/cursor.md) |
| `copilot` | **cold-fire** connector (GitHub agent-tasks API) | [`references/copilot.md`](references/copilot.md) |
| `gemini` / `jules` | **cold-fire** connector (Jules session) | [`references/gemini.md`](references/gemini.md) |
| anything else (Windsurf, Cline, OpenClaw, OpenCode, Continue, raw cron / GitHub Actions) | docs long-tail / platform-scheduled | [`references/other-platforms.md`](references/other-platforms.md) |
