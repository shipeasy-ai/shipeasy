# Generated API commands

The entire admin-API command tree is **projected from the OpenAPI spec** — not
hand-written. `scripts/gen-commands.mjs` reads `@shipeasy/openapi`'s bundled
`openapi.yaml` and emits `src/generated/commands.gen.ts`, a single
`registerGeneratedCommands(program, ctx)` that builds the commander tree, with
every command calling a generated sdk fn from `@shipeasy/openapi/client`.

```
spec/ (authored) ──bundle──▶ openapi.yaml ──gen:cli──▶ src/generated/commands.gen.ts
                                   ▲                            │
                          tags + x-cli + bodies                │ mounts via _gen-runtime
                                                               ▼
                                                    shipeasy release flags create …
```

Regenerate with `pnpm gen:cli` (run **after** `@shipeasy/openapi`'s `pnpm gen`,
which rebuilds `openapi.yaml` + the client). Never hand-edit `commands.gen.ts`.

## Where each part of a command comes from

For an operation in the spec:

| CLI element | Source in the spec |
| --- | --- |
| **command path** (`release flags`) | the operation's **tag** + the tag `parent` chain |
| group **help text** | the **tag `description`** (shown on the group's `--help`) |
| group **summary** + **aliases** (`ks`, `ar`) | tag first-sentence + tag `x-cli.aliases` |
| **verb** (`create`, `list`) | operation `x-cli.name` |
| **synthetic verbs** (`start`/`stop`/`restore`) | operation `x-cli.commands[]` with a `preset` body |
| **positional args** (`<name>`, `<id>`) | operation `x-cli.positional` (path or body fields) |
| **flags** (`--rollout-pct`, …) | request body **properties** (+ query params) |
| flag **alias** | property-level `x-cli.alias` |
| **action** | calls `api.<operationId>({ client, path, query, body })` |

So the taxonomy is **authored in the spec** (`x-cli`), and the structure is the
**tag hierarchy**. To change a command name, group, or add an alias, edit the
spec in `@shipeasy/openapi` (`spec/paths/*.yaml` for `x-cli`, `spec/openapi.yaml`
for tags) — see that package's `scripts/inject-xcli.mjs` and
`restructure-tags.mjs` for the taxonomy source of truth.

### Tag tree → command tree

```
Release            release …
├─ Flags           release flags …          (+ release flags attributes list)
├─ Killswitch(ks)  release killswitch … / release ks …
├─ Configs         release configs …
└─ Experiments     release experiments …    (start/stop/restore = x-cli.commands on setExperimentStatus)
   └─ Universes    release experiments universes …
Metrics            metrics …
└─ Events          metrics events …
Ops                ops …
└─ Alerts(ar)      ops alerts …
Projects           projects …
```

`i18n` (and its `Profiles`/`Keys`/`Drafts` tags) is **skipped by the generator**
(`SKIP_TAGS` in `gen-commands.mjs`) — its API parts share a namespace with the
hand-written fs commands, so i18n stays fully custom (see custom-and-fs.md).

## The runtime (`src/commands/_gen-runtime.ts`)

The generated file is pure projection; all behaviour is hand-written here and is
the only thing under test for the generated layer:

- `defineGroup(parent, name, { summary, help, aliases })` — create-or-get a nested
  command group with the tag description as `--help` text + commander aliases.
- `genCtx.run({ mutates, invoke })` — resolves the configured client (binding
  guard for writes), `await`s the sdk fn, unwraps hey-api's `{ data, error,
  response }`, prints, and maps failures to `ApiError`.
- `num` / `bool` / `str` / `json` / `clean` — coerce string flag values into the
  request body. `clean` drops `undefined` keys and erases the static type
  (`never`) — the body is assembled from runtime-coerced flags and validated by
  the server (and the generated zod), not statically.

## Tests

- `src/__tests__/commands.test.ts` — builds `buildProgram()` and snapshots the
  full command path list; asserts the top-level surface, no duplicate siblings,
  every command has a description, every `--help` renders.
- Changing the spec taxonomy ⇒ regenerate (`pnpm gen:cli`) ⇒ update the snapshot.
