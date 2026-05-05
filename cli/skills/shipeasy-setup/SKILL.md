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

Determine the framework from the file layout (no `shipeasy detect` /
`shipeasy-mcp call` shell wrapper exists — read files directly):

```bash
test -f src/app/layout.tsx && echo nextjs-app
test -f app/layout.tsx     && echo nextjs-app
test -f pages/_document.tsx && echo nextjs-pages
test -f index.html         && echo react-vite
```

If MCP is registered, `mcp tool: detect_project` returns the same info in
structured form (preferred when available).

## 1. Install runtime packages

Detect the package manager (lockfile or `package-manager-detector`) and install
the SDK:

```bash
pnpm add @shipeasy/sdk
# or: npm install @shipeasy/sdk
```

Verify pinned: `npm ls @shipeasy/sdk`. Don't `require()` the SDK's
`package.json` — that subpath isn't in `exports`.

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

The Next.js layout file is at `app/layout.tsx` **or** `src/app/layout.tsx`
— edit whichever exists. The `shipeasy()` call uses `await`, so the layout
function must be `async` (convert it if it isn't):

```ts
// app/layout.tsx (or src/app/layout.tsx)
import { shipeasy } from "@shipeasy/sdk/server";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await shipeasy({ apiKey: process.env.SHIPEASY_SERVER_KEY ?? "" });
  return <html lang="en"><body>{children}</body></html>;
}
```

For Next.js App Router with the loader script (step 6), client-side init is
**not needed** — the loader handles it. Skip ahead.

For projects without the loader (Vite, CRA, plain HTML), call client init at
the entry:

```ts
import { shipeasy } from "@shipeasy/sdk/client";
shipeasy({ apiKey: process.env.NEXT_PUBLIC_SHIPEASY_CLIENT_KEY ?? "" });
```

For Next.js without a loader, create `app/_shipeasy-client.tsx`:

```tsx
"use client";
import { shipeasy } from "@shipeasy/sdk/client";
import { useEffect } from "react";
export function ShipeasyClient() {
  useEffect(() => {
    shipeasy({ apiKey: process.env.NEXT_PUBLIC_SHIPEASY_CLIENT_KEY ?? "" });
  }, []);
  return null;
}
```

…and import `<ShipeasyClient />` in `<body>` of your root layout.

## 6. Inject the i18n loader (optional)

Pick the profile name first — the CLI does **not** auto-create profiles. If
you don't already have one, create it before running install-loader:

```bash
shipeasy i18n profiles list                              # see what's there
shipeasy i18n profiles create default --locales en       # only if missing
shipeasy i18n install-loader --profile default
```

The CLI auto-detects framework, injects into `layout.tsx` /
`pages/_document.tsx` / `index.html`, and reuses an existing client key
from `.env*` / `.shipeasy` instead of creating a new one on every run. The
`.shipeasy` cache file is added to `.gitignore` automatically.

Self-heal: if framework is `unknown` or the layout has no `<head>` element
(common with Next 13+ Metadata API), re-run with `--print` and ask the user
where to paste the tag.

## 7. Register the MCP server, plus skills/plugin (pick one)

```bash
shipeasy mcp install --scope user            # writes to ~/.claude/settings.json + ~/.cursor/mcp.json
# or:
shipeasy mcp install --scope project         # writes to .mcp.json + .cursor/mcp.json + .windsurf/mcp.json
```

Verify: `shipeasy mcp status` (prints scope = $HOME / cwd, then per-config
yes/no rows). Restart the AI assistant after.

Then add slash commands and/or skills:

```bash
shipeasy plugin install     # → .claude/commands/ + .claude/skills/ (canonical paths; auto-picks up)
# or skills only:
shipeasy skills install     # → .claude/skills/
```

`shipeasy plugin install` also writes a `.claude/plugins/shipeasy/` manifest
for marketplace-style layouts, but Claude Code reads the
`.claude/commands/` and `.claude/skills/` paths directly — no `/plugin`
registration needed. `shipeasy mcp install` already wired the MCP server
for all three assistants in step 7's first command.

## 8. Find or create the first translation keys

Confirm the profile exists (the CLI does **not** auto-create), then discover
and push:

```bash
shipeasy i18n profiles list
shipeasy i18n profiles create default --locales en   # only if missing
shipeasy i18n scan src --json                        # use `app` for app/-only projects
```

The scan output uses `kind: "jsx_text" | "jsx_attr" | "template_literal" | …`.
There is no `wrapped` / `candidate` field — every row is a candidate. Pass
`--keys-only` to filter to existing `t(...)` call sites.

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

`i18n_validate_keys` only checks wrapped `t(...)` references in code; a
"no i18n key references found" return after a 900-row scan is expected if
no calls have been wrapped yet.

Errors → action:

| Error                        | Action                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `409 key exists`             | Leave it.                                                                                 |
| `401`                        | Re-run `shipeasy login`, retry **once**.                                                  |
| `429` plan-limit             | Surface to user; do not auto-upgrade.                                                     |
| `Profile '<name>' not found` | `shipeasy i18n profiles create <name> --locales en` (or `mcp tool: i18n_create_profile`). |

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

## 11. Ask the user to commit

Onboarding wrote real changes. Show the diff footprint and **propose** the
commit — don't run it yourself. Stage only the files you authored (never
`git add -A`). Confirm `.env.local` is gitignored before any `git add`.

```bash
git status
git diff --stat
# Then propose to the user (do not run yourself):
git add <listed files>
git commit -m "chore: onboard Shipeasy (SDK + i18n loader + MCP)"
```

If the codemod modified many source files, suggest splitting into two
commits — install plumbing first, codemod-applied i18n wrapping second —
so the diff stays reviewable.

## Operating rules

1. **One configure call.** Never wrap the SDK.
2. **Vanilla JS.** Anything you build must work without React.
3. **Confirm before destructive ops** (revoking keys, overwriting MCP configs).
4. **Never log server keys.** Strip them from any chat output.
5. **Self-heal once, then escalate.** Don't loop.
6. **Verify, don't trust.** Run the verification command before advancing.
