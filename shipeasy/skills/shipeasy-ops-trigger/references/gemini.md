# Provider: `gemini` / `jules` (Google Jules — cold-fire connector)

"Gemini" here means **Jules** — Google's async coding agent (powered by Gemini).
`jules` and `gemini` are aliases for the same provider.

**Mechanism.** A **cold-fire connector**: Shipeasy's backend starts a **Jules
session** on the repo (one stored key + one HTTPS POST) and it opens a PR. No
command to run, no scheduled routine — Shipeasy fires it **on every new bug /
feature request and on demand**. A fixed cadence is the platform's native
scheduler (linked in docs). (Prefer the Gemini CLI in GitHub Actions instead?
That's a separate path — see the docs long-tail / `references/other-platforms.md`.)

**Key detail:** Jules exposes **no environment channel**, so Shipeasy passes the
restricted `ops` key **inside the session prompt**. That's safe because it's the
limited `ops` credential (read queue / create only, 7-day expiry).

**Authoritative runbook:** the create command's built-in help. Follow it verbatim.

```bash
shipeasy ops trigger create jules --help    # alias: gemini
```

## Flow

1. **Mint the restricted `ops` key** (`shipeasy sdk keys create --type ops --json`).
   It is **stored with the connector** and injected into the session prompt.
2. **Collect the connection inputs:**
   - Repository as `owner/repo` (Shipeasy addresses it as
     `sources/github/owner/repo`).
   - Branch (optional, defaults to `main`).
   - **Jules API key** — connect the repo and create a key in the **Jules web
     app → Settings** (`jules.google`; max 3 keys per account).
3. **Register the connector** — `shipeasy ops trigger create jules …` with the
   source, branch, Jules API key, and the `ops` key (per the `--help` runbook).
4. **Verify** — one manual fire and confirm a PR (or empty-queue exit).

Respect `--dry-run` and the shared hard rules in `SKILL.md` (restricted `ops`
key, never print secrets, confirm before a paid fire).
