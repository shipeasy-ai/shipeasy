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

## 3. Resolve the provider

1. `--provider` in `$ARGUMENTS` wins.
2. Omitted → default to **the harness you are running in** (Claude Code →
   `claude`, Cursor → `cursor`, Copilot → `copilot`, Gemini → `jules`). A
   platform outside the four supported ones stays as-is.
3. Genuinely ambiguous → ask the user (the four supported providers +
   "other platform").

## 4. Dispatch to the provider reference

| Resolved provider | Follow |
| --- | --- |
| `claude` | [`references/claude.md`](references/claude.md) — the hybrid-split cloud-routine flow (deepest, most automated; the only *routine* connector) |
| anything else (`cursor`, `copilot`, `jules`/`gemini`, GitHub Actions / system cron, …) | [`references/other-providers.md`](references/other-providers.md) — shared prep + the create command's printed runbook, followed verbatim |

Read the matching reference and follow it end-to-end.
