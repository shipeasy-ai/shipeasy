---
name: shipeasy-setup
description: End-to-end onboarding for Shipeasy in a target app — install SDK packages, run `shipeasy login`, create server/client keys, persist them to the right secret store, inject the i18n loader, register the MCP server, and verify. Trigger on "set up shipeasy", "install shipeasy", "onboard shipeasy", or any first-time integration request.
user-invocable: true
---

# Setting up Shipeasy in a target app

You are an AI agent walking a user through Shipeasy installation. Follow these
steps **in order**. Each step has a verification gate — do not advance if the
verification fails. Self-heal once, then escalate to the user.

## 0. Preconditions

```bash
node --version            # require >= 20
git rev-parse --show-toplevel
```

Run `mcp tool: detect_project` (if MCP is registered) or read `package.json`
to determine framework: `nextjs-app`, `nextjs-pages`, `react-vite`, or `unknown`.

## 1. Install runtime packages

Use the project's package manager (detect via `package-manager-detector`):

```bash
pnpm add @shipeasy/sdk
pnpm add @shipeasy/react      # only if React is present
```

Verify: `node -e "console.log(require('@shipeasy/sdk/package.json').version)"`.

## 2. Authenticate (browser, PKCE)

```bash
shipeasy login
```

Opens the browser at `{app_base}/cli-auth`. The user signs in (GitHub / Google /
magic link), picks or creates a project, and the CLI writes credentials to
`~/.config/shipeasy/config.json` (mode 0600).

Verify: `shipeasy whoami`. Self-heal: if "not logged in", retry **once**.
Headless? Re-run with `--no-browser` and surface the URL.

## 3. Create server + client SDK keys

```bash
shipeasy keys create --type server --json
shipeasy keys create --type client --json
```

Capture the `key` field from each response. **Plaintext is shown once — write
it to the secret store immediately (step 4) and discard the response.**

Verify: `shipeasy keys list` shows ≥1 server and ≥1 client row.

## 4. Persist keys to the app's secret store

Match the first detected store:

| Detected                             | Action                                           |
| ------------------------------------ | ------------------------------------------------ |
| `wrangler.toml` / `wrangler.jsonc`   | `wrangler secret put SHIPEASY_SERVER_KEY`        |
| `.env.local` exists or is gitignored | append to `.env.local`                           |
| Vercel (`.vercel/` or `vercel.json`) | `vercel env add SHIPEASY_SERVER_KEY production`  |
| Netlify (`netlify.toml`)             | `netlify env:set SHIPEASY_SERVER_KEY …`          |
| Doppler / Infisical / 1Password CLI  | use that CLI                                     |
| Nothing                              | create `.env.local`, ensure it's in `.gitignore` |

Variable names by framework:

```
SHIPEASY_SERVER_KEY=sdk_server_…
NEXT_PUBLIC_SHIPEASY_CLIENT_KEY=sdk_client_…   # Next.js
VITE_SHIPEASY_CLIENT_KEY=sdk_client_…          # Vite
PUBLIC_SHIPEASY_CLIENT_KEY=sdk_client_…        # Astro / SvelteKit / generic
```

Hard rules:

- Never commit a server key. Confirm gitignored before writing.
- Never echo a server key into chat output, PR descriptions, or commit messages.

## 5. Initialize the SDK — one configure call

There is exactly one entry point per runtime. **Never** create
`src/lib/shipeasy.ts` wrappers, separate `i18n.init()` calls, or per-feature
configuration files.

```ts
// Server (Next.js root layout — once)
import { shipeasy } from "@shipeasy/sdk/server";
await shipeasy({ apiKey: process.env.SHIPEASY_SERVER_KEY ?? "" });
```

```ts
// Client (root client component or app entry)
import { shipeasy } from "@shipeasy/sdk/client";
shipeasy({ apiKey: process.env.NEXT_PUBLIC_SHIPEASY_CLIENT_KEY ?? "" });
```

For static HTML / Vite, prefer the loader script tag (step 6) over a JS import.

## 6. Inject the i18n loader (optional)

```bash
shipeasy i18n install-loader --profile default
```

The CLI auto-detects framework and injects into `layout.tsx` /
`pages/_document.tsx` / `index.html`. Self-heal: if framework is `unknown`,
re-run with `--print` and ask the user where to paste the tag.

## 7. Register the MCP server

```bash
shipeasy mcp install --scope user            # writes to ~/.claude/settings.json + ~/.cursor/mcp.json
# or:
shipeasy mcp install --scope project         # writes to .mcp.json + .cursor/mcp.json + .windsurf/mcp.json
```

Verify: `shipeasy mcp status`. Restart the AI assistant.

Then optionally pull in skills + plugin so future sessions know the workflows:

```bash
shipeasy skills install                      # all bundled skills
shipeasy plugin install                      # slash commands + codemods
```

## 8. Find or create the first translation keys

Discover, then push:

```bash
shipeasy i18n scan src --json
```

For each chosen candidate, either wrap in code with `i18n.t()` (see the
`shipeasy-i18n` skill) or push raw key/value pairs:

```bash
echo '{"landing.hero.title":"Ship faster"}' > /tmp/keys.json
shipeasy i18n push /tmp/keys.json --profile default
```

If MCP is registered, prefer the structured tools instead — they give the agent
typed errors:

- `mcp tool: i18n_create_profile { "name": "default", "locales": ["en"] }`
- `mcp tool: i18n_create_key { "key": "landing.hero.title", "value": "Ship faster", "profile": "default" }`
- `mcp tool: i18n_publish_profile { "profile": "default" }`

Errors → action:

| Error            | Action                                   |
| ---------------- | ---------------------------------------- |
| `409 key exists` | Leave it.                                |
| `401`            | Re-run `shipeasy login`, retry **once**. |
| `429` plan-limit | Surface to user; do not auto-upgrade.    |
| Profile missing  | Create it with `i18n_create_profile`.    |

## 9. Final verification gate

All must pass:

```bash
shipeasy whoami
shipeasy keys list                   # server + client
shipeasy mcp status                  # ≥1 'yes' row
pnpm build                           # target app still builds
```

## 10. Hand-off report

End with a short summary the user can scan in 5 seconds:

```
✅ Shipeasy installed
Project: <project_id>
Keys: server *…<last4>, client *…<last4>
Wired: SDK init in <file>, loader in <file>
MCP: <list of clients with 'shipeasy' entry>
Skills/Plugin: <which were installed>
i18n: <N> keys pushed to profile `default`

Try next:
  /shipeasy-i18n-extract     # slash command — extract hardcoded strings
  shipeasy flags create --help
  Open dashboard: https://app.shipeasy.ai/projects/<project_id>
```

## Operating rules

1. **One configure call.** Never wrap the SDK.
2. **Vanilla JS.** Anything you build must work without React.
3. **Confirm before destructive ops** (revoking keys, overwriting MCP configs).
4. **Never log server keys.** Strip them from any chat output.
5. **Self-heal once, then escalate.** Don't loop.
6. **Verify, don't trust.** Run the verification command before advancing.
