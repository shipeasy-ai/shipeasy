# `@shipeasy/cli` — implementation notes

How the CLI is built. The command surface is **three layers**, two of them
projected from the OpenAPI spec and one hand-written:

```
@shipeasy/openapi (spec → generated client)
        │
        ├── openapi.yaml (tags + x-cli)  ──gen:cli──▶  src/generated/commands.gen.ts
        │                                              (the whole API command tree)
        ├── @shipeasy/openapi/custom     ───────────▶  src/commands/custom.ts
        │   (CustomOp[]: grammar, docs)                (sugar that isn't a spec endpoint)
        │
   src/commands/*.ts (hand-written)      ───────────▶  fs/AST + auth + install
                                                       (i18n scan/codemod/loader, keys, setup, mcp, login)
        │
        └────────────────────────▶  src/index.ts  buildProgram()  →  commander tree
```

| Layer | Source | Where | Doc |
| --- | --- | --- | --- |
| **Generated API commands** | the spec's tags + `x-cli` | `src/generated/commands.gen.ts` (regen: `pnpm gen:cli`) | [generated-commands.md](./generated-commands.md) |
| **Custom (non-spec) ops** | `@shipeasy/openapi/custom` | `src/commands/custom.ts` | [custom-and-fs.md](./custom-and-fs.md) |
| **FS / AST commands** | hand-written, CLI-strict | `src/i18n/`, `src/commands/{i18n,codemod,keys,setup,mcp}.ts` | [custom-and-fs.md](./custom-and-fs.md) |
| **Auth + project scope** | `.shipeasy` + creds file | `src/api/client.ts`, `src/auth/`, `src/util/project-config.ts` | [auth.md](./auth.md) |

## Build & test

```sh
pnpm gen:cli      # regenerate src/generated/commands.gen.ts from the spec
pnpm type-check   # tsc --noEmit
pnpm build        # tsup → dist/ (cjs); bin/shipeasy.js calls run()
pnpm test         # vitest (command-tree snapshot + FS + custom + auth)
pnpm dev …        # tsx src/index.ts … (run from source)
```

The command surface is pinned by a snapshot (`src/__tests__/__snapshots__/commands.test.ts.snap`).
Any add/remove/rename is an intentional `pnpm exec vitest run --update`.

## Design rules

- **No hand-written API command bodies.** Anything backed by an admin endpoint is
  generated. To change it, change the **spec** (`@shipeasy/openapi`), not the CLI.
- **CLI owns the filesystem.** All fs/AST lives in the CLI; the CLI has **no
  `@shipeasy/mcp` dependency** (MCP never touches the fs). See [custom-and-fs.md](./custom-and-fs.md).
- **Sugar is shared, not duplicated.** Non-endpoint commands live in the
  `@shipeasy/openapi/custom` registry so the (future) MCP server projects the same ops.
