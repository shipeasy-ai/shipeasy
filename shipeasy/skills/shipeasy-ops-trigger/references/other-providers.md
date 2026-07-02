# Providers other than `claude`

Covers `cursor`, `copilot`, `jules` (alias `gemini`), and any
platform-scheduled host (GitHub Actions / system cron). Every provider
schedules the **same work** (the `shipeasy-ops-work` `--pr` loop) — they differ
only in **what schedules it**, **how the run is launched**, and **how it
authenticates**.

**Do not improvise. The per-provider runbook is the built-in help of the real
create command — follow its printed instructions verbatim:**

```bash
shipeasy ops trigger create <provider> --help   # cursor | copilot | jules (alias: gemini)
shipeasy ops trigger create <anything-else>     # prints the platform-scheduled (GitHub Actions) setup
```

## Flow

Do the shared prep in `SKILL.md`, then:

1. **Schedule** — ask the user the cadence → cron. Frequencies: `4h` (default),
   `6h`, `daily`, `weekdays`, `weekly`, or a raw 5-field cron.
2. **Mint the restricted `ops` key + read the project id** — provider-
   independent:

   ```bash
   shipeasy sdk keys create --type ops --json     # the run authenticates with this
   ```

   plus the `.shipeasy` project id. (For `claude`, `shipeasy ops trigger prep`
   mints this for you — see `references/claude.md`.)
3. **Build the trigger prompt** — the create command's help includes the shared
   trigger-prompt template; substitute the `ops` key, project id, and the host's
   install line.
4. **Provision the schedule on that platform** per the printed instructions —
   create the native automation or write the system-cron / GitHub Actions
   `schedule:` job. Use the **Bash tool** to run any CLI/API steps; for UI-only
   steps (e.g. Cursor's PR toggle, a routine token) walk the user through them.
5. **Verify** with one manual fire and confirm a PR (or empty-queue exit), and
   hand off where to pause/inspect it. For the Shipeasy-fireable providers,
   `shipeasy ops trigger create <provider> …` (step 4's runbook) registers the
   connector itself.

Respect `--dry-run` (print the plan + prompt, mint nothing) and the shared hard
rules in `SKILL.md` (restricted `ops` key, never print secrets, confirm before a
paid fire).
