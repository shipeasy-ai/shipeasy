# Provider: `codex` (OpenAI Codex — GitHub Actions + Codex Cloud)

**Mechanism.** The schedule is a **GitHub Actions `schedule:` cron** that submits
a real **Codex Cloud** task (`codex cloud exec --env <id>`) — the task runs in a
configured Codex Cloud environment (machine off). Unlike a Claude routine,
Shipeasy **cannot auto-fire it on new feedback** — there is no public REST fire
endpoint for our Worker yet (feature request `openai/codex#24777`). The instant
trigger is GitHub's `workflow_dispatch` or the same one-line `codex cloud exec`.

**Authoritative runbook:** the create command's built-in help. Follow it verbatim.

```bash
shipeasy ops trigger create codex --help
```

## Prereq (one-time, in the user's terminal)

```bash
codex plugin marketplace add shipeasy-ai/shipeasy
codex plugin add shipeasy@shipeasy
npm install -g @shipeasy/cli@latest
```

The Codex harness addresses the plugin by handle, so its slash command is
prefixed: `@Shipeasy /shipeasy:ops:create_trigger --provider codex --frequency <FREQ>`.

## Flow

1. **Schedule** — ask the cadence → GitHub Actions cron (`4h` → `0 */4 * * *`,
   `6h` → `0 */6 * * *`, `daily` → `0 9 * * *`, `weekdays` → `0 9 * * 1-5`,
   `weekly` → `0 9 * * 1`).
2. **`create_trigger --provider codex`** does the work upfront: mints the
   restricted `ops` key, **writes `.github/workflows/shipeasy-trigger.yml`** on
   that cron (with `workflow_dispatch:` for the instant trigger), opens the Codex
   Cloud environment page, and pauses.
3. **Configure the Codex Cloud environment (browser, UI-only)** — the task runs
   *inside* this environment, so its network allowlist + Shipeasy creds live
   here, not as Actions secrets:
   - Network access → **Custom**, allow `shipeasy.ai` + `api.shipeasy.ai` (keep
     "include default package managers" checked).
   - Env vars: `SHIPEASY_CLI_TOKEN=<ops key>` and `SHIPEASY_PROJECT_ID=<project id>`.
   - The GitHub Actions runner only needs `CODEX_API_KEY` (submit auth) and
     `CODEX_ENV_ID` (the target environment) as repo secrets.
4. **Commit the workflow** — return to Codex; it commits the workflow file.
5. **Verify** — one manual fire and confirm a PR (or empty-queue exit):

   ```bash
   codex cloud exec --env <env-id> "Run /shipeasy:ops:work --pr for this project and follow that workflow exactly."
   ```

Respect `--dry-run` and the shared hard rules in `SKILL.md` (restricted `ops`
key, never print secrets, confirm before a paid fire).
