# Provider: `copilot` (GitHub Copilot coding agent — cold-fire connector)

**Mechanism.** A **cold-fire connector**: Shipeasy's backend starts a **Copilot
coding-agent task** on the repo via GitHub's **agent-tasks API**; it opens a PR
hands-off. There is no command to run and no scheduled routine — Shipeasy fires
it **on every new bug / feature request and on demand**. A fixed cadence is the
platform's native scheduler (linked in docs). Copilot automations run in
**private/internal repos**.

**Key difference from cursor/jules:** the Copilot agent reads its environment
from the **repo's own Agents secret store**, NOT from Shipeasy. So the `ops` key
is **not stored with the connector** — the user pastes it into the repo secrets.

**Authoritative runbook:** the create command's built-in help. Follow it verbatim.

```bash
shipeasy ops trigger create copilot --help
```

## Flow

1. **Mint the restricted `ops` key** (`shipeasy sdk keys create --type ops --json`).
   It then has to go into the repo's **Agents secret store — BROWSER-ONLY**
   (**Settings → Secrets and variables → Copilot**): `SHIPEASY_CLI_TOKEN` = the
   `ops` key, `SHIPEASY_PROJECT_ID` = the project id. Don't dictate the clicks —
   **open the dashboard** (`…/triggers?provider=copilot`, see "Opening the
   filtered trigger page" in `SKILL.md`); it shows the exact secret names and
   where to paste them.
2. **Collect the connection inputs:**
   - Repo owner + repo name, base branch (optional, defaults to `main`).
   - A **fine-grained personal access token** with the **"Agent tasks"**
     repository permission (read & write) for a Copilot-licensed account, from
     `github.com/settings/personal-access-tokens`. The default Actions token
     will not work — the API requires a user token.
3. **Register the connector** — `shipeasy ops trigger create copilot …` with
   owner/repo/baseRef + the PAT (per the `--help` runbook). The `ops` key is
   NOT passed here (it lives in the repo secrets).
4. **Verify** — one manual fire and confirm a PR (or empty-queue exit).

Respect `--dry-run` and the shared hard rules in `SKILL.md` (restricted `ops`
key, never print secrets, confirm before a paid fire).
