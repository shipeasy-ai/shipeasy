---
name: shipeasy-setup
description: End-to-end onboarding for Shipeasy in a target app — install SDK, authenticate, bind to a project, create keys, wire the SDK into the root layout, and verify. Trigger on "set up shipeasy", "install shipeasy", "onboard shipeasy", "first-time integration".
user-invocable: true
---

# Setting up Shipeasy in a target app

You are an AI agent walking the user through the **base** Shipeasy install
(the part every project needs regardless of which features it enables).
Follow these steps in order. Each step has a verification gate — do not
advance if the verification fails. Self-heal once, then escalate to the
user.

The corresponding feature plugins (`shipeasy@experiments-metrics`,
`shipeasy@configs-gates`, `shipeasy@polylang`, `shipeasy@bugs`) each ship
their own onboarding skill that picks up where this one leaves off. Run
this skill **first**.

---

## 0. Preconditions

```bash
node --version            # require >= 20
git rev-parse --show-toplevel
```

Determine the framework from the file layout:

```bash
test -f src/app/layout.tsx  && echo "→ nextjs-app (src/app)"
test -f app/layout.tsx      && echo "→ nextjs-app (app)"
test -f pages/_document.tsx && echo "→ nextjs-pages"
test -f index.html          && echo "→ react-vite (or static HTML)"
```

If MCP is registered, `mcp tool: detect_project` returns the same info in
structured form (preferred when available).

## 1. Install runtime packages

Detect the package manager (lockfile or `package-manager-detector`) and
install **both** SDK packages in a single command:

```bash
pnpm add @shipeasy/sdk @shipeasy/react
# or: npm install @shipeasy/sdk @shipeasy/react
# Skip @shipeasy/react if the project has no React.
```

Pre-flight: if `zod` is pinned major `< 4`, npm errors with `ERESOLVE`
(pnpm/yarn handle it). Use `npm install --legacy-peer-deps` or
`pnpm add --strict-peer-dependencies=false` in that case.

Verify: `npm ls @shipeasy/sdk @shipeasy/react`.

## 2. Authenticate AND bind the repo to a project — mandatory

### 2a. Log in

```bash
shipeasy login
```

Opens the browser at `{app_base}/cli-auth`. User signs in (GitHub / Google
/ magic link), picks **any** project they own, and the CLI writes
credentials to `~/.config/shipeasy/config.json` (mode 0600).

Verify: `shipeasy whoami`. Headless? Re-run with `--no-browser`.

### 2b. Upsert this app's project, keyed by domain

```bash
shipeasy projects upsert --domain <production-domain>
```

Idempotent on `(owner_email, domain)`. Creates the project on first run,
no-ops on later runs. Auto-binds — writes `.shipeasy` in `cwd`.

**Hard rule: one Shipeasy project per website / repo / app.** Use the
production domain, not `localhost`. Never reuse a project across two
unrelated apps. Without `.shipeasy`, every CLI/MCP write silently routes
to whatever project the machine was last logged into.

Verify: `shipeasy whoami` shows "Bound dir: <uuid>". `cat .shipeasy` shows
a `project_id`. `git status` lists `.shipeasy` as new (commit it; do not
gitignore).

## 3. Create server + client SDK keys

```bash
shipeasy keys create --type server --json
shipeasy keys create --type client --json
```

Capture the `key` field from each response. **Plaintext is shown once** —
write to the secret store immediately (step 4) and discard.

Verify: `shipeasy keys list` shows ≥1 server and ≥1 client row.

## 4. Persist keys to the app's secret store

Match the first detected store:

| Detected                                       | Action                                           |
| ---------------------------------------------- | ------------------------------------------------ |
| `wrangler.toml` / `wrangler.jsonc`             | `wrangler secret put SHIPEASY_SERVER_KEY`        |
| Next.js / Vite / Astro / SvelteKit / Remix     | append to `.env.local`                           |
| Vercel (`.vercel/` or `vercel.json`)           | `vercel env add SHIPEASY_SERVER_KEY production`  |
| Netlify (`netlify.toml`)                       | `netlify env:set SHIPEASY_SERVER_KEY …`          |
| Doppler / Infisical / 1Password CLI configured | use that CLI                                     |
| Nothing                                        | create `.env.local`, ensure it's in `.gitignore` |

```
SHIPEASY_SERVER_KEY=sdk_server_…
NEXT_PUBLIC_SHIPEASY_CLIENT_KEY=sdk_client_…   # Next.js
VITE_SHIPEASY_CLIENT_KEY=sdk_client_…          # Vite
PUBLIC_SHIPEASY_CLIENT_KEY=sdk_client_…        # Astro / SvelteKit / generic
```

Hard rules:

- Never commit a server key. Confirm `.env.local` is gitignored before
  writing.
- Never echo a server key into chat output, PR descriptions, commit
  messages, or test fixtures.

## 5. Initialize the SDK — one configure call

There is exactly one entry point per runtime. **Never** create
`src/lib/shipeasy.ts` wrappers, separate `i18n.init()` calls, or
per-feature configuration files.

Edit `app/layout.tsx` (or `src/app/layout.tsx`). Render
`getBootstrapHtml()` into `<head>` — this is the canonical pattern.
Without it, client-side flag evaluation pays an extra round-trip on first
paint and the devtools overlay (used by `shipeasy@bugs`) never appears.

```tsx
import type { Metadata } from "next";
import { headers } from "next/headers";
import { shipeasy } from "@shipeasy/sdk/server";
import { i18n } from "@shipeasy/sdk/client";

async function configureShipeasy() {
  const h = await headers();
  return shipeasy({
    apiKey: process.env.SHIPEASY_SERVER_KEY ?? "",
    clientKey: process.env.NEXT_PUBLIC_SHIPEASY_CLIENT_KEY ?? "",
    urlOverrides: h.get("x-se-search") ?? undefined,
  });
}

export async function generateMetadata(): Promise<Metadata> {
  await configureShipeasy();
  return { title: "My App", description: i18n.t("layout.description") };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const seConfig = await configureShipeasy();
  return (
    <html lang="en">
      <head>
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: seConfig.getBootstrapHtml() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

For Vite / CRA / plain HTML, call `shipeasy({ apiKey: … })` once near the
top of `main.ts` / `main.tsx`.

## 6. Final verification gate

All must pass:

```bash
shipeasy whoami                                  # "Bound dir:" line shows project_id
test -f .shipeasy && grep project_id .shipeasy   # binding present
shipeasy keys list                               # ≥1 server, ≥1 client
shipeasy modules list                            # all off by default
pnpm build || npm run build                      # target app still builds
```

## 7. Hand-off report

```
✅ Shipeasy base installed
Project:   <project_id>
Keys:      server *…<last4>, client *…<last4>
Wired:     SDK init in <layout/file>
Modules:   (none enabled yet)

Next:
  claude plugin install shipeasy@experiments-metrics    # A/B tests + metrics
  claude plugin install shipeasy@configs-gates          # feature gates + configs + killswitches
  claude plugin install shipeasy@polylang               # translations
  claude plugin install shipeasy@bugs                   # in-app bug reports

Then enable the matching module:
  shipeasy modules enable experiments
  shipeasy modules enable gates && shipeasy modules enable configs
  shipeasy modules enable translations
  shipeasy modules enable feedback

Open the dashboard:  https://app.shipeasy.ai/projects/<project_id>
```

## 8. Ask the user to commit

```bash
git status
git diff --stat
# Then propose (do not run yourself):
git add package.json <lockfile> app/layout.tsx .env.local-pattern .shipeasy
git commit -m "chore: onboard Shipeasy base (SDK + auth + bind)"
```

Confirm `.env.local` is gitignored before any `git add`. Never `git add -A`.

## Operating rules

1. **One project per app, always bound.** `.shipeasy` is mandatory.
2. **One configure call.** Never wrap the SDK.
3. **Vanilla JS surface.** Anything you build must work without React.
4. **Confirm before destructive ops** (revoking keys, overwriting MCP configs).
5. **Never log server keys.** Strip them from any chat output.
6. **Self-heal once, then escalate.** Don't loop.
7. **Verify, don't trust.** Run the verification command before advancing.
