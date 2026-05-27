---
name: setup
description: End-to-end onboarding for Shipeasy in a target app or monorepo — detect subprojects, install SDK per subproject, authenticate, bind to a project, create keys, wire SDK into entry points, and verify. Trigger on "set up shipeasy", "install shipeasy", "onboard shipeasy", "first-time integration".
user-invocable: true
---

# Setting up Shipeasy in a target app

You are an AI agent walking the user through the **base** Shipeasy install
(the part every project needs regardless of which features it enables).
Follow these steps in order. Each step has a verification gate — do not
advance if it fails. Self-heal once, then escalate.

The feature install commands (`/shipeasy:bugs:install`,
`/shipeasy:flags:install`, `/shipeasy:configs:install`,
`/shipeasy:ks:install`, `/shipeasy:experiments:install`,
`/shipeasy:metrics:install`, `/shipeasy:i18n:install`) each pick up
where this one leaves off. Run this skill **first**.

---

## Operating rules (read before doing anything)

1. **Use the Bash tool for every CLI command.** Never instruct the user
   to run `shipeasy login`, `pnpm add ...`, etc. in their own terminal.
   The MCP server cannot run interactive flows over stdio; the Bash tool
   on the Claude Code side can. Run CLI commands yourself.
2. **`shipeasy login` is interactive but agent-runnable.** Spawn it via
   Bash. The CLI prints a URL and opens the user's default browser. The
   user clicks "Authorize" in that browser; the CLI exits 0. Do **not**
   ask the user to copy/paste commands — just run it and wait.
3. **Never `npm publish`, never `git commit`, never `git push`.** This
   skill stops at "ready to commit". The user commits.
4. **Never log a server key.** Strip `sdk_server_*` from any chat output
   you emit, even on error.
5. **One project per app, always bound.** `.shipeasy` is mandatory and
   lives at the **monorepo root** (one project_id covers every subproject
   in the repo). Commit it.
6. **One configure call per runtime.** Never write `src/lib/shipeasy.ts`
   wrappers or per-feature config files.
7. **JS-ONLY SDK install.** The only published Shipeasy SDKs are
   `@shipeasy/sdk` and `@shipeasy/react` on npm. **NEVER** run
   `gem install`, `bundle add`, `pip install`, `poetry add`, `go get`,
   `go mod tidy` (with intent to add a shipeasy dep), `composer require`,
   `mvn install`, `gradle … --refresh-dependencies`, `swift package
add-dependency`, or any other non-npm package manager during this
   skill. If a subproject is Ruby/Python/Go/Java/PHP/Swift, **only print
   a one-line "no SDK published yet" notice** and move on. Failing to
   follow this rule WILL break unrelated parts of the user's project
   (Gemfile.lock churn, pyproject regressions, etc.). This is
   non-negotiable.

---

## 0. Preconditions

Run via Bash:

```bash
node --version            # require >= 20
git rev-parse --show-toplevel
```

If Node `<20`: surface to user (don't auto-upgrade). If not in a repo and
the directory is non-empty: ask the user before `git init`.

---

## 1. Detect subprojects (monorepo-aware)

The "target" may be a single app **or** a monorepo with multiple
subprojects (frontend + backend, web + mobile, …). Build the list of
install targets before running any package-manager commands.

```bash
find . -maxdepth 4 \
  \( -path './node_modules' -o -path '*/node_modules/*' \
     -o -path '*/vendor/*' -o -path '*/dist/*' -o -path '*/.next/*' \
     -o -path '*/build/*' -o -path '*/.git' \) -prune -o \
  \( -name 'package.json' -o -name 'pyproject.toml' -o -name 'Gemfile' \
     -o -name 'go.mod' -o -name 'pom.xml' -o -name 'composer.json' \
     -o -name 'Package.swift' -o -name 'build.gradle*' \) -print
```

Classify each hit:

| Manifest found             | Language    | Default SDK install command (run from that dir)            | Published? |
| -------------------------- | ----------- | ---------------------------------------------------------- | ---------- |
| `package.json` (+ React)   | js-react    | `pnpm add @shipeasy/sdk @shipeasy/react` (auto-detect pm)  | ✓ npm      |
| `package.json` (Node only) | js-node     | `pnpm add @shipeasy/sdk`                                   | ✓ npm      |
| `pyproject.toml`           | python      | (no PyPI package yet — instruct user, do not auto-install) | ✗          |
| `Gemfile`                  | ruby        | (no RubyGems yet — instruct user)                          | ✗          |
| `go.mod`                   | go          | (no Go module yet — instruct user)                         | ✗          |
| `pom.xml` / `build.gradle` | java/kotlin | (no Maven Central yet — instruct user)                     | ✗          |
| `composer.json`            | php         | (no Packagist yet — instruct user)                         | ✗          |
| `Package.swift`            | swift       | (no SPM yet — instruct user)                               | ✗          |

A monorepo with `apps/web/package.json` (React) and `apps/api/go.mod`
(Go backend) → two targets: install JS SDK in `apps/web`, surface "no Go
SDK published yet" for `apps/api` and continue.

**Skip** any directory whose `package.json` already has `@shipeasy/sdk`
in deps. That subproject is already onboarded.

**Skip** the monorepo-root `package.json` if it's purely a workspace root
(no `dependencies` / `devDependencies` beyond tooling). Don't install
SDKs at the root.

Print the final target list before proceeding.

---

## 2. Authenticate + bind in one step

```bash
cd "$(git rev-parse --show-toplevel)"
shipeasy whoami    # check first — skip login if already authed
shipeasy login     # if not logged in
shipeasy whoami    # re-verify
```

What `shipeasy login` does end-to-end:

1. Generates a PKCE pair, opens the default browser at `{app_base}/cli-auth?...`.
2. Browser page lets the user pick an existing project OR create a new
   one (name + production domain). Project creation is idempotent on
   `(owner_email, domain)`.
3. CLI polls `/auth/device/poll`, receives `{ token, project_id, project_name }`.
4. Writes `~/.config/shipeasy/config.json` (mode 0600).
5. Auto-writes `.shipeasy` in cwd with the returned project_id.

Verify:

```bash
shipeasy whoami | grep -q "Bound dir" && echo OK
test -f .shipeasy && grep project_id .shipeasy
git status --short .shipeasy
```

Self-heal:

- `401` from any later step → token rejected; `shipeasy logout && shipeasy login`, retry once.
- Headless / SSH (no `DISPLAY`) → re-run `shipeasy login --no-browser`, surface the URL **once**.
- Wrong browser account → instruct user to log out, retry. Max two attempts.

**Hard rule: one Shipeasy project per website / repo / app.** The
monorepo root holds the single `.shipeasy`. Subprojects inherit by
walking up the tree (same pattern as `.git`).

---

## 3. Create server + client SDK keys

```bash
shipeasy keys create --type server --json
shipeasy keys create --type client --json
```

Capture the `key` field from each JSON. Plaintext shown once — write to
the secret store in step 4 and discard immediately.

Verify: `shipeasy keys list` shows ≥1 server and ≥1 client row.

---

## 4. Install the SDK + persist keys — per subproject

### 4a. JS targets (`js-react`, `js-node`)

```bash
cd <subproject-dir>
pnpm add @shipeasy/sdk @shipeasy/react       # js-react
pnpm add @shipeasy/sdk                        # js-node
```

Pre-flight: if `zod` is pinned `< 4`, npm errors with `ERESOLVE`. Use
`pnpm add --strict-peer-dependencies=false`.

| Detected secret store                      | Action                                                           |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `wrangler.toml` / `wrangler.jsonc`         | `wrangler secret put SHIPEASY_SERVER_KEY` (interactive via Bash) |
| Next.js / Vite / Astro / SvelteKit / Remix | append to `<subproject>/.env.local`                              |
| Vercel (`.vercel/` or `vercel.json`)       | `vercel env add SHIPEASY_SERVER_KEY production`                  |
| Netlify (`netlify.toml`)                   | `netlify env:set SHIPEASY_SERVER_KEY …`                          |
| Doppler / Infisical / 1Password CLI        | use that CLI                                                     |
| Nothing detected                           | create `<subproject>/.env.local`, confirm it's gitignored        |

Variable names:

```
SHIPEASY_SERVER_KEY=sdk_server_…
NEXT_PUBLIC_SHIPEASY_CLIENT_KEY=sdk_client_…   # Next.js
VITE_SHIPEASY_CLIENT_KEY=sdk_client_…          # Vite
PUBLIC_SHIPEASY_CLIENT_KEY=sdk_client_…        # Astro / SvelteKit / generic
```

### 4b. Non-JS targets

Surface a one-line notice and continue. Do **not** invent a pip/gem/go-get install.

### Hard rules

- Never commit a server key. Confirm `.env.local` is in `.gitignore` before any `git add`.
- Never echo a server key into chat output, PR descriptions, commit messages, or test fixtures.

---

## 5. Initialize the SDK — one configure call per JS subproject

### 5a. Next.js App Router subproject

Edit `<subproject>/app/layout.tsx` (or `<subproject>/src/app/layout.tsx`)
— whichever exists. Render `getBootstrapHtml()` into `<head>`. Without
it, client-side flag evaluation pays an extra round-trip on first paint
and the devtools overlay (used by the `bugs` feature) never appears.

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

### 5b. Vite / CRA / plain HTML

Call `shipeasy({ apiKey: ... })` once near the top of `main.ts` / `main.tsx`.

### 5c. Node service (`js-node`, no React)

```ts
import { shipeasy } from "@shipeasy/sdk/server";
await shipeasy({ apiKey: process.env.SHIPEASY_SERVER_KEY ?? "" });
```

---

## 6. Drop project-level pointer skill

Write `<repo-root>/.claude/skills/shipeasy-setup/SKILL.md` (create the
directory if missing). This pointer lets fresh checkouts and new
contributors re-run `/shipeasy:install` without already having the
plugin loaded. **Do not overwrite an existing pointer unless the user
asked for a refresh.**

Body of the pointer file:

````markdown
---
name: shipeasy-setup
description: Project pointer — Shipeasy is integrated here. Triggers on "set up shipeasy", "onboard shipeasy", "new contributor shipeasy".
---

# Shipeasy is integrated in this repo

This project uses Shipeasy. The full skill lives in the `shipeasy`
Claude Code plugin. This file is the breadcrumb so new contributors
can find their way without the plugin pre-installed.

## With plugin installed

`/shipeasy:install` or invoke the `shipeasy-setup` skill.

## Without the plugin

```bash
claude plugin marketplace add shipeasy-ai/shipeasy
claude plugin install shipeasy@shipeasy
/shipeasy:install
```

Cursor / Windsurf / non-Claude harness:

```bash
npx @shipeasy/cli plugin install
```

## Feature add-ons (run after base)

- `/shipeasy:bugs:install` — in-app bug reports
- `/shipeasy:flags:install` — feature gates, configs, kill switches
- `/shipeasy:experiments:install` — A/B experiments
- `/shipeasy:i18n:install` — translations
````

---

## 7. Final verification gate

```bash
cd "$(git rev-parse --show-toplevel)"
shipeasy whoami
test -f .shipeasy && grep project_id .shipeasy
shipeasy keys list
shipeasy modules list

# Per JS subproject:
( cd <subproject> && (pnpm build || npm run build) )
```

Every line must pass before reporting "done".

---

## 8. Hand-off report

```
✅ Shipeasy base installed
Project:   <project_id>
Keys:      server *…<last4>, client *…<last4>
Wired:     <list of subprojects + entry files>
Pointer:   .claude/skills/shipeasy-setup/SKILL.md
Modules:   (none enabled yet)

Next — enable the features you want:
  /shipeasy:experiments:install   # A/B tests
  /shipeasy:metrics:install       # event metrics
  /shipeasy:flags:install         # feature gates (boolean)
  /shipeasy:configs:install       # dynamic configs (typed values)
  /shipeasy:ks:install            # kill switches
  /shipeasy:i18n:install          # translations
  /shipeasy:bugs:install          # in-app bug reports

Or via CLI directly:
  shipeasy modules enable experiments
  shipeasy modules enable events
  shipeasy modules enable gates && shipeasy modules enable configs
  shipeasy modules enable translations
  shipeasy modules enable feedback

Dashboard:  https://app.shipeasy.ai/projects/<project_id>
```

---

## 9. Ask the user to commit

```bash
git status
git diff --stat
git add .shipeasy .claude/skills/shipeasy-setup <subproject>/package.json <subproject>/<lockfile> <entry-files>
git commit -m "chore: onboard Shipeasy base (SDK + auth + bind)"
```

Confirm `.env.local` is gitignored before any `git add`. Never `git add -A`.
