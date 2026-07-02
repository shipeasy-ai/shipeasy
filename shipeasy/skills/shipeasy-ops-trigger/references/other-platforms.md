# Other platforms (docs long-tail + raw platform-scheduled)

Covers coding apps without a dedicated guided flow — **Windsurf, Cline,
OpenClaw, OpenCode, Continue** — and any raw **platform-scheduled** host
(system cron / GitHub Actions). They all run the **same helper** (the
`shipeasy-ops-work` `--pr` loop); each has its own step-by-step in the docs, and
the create command prints the platform-scheduled setup for anything it doesn't
recognize.

**Do not improvise. The per-platform runbook is the built-in help of the real
create command — follow its printed instructions verbatim:**

```bash
shipeasy ops trigger create <anything-else>   # prints the platform-scheduled (GitHub Actions) setup
```

Docs index of every app: https://docs.shipeasy.ai/get-started/triggers

## Flow

1. **Schedule** — ask the cadence → cron. Frequencies: `4h` (default), `6h`,
   `daily`, `weekdays`, `weekly`, or a raw 5-field cron.
2. **Mint the restricted `ops` key + read the project id:**

   ```bash
   shipeasy sdk keys create --type ops --json     # the run authenticates with this
   ```

   plus the `.shipeasy` project id.
3. **Build the trigger prompt** — the create command's help includes the shared
   trigger-prompt template; substitute the `ops` key, project id, and the host's
   install line.
4. **Provision the schedule on that platform** per the printed instructions —
   the native automation or a system-cron / GitHub Actions `schedule:` job. Use
   the **Bash tool** for CLI/API steps; walk the user through any UI-only steps.
5. **Verify** with one manual fire and confirm a PR (or empty-queue exit).

Respect `--dry-run` and the shared hard rules in `SKILL.md` (restricted `ops`
key, never print secrets, confirm before a paid fire).
