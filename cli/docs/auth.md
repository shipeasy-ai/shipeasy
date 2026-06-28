# Auth + project scope

Every API command resolves **who** (credential) and **which project** before it
runs. Two inputs, combined in `src/api/client.ts`:

1. **Creds file** — `loadCredentials()` (`src/auth/storage.ts`):
   - `SHIPEASY_CLI_TOKEN` + `SHIPEASY_PROJECT_ID` env vars (highest precedence), else
   - `$XDG_CONFIG_HOME/shipeasy/config.json` (default `~/.config/shipeasy/config.json`),
     written by `shipeasy login`. Holds `cli_token`, `project_id` (session default), `app_base_url`.
2. **`.shipeasy` binding** — `getBoundProjectId()` (`src/util/project-config.ts`):
   a `.shipeasy` file found by walking **up** from the cwd (like `.git`), written
   by `shipeasy bind`. Pins the directory to a specific project.

## Resolution order (project id)

```
--project <id>            (explicit flag, highest)
  └─ .shipeasy binding    (cwd / ancestor)
       └─ creds session   (config.json project_id, fallback)
```

Mutating commands (`requireBinding`) **refuse to run** without `--project` or a
`.shipeasy` binding — so a session logged into project A can't silently write to
project B from the wrong cwd.

## What the client sends

`getGeneratedClient()` configures the generated `@shipeasy/openapi/client` with:

- `baseUrl` = `creds.app_base_url`
- header `X-SDK-Key` = `creds.cli_token`
- header `X-Project-Id` = the resolved project id

The admin API authenticates the CLI token via **`X-SDK-Key`** (not bearer). The
generated sdk fns inherit these headers from the configured client, so every
generated command is authenticated + scoped with no per-call threading.

`getApiClient()` is the low-level `fetch` equivalent for the hand-written custom
commands (i18n batch, key minting, setup, `whoami`); same headers, same resolution.

## Tests

`src/__tests__/auth-resolution.test.ts` asserts the full chain end-to-end:
`.shipeasy` walk-up, creds-file load, the bound-dir-wins / `--project`-override /
env-precedence ordering, and that it all lands on `X-Project-Id` / `X-SDK-Key`
of the configured client. A `whoami` runtime smoke confirms a real request
reaches the live API with the credential.
