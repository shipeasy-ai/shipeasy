---
name: shipeasy-setup
description: End-to-end onboarding for Shipeasy in a target app or monorepo — detect subprojects, install SDK per subproject, authenticate, bind to a project, create keys, wire SDK into entry points, and verify. Trigger on "set up shipeasy", "install shipeasy", "onboard shipeasy", "first-time integration".
user-invocable: true
---

# Setting up Shipeasy in a target app

You are an AI agent walking the user through the **base** Shipeasy install
(the part every project needs regardless of which features it enables).
Follow these steps in order. Each step has a verification gate — do not
advance if it fails. Self-heal once, then escalate.

The corresponding feature plugins (`experiments-metrics@shipeasy`,
`configs-gates@shipeasy`, `polylang@shipeasy`, `bugs@shipeasy`) each ship
their own onboarding skill that picks up where this one leaves off. Run
this skill **first**.

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
# Find every package.json / pyproject.toml / Gemfile / go.mod / pom.xml /
# composer.json / Package.swift outside node_modules and vendor dirs.
# Limit depth so we don't recurse into deeply-nested fixtures.
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

Print the final target list before proceeding, e.g.:

```
Detected install targets:
  • apps/frontend   js-react   → @shipeasy/sdk @shipeasy/react
  • apps/backend    js-node    → @shipeasy/sdk
  • services/api    python     → ⚠ no SDK published yet; manual install
```

---

## 2. Authenticate + bind in one step (run via Bash, do not delegate)

```bash
cd "$(git rev-parse --show-toplevel)"
shipeasy whoami    # check first — skip login if already authed
# If not logged in:
shipeasy login
shipeasy whoami    # re-verify
```

What `shipeasy login` does end-to-end:

1. Generates a PKCE pair, opens the default browser at
   `{app_base}/cli-auth?...`.
2. **Browser page lets the user pick an existing project OR create a
   new one** (name + production domain). Project creation is idempotent
   on `(owner_email, domain)` — re-running login with the same domain
   re-uses the project, never duplicates.
3. CLI polls `/auth/device/poll`, receives `{ token, project_id,
project_name }`.
4. Writes `~/.config/shipeasy/config.json` (mode 0600).
5. **Auto-writes `.shipeasy` in cwd** with the returned project_id
   (when cwd has no existing binding). No separate `shipeasy projects
upsert` step needed.

Verify:

```bash
shipeasy whoami | grep -q "Bound dir" && echo OK
test -f .shipeasy && grep project_id .shipeasy
git status --short .shipeasy
```

If the directory already had a `.shipeasy` binding pointing at a
different project, `shipeasy login` leaves it in place and prints a
notice. To switch deliberately: `shipeasy bind <new_project_id>`.

Self-heal on `shipeasy login`:

- Exit code non-zero / `401` from any later step → token rejected;
  `shipeasy logout && shipeasy login`, retry once.
- Headless / SSH session (no `DISPLAY`, no `open` command) → re-run
  `shipeasy login --no-browser` and surface the URL **once** to the
  user. Do not loop.
- Browser session is for the wrong account → instruct the user to log
  out in the browser, then retry. Max two attempts.

**Hard rule: one Shipeasy project per website / repo / app.** The
monorepo root holds the single `.shipeasy`. Subprojects inherit by
walking up the tree (same pattern as `.git`).

Self-heal on bind:

- `This command writes to a Shipeasy project, but no project is bound …`
  → login was skipped or ran in the wrong dir; rerun `shipeasy login` from
  the monorepo root.
- `.shipeasy` is gitignored → remove it from `.gitignore`; binding must
  be committed.

---

## 3. Create server + client SDK keys

```bash
shipeasy keys create --type server --json
shipeasy keys create --type client --json
```

Capture the `key` field from each JSON. **Plaintext is shown once** —
write to the secret store in step 4 and discard the JSON immediately.

Self-heal: if keys already exist (existing project), `shipeasy keys list`
shows them but plaintext is unrecoverable. Always mint **new** keys here
rather than asking the user to dig up old ones; revoke unused old ones
with `shipeasy keys revoke <id>` only after the user confirms.

Verify: `shipeasy keys list` shows ≥1 server and ≥1 client row.

---

## 4. Install the SDK + persist keys — per subproject

Loop over each target from step 1. For each:

### 4a. JS targets (`js-react`, `js-node`)

```bash
cd <subproject-dir>

# Detect package manager from lockfile (pnpm-lock.yaml, yarn.lock, package-lock.json)
# and install the right packages:
pnpm add @shipeasy/sdk @shipeasy/react       # js-react
# or:
pnpm add @shipeasy/sdk                        # js-node
```

Pre-flight: if `zod` is pinned `< 4`, npm errors with `ERESOLVE`. Use
`npm install --legacy-peer-deps` or
`pnpm add --strict-peer-dependencies=false`.

Persist keys to the subproject's `.env.local` (or whatever store it
already uses — see the table below). Re-use the **same** server + client
key pair across every subproject in the monorepo; they all evaluate
against the same project.

| Detected secret store                      | Action                                                           |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `wrangler.toml` / `wrangler.jsonc`         | `wrangler secret put SHIPEASY_SERVER_KEY` (interactive via Bash) |
| Next.js / Vite / Astro / SvelteKit / Remix | append to `<subproject>/.env.local`                              |
| Vercel (`.vercel/` or `vercel.json`)       | `vercel env add SHIPEASY_SERVER_KEY production`                  |
| Netlify (`netlify.toml`)                   | `netlify env:set SHIPEASY_SERVER_KEY …`                          |
| Doppler / Infisical / 1Password CLI        | use that CLI                                                     |
| Nothing detected                           | create `<subproject>/.env.local`, confirm it's gitignored        |

Variable names by framework:

```
SHIPEASY_SERVER_KEY=sdk_server_…
NEXT_PUBLIC_SHIPEASY_CLIENT_KEY=sdk_client_…   # Next.js
VITE_SHIPEASY_CLIENT_KEY=sdk_client_…          # Vite
PUBLIC_SHIPEASY_CLIENT_KEY=sdk_client_…        # Astro / SvelteKit / generic
```

### 4b. Non-JS targets (no SDK published yet)

Surface a one-line notice to the user and continue. **Do not** invent a
pip/gem/go-get install. Example:

```
⚠ services/api (python): no PyPI package published yet. Wire it up
   manually once @shipeasy/sdk-python lands. Tracking issue:
   https://github.com/shipeasy-ai/sdk-python
```

The monorepo still gets its server + client keys in the relevant secret
store — pass the same keys to non-JS subprojects via their existing env
mechanism so they're ready when the language SDK ships.

### Hard rules

- Never commit a server key. Confirm `.env.local` is in `.gitignore`
  before any later `git add`.
- Never echo a server key into chat output, PR descriptions, commit
  messages, or test fixtures.

---

## 5. Initialize the SDK — one configure call per JS subproject

For each `js-react` / `js-node` subproject, exactly one entry-point
file gets the `shipeasy({...})` call.

### 5a. Next.js App Router subproject

Edit `<subproject>/app/layout.tsx` (or `<subproject>/src/app/layout.tsx`)
— whichever exists. Render `getBootstrapHtml()` into `<head>`. Without
it, client-side flag evaluation pays an extra round-trip on first paint
and the devtools overlay (used by `bugs@shipeasy`) never appears.

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

Call `shipeasy({ apiKey: ... })` once near the top of `main.ts` /
`main.tsx`.

### 5c. Node service (`js-node`, no React)

Call once at startup (e.g. top of `src/server.ts` / `src/index.ts`):

```ts
import { shipeasy } from "@shipeasy/sdk/server";
await shipeasy({ apiKey: process.env.SHIPEASY_SERVER_KEY ?? "" });
```

---

## 6. Final verification gate

```bash
cd "$(git rev-parse --show-toplevel)"
shipeasy whoami                                  # bound dir + project_id
test -f .shipeasy && grep project_id .shipeasy   # binding committed
shipeasy keys list                               # ≥1 server, ≥1 client
shipeasy modules list                            # all off by default

# Per JS subproject:
( cd <subproject> && (pnpm build || npm run build) )
```

Every line must pass before reporting "done". On failure: surface the
exact stderr to the user and stop.

---

## 7. Hand-off report

```
✅ Shipeasy base installed
Project:   <project_id>
Keys:      server *…<last4>, client *…<last4>
Wired:     <list of subprojects + entry files>
Modules:   (none enabled yet)

Next:
  claude plugin install experiments-metrics@shipeasy   # A/B tests + metrics
  claude plugin install configs-gates@shipeasy         # feature gates + configs + killswitches
  claude plugin install polylang@shipeasy              # translations
  claude plugin install bugs@shipeasy                  # in-app bug reports

Then enable the matching module:
  shipeasy modules enable experiments
  shipeasy modules enable gates && shipeasy modules enable configs
  shipeasy modules enable translations
  shipeasy modules enable feedback

Dashboard:  https://app.shipeasy.ai/projects/<project_id>
```

---

## 8. Ask the user to commit

Show the diff. Propose the command. **Don't run `git commit` yourself.**

```bash
git status
git diff --stat
# Then propose:
git add .shipeasy <subproject>/package.json <subproject>/<lockfile> <entry-files>
git commit -m "chore: onboard Shipeasy base (SDK + auth + bind)"
```

Confirm `.env.local` is gitignored before any `git add`. Never `git add -A`.
