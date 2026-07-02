# Provider: `cursor` (Cursor cloud agent — cold-fire connector)

**Mechanism.** A **cold-fire connector**: Shipeasy's own backend launches a
**Cursor cloud agent** through Cursor's API (one stored key + one HTTPS POST),
and it opens a PR via Cursor's GitHub App. There is **no command to run in
Cursor** and no scheduled routine — Shipeasy fires it **on every new bug /
feature request and on demand** ("Trigger now"). A fixed cadence, if wanted, is
Cursor's own native scheduler (linked in docs). Cursor cloud agents run in **Max
Mode** (billed on Cursor usage).

**Authoritative runbook:** the create command's built-in help. Follow it verbatim.

```bash
shipeasy ops trigger create cursor --help
```

## Flow

1. **Mint the restricted `ops` key** (`shipeasy sdk keys create --type ops --json`).
   It is **stored with the connector** and Shipeasy injects it as
   `SHIPEASY_CLI_TOKEN` into the agent's environment — it never appears in the
   prompt.
2. **Collect the connection inputs:**
   - Repository URL (`https://github.com/owner/repo`).
   - Branch (optional, defaults to `main`).
   - **Cursor API key** — created at `cursor.com/dashboard → API Keys` (a
     service-account key is ideal for an unattended trigger).
3. **Register the connector** — `shipeasy ops trigger create cursor …` with the
   repo, branch, Cursor API key, and the `ops` key (per the `--help` runbook).
   This is what makes it fireable.
4. **Verify** — one manual fire and confirm a PR (or empty-queue exit).

Respect `--dry-run` and the shared hard rules in `SKILL.md` (restricted `ops`
key, never print secrets, confirm before a paid fire).
