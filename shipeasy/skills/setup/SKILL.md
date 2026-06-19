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

The three feature install commands (`/shipeasy:ops:install`,
`/shipeasy:flags:install`, `/shipeasy:i18n:install`) each pick up where
this one leaves off. `/shipeasy:flags:install` folds gates + configs +
kill switches + experiments + events into one pass; `/shipeasy:ops:install`
covers feedback + production errors + alerts. Run this skill **first**.

---

## First fix: update before you debug

Most failures here — `unknown command` / `unknown option`, a missing
subcommand, an unexpected `400`/`404`, or something that worked before — are
**version drift**: the CLI or plugin is older than the feature being invoked.
Before deeper debugging, update to latest and retry once:

- **CLI:** `npm i -g @shipeasy/cli@latest` (or one-off: `npx @shipeasy/cli@latest <cmd>`).
- **Plugin (skills + slash commands):** `/plugin marketplace update shipeasy`
  then `/plugin install shipeasy@shipeasy`. There is no `claude plugin update`;
  or open `/plugin` and enable auto-update on the `shipeasy` marketplace.
- **MCP server:** pinned to `@shipeasy/mcp@latest` — restart the session to
  pick up a new release.

Only treat it as a real bug if it still fails on the latest CLI **and** plugin.

## Operating rules (read before doing anything)

1. **Run every CLI command yourself via your host's shell/Bash tool.**
   Never instruct the user to run `shipeasy login`, `pnpm add ...`, etc.
   in their own terminal. The MCP server cannot run interactive flows
   over stdio; your shell tool can. This holds on every host (Claude
   Code, Codex, Cursor, OpenCode, …), not just Claude Code. Base
   onboarding (steps 1–9) is **entirely CLI-driven and needs no MCP
   tools**, so it completes even when you were installed via the skills
   CLI (`npx skills add`) and the `shipeasy` MCP server isn't registered
   yet — step 0b registers it for the feature skills that come after.
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

## 0b. Ensure the `shipeasy` MCP server is registered

The base onboarding below runs entirely through the `shipeasy` **CLI**, so it
does not need MCP tools. But the **feature** skills the user runs next —
`flags`, `experiments`, `metrics`, `i18n`, `bugs` — create resources through the
`shipeasy` **MCP server**. A native-plugin install (Claude Code / Codex /
Copilot, "Tier 1") already registered it; a **skills-CLI install**
(`npx skills add shipeasy-ai/shipeasy`, "Tier 2") copies skill text **only** and
registers nothing. This step closes that gap so the agent ends up in the same
state regardless of how it was installed.

**First, check whether it's already there.** If you already have `shipeasy` MCP
tools available (tool names containing `shipeasy__`, e.g.
`…shipeasy__exp_create_gate`, `…shipeasy__i18n_push_keys`), it's registered —
**skip this entire step.** Only register when those tools are absent.

**If absent, register it for the current host** (write the config file if
missing; **merge** into an existing `mcpServers`/`mcp` block — never clobber
other servers). Detect which host you are and use the matching row:

| Host | How to register |
| --- | --- |
| **Claude Code** | `claude mcp add shipeasy -- npx -y @shipeasy/mcp@latest` (add `-s user` for global) |
| **Cursor** | merge into `.cursor/mcp.json` — bare `mcpServers` → `{ "command": "npx", "args": ["-y","@shipeasy/mcp@latest"] }` |
| **Windsurf** | merge into `~/.codeium/windsurf/mcp_config.json` (same bare shape) |
| **Gemini CLI** | `gemini mcp add shipeasy npx -y @shipeasy/mcp@latest` (or merge into `.gemini/settings.json`) |
| **OpenCode** | merge into `opencode.json` `mcp` key → `{ "type":"local", "command":["npx","-y","@shipeasy/mcp@latest"], "enabled":true }` |
| **Continue** | append to the `mcpServers` **list** in `.continue/config.yaml` → `{ name: shipeasy, type: stdio, command: npx, args: ["-y","@shipeasy/mcp@latest"] }` |
| **Cline / other** | bare `mcpServers` object in the host's MCP settings file. Windows `ENOENT`: wrap as `"command":"cmd","args":["/c","npx","-y","@shipeasy/mcp@latest"]` |

(These mirror the per-host table in this repo's `INSTALL.md` — consult it if a
host needs an exact path.)

**Then tell the user MCP tools load at session start:** most hosts only read MCP
config on startup, so after you write it the `shipeasy__*` tools won't appear
until the session is reloaded. So:

1. Finish base onboarding (steps 1–9) **now** in this session — it's CLI-only.
2. In the hand-off (step 9), tell the user to **restart / reload their agent**
   before running `/shipeasy:flags:install` (or asking for the equivalent), so
   the MCP tools are live for the feature installs.

Do **not** block base onboarding waiting for an MCP restart, and do not try to
call `shipeasy__*` tools you can't see — fall back to the CLI for everything in
steps 1–9.

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

Classify each hit. **All eight SDKs are published** — there is no
"no SDK yet" language anymore; every detected target gets a real install:

| Manifest found             | Language    | Default SDK install command (run from that dir)                                  | Published?        |
| -------------------------- | ----------- | -------------------------------------------------------------------------------- | ----------------- |
| `package.json` (+ React)   | js-react    | `pnpm add @shipeasy/sdk @shipeasy/react` (auto-detect pm)                         | ✓ npm             |
| `package.json` (Node only) | js-node     | `pnpm add @shipeasy/sdk`                                                          | ✓ npm             |
| `pyproject.toml`           | python      | `pip install shipeasy` (or add `shipeasy` to pyproject / poetry / uv)            | ✓ PyPI            |
| `Gemfile`                  | ruby        | add `gem "shipeasy-sdk"` to the Gemfile, then `bundle install`                    | ✓ RubyGems        |
| `go.mod`                   | go          | `go get github.com/shipeasy-ai/sdk-go`                                            | ✓ Go proxy        |
| `pom.xml`                  | java        | Maven dep `ai.shipeasy:shipeasy:<latest>`                                         | ✓ Maven Central   |
| `build.gradle(.kts)`       | java/kotlin | `implementation("ai.shipeasy:shipeasy:<latest>")` — Kotlin DSL → `shipeasy-kotlin` | ✓ Maven Central   |
| `composer.json`            | php         | `composer require shipeasy/shipeasy`                                              | ✓ Packagist       |
| `Package.swift`            | swift       | add `.package(url: "https://github.com/shipeasy-ai/sdk-swift.git", from: "<latest>")` | ✓ SwiftPM     |

For the registries that need an explicit version (Maven Central, SwiftPM),
resolve `<latest>` from the registry rather than hard-coding a number.

A monorepo with `apps/web/package.json` (React) and `apps/api/go.mod`
(Go backend) → two targets: install the JS SDK in `apps/web` **and** the Go
SDK (`go get github.com/shipeasy-ai/sdk-go`) in `apps/api`. Likewise a Rails
`api/Gemfile` gets `gem "shipeasy-sdk"` — none of these are "manual
follow-up" targets.

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

Server and client keys are **environment-locked at mint time** — `--env`
(`dev | staging | prod`) is **required** for both types, and the key reads
only that one environment (there is no `?env=` override for a client key).
Omitting `--env` fails with `Error (400): --env is required`. Default to
`prod` for the base install unless the user asked for a different env:

```bash
shipeasy keys create --type server --env prod --json
shipeasy keys create --type client --env prod --json
```

Capture the `key` field from each JSON. Plaintext shown once — write to
the secret store in step 4 and discard immediately.

Verify: `shipeasy keys list` shows ≥1 server and ≥1 client row (both on `prod`).

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

### 4b. Non-JS targets (python / ruby / go / java / kotlin / php / swift)

These are **published, server-side** SDKs — install them for real using
the command from the step-1 table (e.g. `bundle add shipeasy-sdk` for a
Rails `Gemfile`, `go get github.com/shipeasy-ai/sdk-go` for a Go service).
They read flags/experiments with the **server** key only; there is no
client/browser key for these targets.

#### Detect the secret store, then offer it (don't assume)

Persist `SHIPEASY_SERVER_KEY` to the subproject's **idiomatic** secret
store — do **not** blindly write a JS `.env.local`. First **scan the
subproject** for what it already uses, then present the choice to the user
with `AskUserQuestion` (single-select; put the detected/idiomatic store
**first** and mark it "(Recommended)"). Detection signals → recommended store:

| Scan signal in the subproject                                   | Framework / env   | Recommended secret store (offer first)                                   |
| --------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------ |
| `config/credentials.yml.enc` + `config/master.key`, `Gemfile` w/ rails | Rails       | `rails credentials:edit` → add `shipeasy_server_key:` (encrypted creds)  |
| `Gemfile` w/ `dotenv`, existing `.env`                          | Rails/Rack + dotenv | append to `.env` (confirm it's gitignored)                             |
| `config/secrets.yml`, `config.ru` (Sinatra/Hanami)             | Rack app          | process env / `.env`                                                      |
| `manage.py` / `settings.py`, `django-environ`                   | Django            | `.env` via `django-environ`, or the platform's env                       |
| `pyproject.toml` + `pydantic-settings` / `os.environ` usage     | Python service    | `.env` or process env                                                     |
| `application.properties` / `application.yml`                    | Spring (Java/Kotlin) | `application.properties` ref to `${SHIPEASY_SERVER_KEY}` + process env |
| `.env` + framework agnostic, or nothing detected               | Go / PHP / other  | process env; create `.env` (gitignored) if the app reads one             |
| `fly.toml` / `render.yaml` / `Procfile` / k8s manifests present | any (deployed)    | also set it in that platform's secret manager (`fly secrets set`, etc.)  |

Rules:

- **Scan before offering.** Read the manifest + a quick look for the files
  above so the recommended option is real, not a guess.
- **Offer, then act.** Surface the install command and the chosen store via
  `AskUserQuestion`; only write the secret after the user picks. Always
  include a plain-`.env` fallback option.
- For encrypted Rails credentials, run `rails credentials:edit` (or
  `EDITOR=...`) — never hand-edit the `.enc`. Reference it in code as
  `Rails.application.credentials.shipeasy_server_key`.
- Never echo the key value into chat, commits, or PRs. Confirm any `.env`
  is gitignored before staging.
- If a registry is briefly unreachable, note it and continue — do not claim
  "no SDK exists".

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

#### Edge middleware — required for flash-free SSR bucketing

Add a middleware so the shared `__se_anon_id` bucketing cookie is minted at the
edge on the first request. Without it, a gate read during SSR has no stable unit
on request #1, so a **fractional** rollout (e.g. 30%) can flash/flip on first
paint before the cookie settles client-side. (100%-rollout gates work without
it; the middleware is what makes partial rollouts render correctly from the very
first byte.) A Next Server Component can't set cookies during render, so this
edge step is the only place to mint it pre-render.

Create `<subproject>/middleware.ts` (or `src/middleware.ts`):

```ts
// No existing middleware — use the drop-in:
export { middleware, config } from "@shipeasy/sdk/next";
```

If the subproject **already has** a `middleware.ts`, compose instead of
overwriting:

```ts
import { withShipeasy } from "@shipeasy/sdk/next";
import { existingMiddleware, config } from "./your-middleware"; // keep their config

export default withShipeasy(existingMiddleware);
export { config };
```

If their middleware forwards custom request headers via
`NextResponse.next({ request: { headers } })`, prefer the primitives
(`readOrMintAnonId(req, requestHeaders)` + `commitAnonId(res, result, req)`)
inside their handler so the forwarding is preserved. Never ask the user to set
the cookie by hand — it is always minted by code.

### 5b. Vite / CRA / plain HTML

Call `shipeasy({ apiKey: ... })` once near the top of `main.ts` / `main.tsx`.

### 5c. Node service (`js-node`, no React)

```ts
import { shipeasy } from "@shipeasy/sdk/server";
await shipeasy({ apiKey: process.env.SHIPEASY_SERVER_KEY ?? "" });
```

---

## 6. Offer the devtools overlay (ask first)

The base install has now rendered `getBootstrapHtml()` (step 5), which is
all the **devtools overlay** needs to work. Before moving on, ask the user
whether to turn it on — do **not** enable it silently.

Use the `AskUserQuestion` tool (single question, single-select) so the
choice is explicit. Frame it with this brief explanation and the docs link:

> **Install the Shipeasy devtools overlay?** It's an in-page browser panel
> (press `Shift+Alt+S` or append `?se=1` to any URL) that lists every gate,
> config, experiment, and translation in your project and lets you flip each
> one **for your current session only** — no redeploy, no dashboard, nobody
> else affected. Great for QA, demos, and bug repro. It's also the same
> overlay end users use to file bug/feature reports once the feedback module
> is on. Docs: https://docs.shipeasy.ai/sdks/devtools-overlay

Offer two options:

- **Yes, enable it** — enables the feedback module so the overlay can both
  flip resources and capture reports, then verifies it mounts.
- **Not now** — skip; it can be turned on later via `/shipeasy:ops:install`.

If the user confirms (**Yes, enable it**):

```bash
shipeasy modules enable feedback
shipeasy modules list      # expect: feedback ✓
```

Then verify the overlay mounts: load any page that renders
`getBootstrapHtml()` with `?se=1` appended (or press `Shift+Alt+S`). The
panel mounts in a Shadow DOM overlay and lists the project's resources. If
it never appears, base setup is incomplete — re-check that
`getBootstrapHtml()` is rendered into `<head>` (step 5a).

The override toggles are session-scoped and client-side only — they never
write to the dashboard and never affect other users.

If the user declines, note it in the hand-off (step 9) and continue.

---

## 7. Drop project-level pointer skill

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

- `/shipeasy:ops:install` — feedback (bugs + feature requests) + errors + alerts
- `/shipeasy:flags:install` — gates, configs, kill switches, experiments, events
- `/shipeasy:i18n:install` — translations
````

---

## 8. Final verification gate

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

## 9. Hand-off report

```
✅ Shipeasy base installed
Project:   <project_id>
Keys:      server *…<last4>, client *…<last4>
Wired:     <list of subprojects + entry files>
Devtools:  <enabled (?se=1 / Shift+Alt+S) | offered, declined — run /shipeasy:ops:install later>
Pointer:   .claude/skills/shipeasy-setup/SKILL.md
Modules:   (none enabled yet | feedback ✓ if devtools enabled)
MCP:       <registered & live | JUST REGISTERED — restart your agent to load it>
```

**If you registered the MCP server in step 0b** (Tier-2 / skills-CLI install),
make this the first line the user sees, before the feature menu:

```
⚠️  Restart / reload your agent now — the `shipeasy` MCP tools were just
    registered and load at session start. After restart, run the feature
    installs below.
```

Dashboard: `https://app.shipeasy.ai/projects/<project_id>`

### Next steps — ask which feature installs to run

Do **not** print the feature list as plain text. Use the `AskUserQuestion`
tool with **`multiSelect: true`** (the installs are independent — the user
may pick several or none), header `"Feature installs"`, and one clean,
self-contained option per install with its docs link:

- **Flags & experiments** — feature gates, dynamic configs, kill switches,
  A/B experiments, and event metrics. Roll features out gradually, kill
  them instantly, and measure impact. Docs:
  https://docs.shipeasy.ai/flags-experiments → runs `/shipeasy:flags:install`
- **Feedback, errors & alerts** — in-app bug/feature reports, production
  error tracking, and metric-threshold alerts; this is the "ops" surface
  the devtools overlay feeds. Docs:
  https://docs.shipeasy.ai/feedback → runs `/shipeasy:ops:install`
- **Translations (i18n)** — wrap UI copy with `i18n.t()`, manage keys, and
  ship translations over the CDN. Docs:
  https://docs.shipeasy.ai/translations → runs `/shipeasy:i18n:install`

For each option the user selects, invoke the corresponding feature install
in order. If the user selects none, finish — they can run any install
later. (Each install ultimately just enables the matching module — e.g.
`shipeasy modules enable feedback` — but prefer the install skills, which
also verify + wire each feature.)

---

## 10. Ask the user to commit

```bash
git status
git diff --stat
git add .shipeasy .claude/skills/shipeasy-setup <subproject>/package.json <subproject>/<lockfile> <entry-files>
git commit -m "chore: onboard Shipeasy base (SDK + auth + bind)"
```

Confirm `.env.local` is gitignored before any `git add`. Never `git add -A`.

---

## 11. Offer the automated feedback trigger (always — the final step)

**This is always the last step of the install**, no matter which feature
installs the user picked in step 9. Once the base (and any selected
features) are in, offer to provision the **automated feedback trigger** —
a recurring, unattended agent that runs `/shipeasy:ops:work --pr` on a
schedule, burning down the bug + feature-request + error/alert queue and
opening one PR per item.

Ask with `AskUserQuestion` (single-select; recommend "Yes"). Keep the
explanation short and link the docs:

> **Set up the automated feedback trigger?** A scheduled agent that, on the
> cadence you choose (daily / weekdays / weekly / every 6h), picks up new
> bug reports, feature requests, and auto-filed error/alert tickets and
> opens a PR per item — hands-off queue burndown. Docs:
> https://docs.shipeasy.ai/feedback/connectors

- **Yes, set it up** → invoke the `/shipeasy:ops:create_trigger` command
  (the `claude` provider by default). It owns the full provisioning flow —
  provider auth, the schedule, GitHub connection for cloud sessions, the
  restricted `ops` key, and registering the Shipeasy connector. If the
  **feedback** module isn't enabled yet (user skipped `/shipeasy:ops:install`
  in step 9), that command enables it as part of its prerequisites — don't
  block on it here.
- **Not now** → finish; mention it can be added later with
  `/shipeasy:ops:create_trigger`.

Do not hand-roll the scheduling, the `ops` key, or any GitHub Actions
workflow here — always delegate to `/shipeasy:ops:create_trigger`, which is
the single source of truth for trigger provisioning.
