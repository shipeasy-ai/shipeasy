# `@shipeasy/mcp` — unified Model Context Protocol server

> Replaces [packages/mcp-server/](../mcp-server/). One MCP server, one npm package, covers **both** subsystems:
>
> 1. **Experimentation** — gates, configs, experiments, metrics, events (from [experiment-platform/10-mcp-server.md](../../experiment-platform/10-mcp-server.md)).
> 2. **String manager / i18n** — label profiles, keys, drafts, translations, publish, codemods (from [string-manager-platform/plan.md](../../string-manager-platform/plan.md) § MCP server).
>
> AI assistants (Claude Code, Cursor, Copilot, Windsurf, Claude Desktop, Continue) talk to one server and get the full platform.

---

## Status / migration

- **New location:** `packages/mcp/` (this doc).
- **Old location:** `packages/mcp-server/` — will be deleted once this ships. The npm package rename (`@shipeasy/mcp-server` → `@shipeasy/mcp`) is a **breaking change**; the old name publishes one final version that re-exports the new package as a deprecation shim.
- **Binary rename:** `shipeasy-mcp` (unchanged — the old binary name is preserved so existing `.claude/settings.json` entries keep working).

---

## Install / run

Two steps: **(1)** register the server with your AI assistant, **(2)** authenticate once with `shipeasy-mcp install`. Step 2 is required before any mutating tool will work — it runs a browser-based PKCE device flow against `/auth/device/*` and writes the token to `~/.config/shipeasy/config.json` (shared with `@shipeasy/cli`).

### Step 1 — register

**npx (recommended for AI assistant configs)**

```json
// ~/.claude/settings.json  |  .cursor/mcp.json  |  .windsurf/mcp.json  |  .mcp.json (project-local)
{
  "mcpServers": {
    "shipeasy": {
      "command": "npx",
      "args": ["-y", "@shipeasy/mcp@latest"]
    }
  }
}
```

**Global install**

```bash
npm i -g @shipeasy/mcp
# or
pnpm add -g @shipeasy/mcp
```

```json
{ "mcpServers": { "shipeasy": { "command": "shipeasy-mcp" } } }
```

**Through the CLI** (if `@shipeasy/cli` is already installed)

```bash
shipeasy mcp install     # auto-writes ~/.claude/settings.json + .cursor/mcp.json
shipeasy mcp start       # run stdio server (same binary, different entry)
```

### Step 2 — authenticate

Run this once per machine:

```bash
shipeasy-mcp install
```

What happens:

1. The CLI generates a PKCE verifier + challenge.
2. It calls `POST {api_base}/auth/device/start` to open a session; the worker returns a `state`.
3. Your default browser opens at `{app_base}/cli-auth?state=…&code_challenge=…&source=mcp`. Sign in with your existing Shipeasy account (GitHub, Google, or magic link — same as the dashboard).
4. The UI page calls `POST {api_base}/auth/device/complete` with `project_id` + PKCE verifier.
5. The CLI polls `GET {api_base}/auth/device/poll?state=…` (header `X-Code-Verifier`) every ~2 s until it receives `{ token, project_id }`.
6. Token is written to `~/.config/shipeasy/config.json` with `chmod 600`. The directory is created `chmod 700`.

Flags:

| Flag             | Effect                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `--force`        | Overwrite an existing session instead of aborting.                                        |
| `--no-browser`   | Print the auth URL; useful on remote / headless machines (paste it into a local browser). |
| `--api-base-url` | Override worker URL. Defaults to `$SHIPEASY_API_BASE_URL` → `https://api.shipeasy.ai`.    |
| `--app-base-url` | Override UI URL. Defaults to `$SHIPEASY_APP_BASE_URL` → `https://app.shipeasy.ai`.        |

Other subcommands:

```bash
shipeasy-mcp whoami      # prints { project_id, user_email, config_path }
shipeasy-mcp logout      # deletes ~/.config/shipeasy/config.json
shipeasy-mcp --help      # usage
shipeasy-mcp --version
```

### Why is this a CLI subcommand instead of an MCP tool?

The MCP stdio transport runs inside the AI assistant — it can't block for a browser round-trip, spawn new windows, or receive a browser-delivered callback. Browser-based auth has to run in a terminal the user owns. Once the token is written, **every** MCP server instance on the machine (Claude Code, Cursor, Windsurf, MCP Inspector, etc.) reads the same `~/.config/shipeasy/config.json` — one install, many clients.

The in-process `auth_login` MCP tool therefore always returns a pointer back to the CLI command rather than trying to launch a browser itself.

### Manual stdio invocation (for testing)

```bash
npx -y @shipeasy/mcp
# or pipe it through MCP Inspector:
npx @modelcontextprotocol/inspector npx -y @shipeasy/mcp
```

---

## Protocol surface

Transport: **stdio** (JSON-RPC 2.0 framed by Content-Length headers per MCP spec).
Capabilities advertised on initialize:

```json
{
  "tools": { "listChanged": true },
  "prompts": { "listChanged": false },
  "resources": { "subscribe": true, "listChanged": true },
  "logging": {}
}
```

- **Tools** — actions the assistant can invoke (the full catalog below).
- **Prompts** — named, parameterized workflow playbooks (see _Prompts_ section).
- **Resources** — read-only views of project state the assistant can pull in as context (see _Resources_ section).
- **Logging** — structured progress and error notifications via `notifications/message`.

---

## Authentication

Every mutating tool requires a Shipeasy session. Credentials live in `~/.config/shipeasy/config.json` and are shared between `@shipeasy/mcp` and `@shipeasy/cli` — whichever tool the user authenticates in first, both pick up the same session.

1. `shipeasy-mcp install` (terminal) completes the PKCE device flow and writes the config file (see _Step 2 — authenticate_ above).
2. The MCP stdio server's `auth_check` tool reads the file on every call — no cached state in the server process.
3. `auth_login` invoked over MCP always returns an actionable error asking the human to run `shipeasy-mcp install` in a terminal (stdio can't open a browser safely).
4. `auth_logout` removes the file; the CLI equivalent works too.

```
~/.config/shipeasy/config.json          (mode 0600, parent dir 0700)
  {
    "project_id":   "proj_…",
    "cli_token":    "sdk_admin_…",      ← scoped to admin Route Handlers; 90-day rotation
    "api_base_url": "https://api.shipeasy.ai",
    "app_base_url": "https://app.shipeasy.ai",
    "user_email":   "you@example.com",
    "created_at":   "2026-04-16T…Z"
  }
```

Tool-level auth policy:

| Category                                        | Requires session | Notes                                                  |
| ----------------------------------------------- | ---------------- | ------------------------------------------------------ |
| `detect_*`                                      | No               | Pure filesystem inspection, no network.                |
| `auth_*`                                        | — / triggers it  |                                                        |
| `list_*`, `get_*`                               | Yes              | Read-only GETs against `apps/ui` admin Route Handlers. |
| `create_*`, `update_*`, `delete_*`, `publish_*` | Yes              | Mutations — the CLI enforces `checkLimit` server-side. |
| `i18n_scan_code`, `i18n_codemod_*`              | No               | Local-only AST tools.                                  |

---

## Tool catalog

Tools are namespaced by subsystem: `exp_*` (experimentation), `i18n_*` (string manager), unprefixed (shared: auth, project detection, resource listing, SDK snippets).

### Shared tools

#### `detect_project`

Inspects the working directory and returns the language, framework, package manager, installed shipeasy packages, and i18n presence signals.

**Input** (all optional):

```json
{ "path": "string (defaults to cwd; sandboxed via realpath to refuse escapes)" }
```

**Output**:

```json
{
  "language":       "typescript | javascript | python | ruby | go | java | php | swift | kotlin | unknown",
  "frameworks":     ["nextjs","react","tailwind", ...],
  "package_manager":"npm | pnpm | yarn | bun | pip | poetry | bundler | go | maven | gradle | composer | swiftpm",
  "entry_points":   ["src/app/layout.tsx", "src/main.tsx"],
  "test_files":     ["src/app/page.test.tsx"],

  "shipeasy": {
    "experimentation_sdk": { "installed": true, "version": "^1.3.0", "configured": true, "subentry": "shipeasy/react" },
    "i18n_sdk":            { "installed": true, "version": "^1.1.0", "configured": true, "profile": "en:prod" },
    "loader_script_tag":   { "present": true, "data_key": "sdk_client_…", "data_profile": "en:prod" },
    "env_keys_detected":   ["SHIPEASY_SERVER_KEY","NEXT_PUBLIC_SHIPEASY_CLIENT_KEY"],
    "template_warning":    "Installed SDK version 0.9.x is incompatible with MCP templates >=1.0.0."
  }
}
```

**Security**: `realpath` sandbox (see [10-mcp-server.md § detect_project](../../experiment-platform/10-mcp-server.md)). All reads go through `safeRead()` which refuses symlinks pointing outside the requested root.

---

#### `auth_check`

```json
// input
{}

// output
{ "authenticated": true, "project_id": "…", "base_url": "…", "user_email": "…" }
```

#### `auth_login`

Spawns `shipeasy login`, which opens the browser and blocks until the device-auth flow completes. Uses `spawn` (not `execSync`) so the MCP event loop stays responsive. The AI assistant should surface a "waiting for browser…" message — the CLI session polls for up to 5 minutes.

```json
// input
{}
// output — same shape as auth_check after success
```

#### `auth_logout`

Deletes `~/.config/shipeasy/config.json`. No network call.

---

#### `list_resources`

Unified listing across both subsystems.

```json
// input
{
  "kind": "gates|configs|experiments|events|metrics|universes|attributes|profiles|chunks|keys|drafts|sdk_keys|all",
  "limit": 50,
  "search": "checkout" // optional name filter
}
```

Hits the matching `apps/ui` admin Route Handler (e.g. `/api/admin/gates`, `/api/admin/i18n/profiles`) and returns a normalized list:

```json
{
  "kind": "experiments",
  "items": [
    { "id": "…", "name": "checkout_button_color", "universe": "checkout", "status": "running", "allocation": 10 },
    ...
  ],
  "next_cursor": null
}
```

#### `get_resource`

Fetches a single resource by `{ kind, name_or_id }`. Same routing as `list_resources`.

---

#### `get_sdk_snippet`

Returns ready-to-paste code for the detected language + framework, for either subsystem.

```json
// input
{
  "domain": "experiment | i18n",
  "language": "typescript | python | ruby | go | java | php | swift | kotlin",
  "framework": "nextjs | react | remix | vue | svelte | angular | nuxt | django | rails | laravel | spring | swiftui | compose | ... | null",
  "type": "gate | experiment | config | label_load | label_render | loader_script | provider_setup",
  "name": "new_checkout",
  "params": { "color": "string" },
  "success_event": "purchase_completed",
  "success_value": true
}
```

**Output**:

```json
{
  "install": "pnpm add shipeasy",
  "env_vars": ["SHIPEASY_SERVER_KEY", "NEXT_PUBLIC_SHIPEASY_CLIENT_KEY"],
  "init": "…code block…",
  "usage": "…code block…",
  "tracking": "…code block (only for experiments)…",
  "validate_command": "pnpm tsc --noEmit",
  "docs_url": "https://docs.shipeasy.ai/sdk/typescript/next"
}
```

Templates are loaded from the installed SDK package (`shipeasy/templates/<language>.js`), not from this MCP bundle — so they track the customer's SDK version. Falls back to bundled templates if the SDK has no `templates/` export or isn't installed yet. See [packages/language_sdks/README.md](../language_sdks/README.md) for the source-of-truth template files per language.

---

#### `list_prompts` / `get_prompt`

Standard MCP — see _Prompts_ section below. These are built into `@modelcontextprotocol/sdk`.

---

### Experimentation tools (`exp_*`)

All mutations shell out to `@shipeasy/cli` via `execFile` (never `exec` with shell interpolation) with validated, slugified arguments. Names are auto-slugged before validation (`SAFE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/`) and a warning is logged if auto-slugging changed the input.

| Tool                      | What it does                                                      | Shells to                                  |
| ------------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| `exp_create_gate`         | Create a feature gate with targeting rules and rollout percentage | `shipeasy gates create`                    |
| `exp_update_gate`         | Update rules, rollout, killswitch                                 | `shipeasy gates update`                    |
| `exp_delete_gate`         |                                                                   | `shipeasy gates delete`                    |
| `exp_create_config`       | Create a static config (sitevar)                                  | `shipeasy configs create`                  |
| `exp_update_config_value` | Update the live value                                             | `shipeasy configs set`                     |
| `exp_create_universe`     | Create a universe with holdout %                                  | `shipeasy universes create`                |
| `exp_create_experiment`   | Create experiment draft with groups, params, targeting gate       | `shipeasy experiments create`              |
| `exp_start_experiment`    | Transition draft → running                                        | `shipeasy experiments start`               |
| `exp_stop_experiment`     | Transition running → stopped, promote winning group               | `shipeasy experiments stop`                |
| `exp_add_metric`          | Attach a metric as goal/guardrail                                 | `shipeasy experiments metric add`          |
| `exp_create_event`        | Register an event schema                                          | `shipeasy events create`                   |
| `exp_create_metric`       | Create a metric from an event                                     | `shipeasy metrics create`                  |
| `exp_experiment_status`   | Current results + ship/hold/wait verdict                          | `GET /api/admin/experiments/:name/results` |
| `exp_cleanup_winner`      | AST-drop losing branches after shipping                           | Local codemod via `jscodeshift`/`ast-grep` |

**Representative input — `exp_create_experiment`:**

```json
{
  "name": "checkout_button_color",
  "description": "Test green vs. gray on new checkout",
  "universe": "checkout",
  "allocation": 10,
  "groups": [
    { "name": "control", "weight": 5000, "params": { "color": "gray" } },
    { "name": "test", "weight": 5000, "params": { "color": "green" } }
  ],
  "params_schema": { "color": "string" },
  "targeting_gate": "new_checkout",
  "success_event": "purchase_completed",
  "success_aggregation": "count_users"
}
```

**Output:**

```json
{
  "experiment": {
    "name": "checkout_button_color",
    "id": "exp_…",
    "status": "draft",
    "universe": "checkout"
  },
  "metric": { "name": "checkout_button_color_purchase_completed", "status": "created" },
  "snippet": {
    /* same shape as get_sdk_snippet */
  },
  "docs_url": "https://docs.shipeasy.ai/experiments/create"
}
```

---

### String manager tools (`i18n_*`)

Absorbs the `packages/mcp-server/src/tools/i18n/` sketch from [string-manager-platform/plan.md](../../string-manager-platform/plan.md).

| Tool                    | What it does                                                                                                                             | Backed by                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `i18n_scan_code`        | Walk the repo AST, return candidate JSX text / string literals / template strings that look translatable                                 | Local (jscodeshift / ast-grep / Python ast)  |
| `i18n_discover_site`    | Fetch a URL, parse `<link rel="i18n-config">` + `/.well-known/i18n.json`, return profiles + glossary                                     | `fetch`                                      |
| `i18n_list_profiles`    | List profiles, chunks, coverage                                                                                                          | `GET /api/admin/i18n/profiles`               |
| `i18n_create_profile`   | Create a new locale profile, e.g. `fr:prod`                                                                                              | `shipeasy i18n profiles create`              |
| `i18n_create_chunk`     | Create a chunk inside a profile                                                                                                          | `shipeasy i18n chunks create`                |
| `i18n_create_key`       | Create/update a single label key                                                                                                         | `shipeasy i18n keys set`                     |
| `i18n_push_keys`        | Bulk upload a JSON file of keys to a chunk                                                                                               | `shipeasy i18n push`                         |
| `i18n_pull_keys`        | Download published strings to local disk                                                                                                 | `shipeasy i18n pull`                         |
| `i18n_create_draft`     | Clone a source profile into a draft (optionally pre-translated)                                                                          | `shipeasy i18n drafts create`                |
| `i18n_translate_draft`  | Run Anthropic translation on a draft (operator's API key, zero shipeasy-side AI)                                                         | `shipeasy i18n translate`                    |
| `i18n_update_draft_key` | Edit a single key in a draft                                                                                                             | `PATCH /api/admin/i18n/drafts/:id/keys/:key` |
| `i18n_publish_profile`  | Publish a chunk or whole profile — rebuilds KV manifest, purges CDN                                                                      | `shipeasy i18n publish`                      |
| `i18n_usage_summary`    | Monthly loader request count + per-chunk breakdown                                                                                       | `GET /api/admin/i18n/usage`                  |
| `i18n_codemod_preview`  | AST-transform framework code (Next.js / React / Vue / Rails / Django) to wrap strings in `ShipeasyString`, return a diff without writing | Local codemods                               |
| `i18n_codemod_apply`    | Same as preview, but writes the diff (requires `confirm: true`)                                                                          | Local codemods                               |
| `i18n_validate_keys`    | Pre-commit check: every code-side key exists server-side                                                                                 | `shipeasy i18n validate`                     |
| `i18n_install_loader`   | Emit the `<script src="https://api.shipeasy.ai/sdk/i18n/loader.js" data-key=…>` tag for the detected framework                           | Local                                        |

**Representative input — `i18n_translate_draft`:**

```json
{
  "draft_id": "draft_…",
  "source_profile": "en:prod",
  "target_profile": "fr:prod",
  "glossary": [
    { "term": "ShipEasy", "policy": "keep" },
    { "term": "Patient", "policy": "translate_as", "fr": "Patient" }
  ],
  "anthropic_api_key_env": "ANTHROPIC_API_KEY",
  "max_parallel": 4
}
```

Calls Anthropic **from the user's machine** (never from shipeasy servers). Writes progress via MCP `notifications/progress`. Returns `{ draft_id, translated_key_count, failed_key_count, review_url }`.

**Representative input — `i18n_codemod_preview`:**

```json
{
  "framework": "nextjs",
  "files": ["src/app/dashboard/page.tsx"],
  "strategy": "jsx_text_literals",
  "key_prefix": "dashboard."
}
```

Output is a diff list; the AI shows it to the user and then calls `i18n_codemod_apply` with `confirm: true` only once the user approves.

---

## Prompts (workflow skills)

MCP prompts expose named, parameterized playbooks the AI can `get_prompt()` to load as context. Mirrors the skills bundle in [experiment-platform/11-skills.md](../../experiment-platform/11-skills.md) and [string-manager-platform/plan.md](../../string-manager-platform/plan.md) § Skills.

| Prompt name             | Purpose                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| `setup_experimentation` | Install the SDK, add env keys, wire a provider, verify with a sample gate |
| `create_experiment`     | Propose → create → inject code → start → monitor                          |
| `analyze_experiment`    | Pull results, compute lift + significance, emit ship/hold/wait verdict    |
| `cleanup_winner`        | Remove losing branches + dead gate code after shipping                    |
| `setup_i18n`            | Install SDK + loader script, create `en:prod`, run codemod, validate      |
| `translate_site`        | Given a URL, discover, add target locale, translate, review, publish      |
| `i18n_health`           | Report missing keys, unused keys, drift between profiles                  |
| `rotate_sdk_keys`       | Revoke + re-issue client/server keys and update env vars                  |

Each prompt's body is a short markdown playbook embedded in the server bundle. The assistant fetches it once per conversation with `get_prompt({ name })` and follows the steps.

---

## Resources

Read-only project context streamed to the assistant via MCP's `resources/read`. The server advertises resource templates (URI patterns) so the assistant can pull context on demand without the user needing to paste files.

| URI template                                 | Returns                                                             |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `shipeasy://project`                         | Cached `detect_project()` output + `auth_check()` output.           |
| `shipeasy://experiments/{name}`              | Experiment config + latest stats JSON.                              |
| `shipeasy://gates/{name}`                    | Gate config + rollout state.                                        |
| `shipeasy://configs/{name}`                  | Config value + history.                                             |
| `shipeasy://i18n/profiles/{profile}`         | Profile metadata + chunk list + coverage %.                         |
| `shipeasy://i18n/profiles/{profile}/{chunk}` | Published strings for one chunk.                                    |
| `shipeasy://i18n/drafts/{draft_id}`          | Draft metadata + per-key diff vs. source profile.                   |
| `shipeasy://plans/current`                   | Plan tier + current-month usage + remaining quota.                  |
| `shipeasy://docs/{slug}`                     | Pre-rendered markdown page from `docs.shipeasy.ai` — AI-consumable. |

`resources/subscribe` is supported on `shipeasy://experiments/{name}` — the server pushes `notifications/resources/updated` when cron finishes a new analysis run (detected via long-poll on `/api/admin/experiments/:name/results?since=ts`).

---

## Package structure

```
packages/mcp/
  package.json                      ← name: "@shipeasy/mcp", bin: "shipeasy-mcp"
  tsconfig.json
  tsup.config.ts                    ← esm output, single bundle
  bin/
    mcp.js                          ← shebang → runs dist/index.js
  src/
    index.ts                        ← Server setup, capability advertise, tool routing
    rpc/
      list-tools.ts
      call-tool.ts
      list-prompts.ts
      get-prompt.ts
      list-resources.ts
      read-resource.ts
      subscribe-resource.ts
    tools/
      schema.ts                     ← TOOLS array — MCP tool definitions
      shared/
        detect.ts                   ← detect_project (with realpath sandbox)
        auth.ts                     ← auth_check, auth_login, auth_logout
        list-resource.ts            ← list_resources, get_resource
        snippets.ts                 ← get_sdk_snippet + template loader
      exp/
        gates.ts
        configs.ts
        universes.ts
        experiments.ts
        events.ts
        metrics.ts
        status.ts
        cleanup.ts
      i18n/
        scan.ts                     ← i18n_scan_code (ast-grep driver)
        discover.ts                 ← i18n_discover_site
        profiles.ts
        chunks.ts
        keys.ts
        drafts.ts
        translate.ts                ← i18n_translate_draft (Anthropic shell-out)
        publish.ts
        usage.ts
        codemods/
          nextjs.ts
          react.ts
          vue.ts
          svelte.ts
          angular.ts
          rails.ts
          django.ts
          index.ts                  ← dispatcher for i18n_codemod_preview/apply
        validate.ts
        loader.ts                   ← i18n_install_loader
    prompts/
      schema.ts                     ← PROMPTS array
      setup_experimentation.md
      create_experiment.md
      analyze_experiment.md
      cleanup_winner.md
      setup_i18n.md
      translate_site.md
      i18n_health.md
      rotate_sdk_keys.md
    resources/
      schema.ts                     ← RESOURCE_TEMPLATES
      project.ts
      experiments.ts
      gates.ts
      configs.ts
      i18n.ts
      plans.ts
      docs.ts
    util/
      cli.ts                        ← execFile wrapper with shared error decoding
      http.ts                       ← fetch wrapper w/ cli_token header
      slug.ts                       ← autoSlug + SAFE_NAME_RE
      safe-read.ts                  ← realpath-sandboxed fs reads
      progress.ts                   ← notifications/progress helper
      logger.ts                     ← notifications/message helper (respects client log level)
      compat.ts                     ← semver compatibility check per language
    templates/                       ← fallback snippets when SDK has no templates/ export
      typescript.ts
      python.ts
      ruby.ts
      go.ts
      java.ts
      php.ts
      swift.ts
      kotlin.ts
  test/
    rpc/*.test.ts                   ← each request handler covered
    tools/exp/*.test.ts
    tools/i18n/*.test.ts
    tools/shared/detect.test.ts     ← realpath sandbox edge cases
    fixtures/
      projects/
        nextjs-with-sdk/
        django-clean/
        rails-with-i18n/
        astro-plain/
```

---

## package.json

```json
{
  "name": "@shipeasy/mcp",
  "version": "1.0.0",
  "description": "Model Context Protocol server for the Shipeasy platform (experimentation + i18n)",
  "keywords": [
    "mcp",
    "model-context-protocol",
    "shipeasy",
    "feature-flags",
    "experimentation",
    "i18n",
    "ai"
  ],
  "type": "module",
  "bin": { "shipeasy-mcp": "./bin/mcp.js" },
  "files": ["bin/", "dist/", "src/prompts/*.md"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts --clean",
    "type-check": "tsc --noEmit",
    "test": "vitest",
    "prepublishOnly": "pnpm build"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@shipeasy/sdk": "workspace:*",
    "semver": "^7.6.0",
    "zod": "^3.23.0",
    "conf": "^13.0.0",
    "@ast-grep/napi": "^0.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.19.0",
    "@types/semver": "^7.5.0",
    "tsup": "^8.3.0",
    "typescript": "^5.7.0",
    "vitest": "^2.0.0"
  }
}
```

Why `@ast-grep/napi`? A single, fast, multi-language AST engine used by every codemod (JS/TS/Vue/Svelte/Python/Ruby) instead of per-framework parsers. Keeps the install footprint small — one native dep, prebuilt binaries for common platforms.

---

## Error handling

Every tool returns one of three shapes:

```typescript
// Success
{ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }

// Known validation / domain error (isError: true)
{ content: [{ type: "text", text: "Error: gate 'new_checkout' already exists" }], isError: true }

// Protocol error — JSON-RPC level
{ error: { code: -32602, message: "Invalid params: 'name' required" } }
```

Rules:

- **Never crash the stdio transport.** Any unexpected exception is converted into an `isError: true` tool result with a redacted message; a structured `notifications/message` log is emitted at `error` level for the operator.
- **Never include the SDK key, CLI token, or Anthropic key** in any response, error, or log line. The logger has a deny-list of env var names that it redacts before emitting.
- **Never shell out with `exec` + string interpolation.** All subprocess calls go through `util/cli.ts` which uses `execFile` with an argument array and a 60 s default timeout.
- **Validate every path input via `util/safe-read.ts`** — path traversal attempts throw a specific error that's shown to the user, not silently followed.

---

## Logging / progress

- Structured logs are sent via `notifications/message`. The assistant honours the client-set log level (`debug`, `info`, `warning`, `error`) advertised at initialize time.
- Long-running tools (`i18n_translate_draft`, `i18n_codemod_apply` on large repos, `i18n_push_keys`) emit `notifications/progress` with `{ progressToken, progress, total, message }` so the assistant can render a spinner/bar.
- Every tool call is logged with `{ tool, duration_ms, result_status, error_code }` locally to `~/.cache/shipeasy/mcp.log` (rolling 10 MB, 3 files). No payloads. No secrets.

---

## SDK / template compatibility

Each SDK language declares a compatible template range; the MCP server bundles the template authority and resolves at call time.

```typescript
const COMPATIBLE_VERSIONS: Record<Lang, string> = {
  typescript: ">=1.0.0 <3.0.0",
  python: ">=1.0.0",
  ruby: ">=1.0.0",
  go: ">=1.0.0",
  java: ">=1.0.0",
  php: ">=1.0.0",
  swift: ">=1.0.0",
  kotlin: ">=1.0.0",
};
```

`detect_project` sets `template_warning` when the installed SDK is outside the range. `get_sdk_snippet` first tries to import templates from the customer's installed `shipeasy/templates/<lang>.js` and falls back to this MCP server's bundled templates only if the SDK is not present (e.g. during fresh project setup).

---

## Testing

- **Unit tests** — every tool handler in isolation with a mock `fetch` + mocked `execFile`. Target ≥90% coverage on `src/tools/**`.
- **Fixture projects** — `test/fixtures/projects/` contains minimal Next.js / Django / Rails / Astro projects. `detect_project` runs against each one and asserts the returned shape.
- **MCP Inspector smoke test** — CI runs `npx @modelcontextprotocol/inspector npx -y ./dist/index.js` and exercises `list_tools`, `list_prompts`, `list_resources`, and one success/one error tool call per domain.
- **End-to-end** — a Playwright suite under [apps/ui/e2e/auth/mcp/](../../apps/ui/e2e/auth/mcp/) stands up a real worker + UI, spawns the MCP server as a child process, and verifies the full `create_experiment` → `get_sdk_snippet` → `experiment_status` loop writes to D1 and KV correctly. Required per [CLAUDE.md](../../CLAUDE.md).
- **Cross-SDK snippet verification** — for each language × framework × type tuple, the generated snippet is compiled/parsed (TypeScript → `tsc --noEmit`, Python → `py_compile`, etc.) in a tiny scratch project. Regressions in template strings fail CI instantly.

---

## Versioning

Independent of the CLI and the SDK:

- **Major** — tool rename/removal, input-schema breaking change, prompt rename.
- **Minor** — new tool, new prompt, new resource template, additive optional input field.
- **Patch** — bug fix, template refresh, copy tweak.

`initialize` advertises `serverInfo.version`. The assistant may show a nudge when a newer version is available on npm. `@shipeasy/cli` re-exports `@shipeasy/mcp` at the matching major so `shipeasy mcp start` never runs a mismatched server.

---

## Why one MCP server and not two

1. **One auth flow.** The CLI token unlocks both `/api/admin/experiments/*` and `/api/admin/i18n/*`. Two servers would each prompt for login.
2. **One project detection.** `detect_project` needs to report _both_ experimentation and i18n status; splitting doubles the filesystem walks for every conversation.
3. **Cross-subsystem prompts.** `translate_site` wants to read experiment config (does the site have an `en` variant gated by a `new_language_picker` flag?) — a single server can `get_resource` from both domains without a cross-server handshake.
4. **One AI install step.** Customers add one entry to `.claude/settings.json`, not two.
5. **One shared bundle of templates.** Language + framework templates are co-located; an `i18n_install_loader` call can consult the same detected stack `exp_create_experiment` just used.

---

## Non-negotiables

- Every new tool ships with: input schema in `tools/schema.ts`, Zod validator at call-time, unit test, and an entry in this README's catalog table.
- Every new prompt ships with: entry in `prompts/schema.ts` + a markdown file under `prompts/*.md` + a one-line description for `list_prompts`.
- Every mutating tool (`create_*`, `update_*`, `delete_*`, `publish_*`) requires an authenticated session and re-validates limits by letting the `apps/ui` handler call `checkLimit()` — the MCP server never hand-rolls plan enforcement.
- All subprocess invocations use `execFile` + argument arrays.
- All filesystem reads go through `util/safe-read.ts`.
- Secrets (SDK keys, CLI token, Anthropic API key) never appear in tool output, prompt content, resource content, or log lines.
- Stdio transport stays healthy: unhandled rejections are captured in `index.ts` and converted to `notifications/message` errors — the process never exits on a per-request failure.
- Template updates are co-versioned with the SDK (`shipeasy/templates/`) and validated in CI with `tsc --noEmit` / `py_compile` / equivalent.
