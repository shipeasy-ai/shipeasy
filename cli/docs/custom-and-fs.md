# Custom ops + FS commands

Two kinds of command are **not** generated from the spec: the non-endpoint
"sugar" ops (shared with MCP) and the filesystem/AST commands (CLI-only).

## Custom (non-spec) operations — shared registry

Some commands aren't admin-API endpoints, so they can't be generated:
`metrics grammar` (prints the metric-DSL grammar) and `docs list/get/skill`
(fetches each SDK's `/docs/` from GitHub Pages). These live in a **shared
registry** so the CLI and the (future) MCP server project the *same* ops:

```
@shipeasy/openapi/custom            src/commands/custom.ts
  CustomOp[]  ───────────────────▶  customCommands(program)
  { group, name, params, run }      (commander projection; reuses defineGroup)
```

- The registry is **consumer-agnostic** (`run(args) => result`, worker-safe — no
  fs, no commander). Defined in `@shipeasy/openapi/src/custom/`.
- The CLI adapter (`src/commands/custom.ts`) mounts each op as a command,
  coerces flags, calls `run`, prints JSON. The one consumer-side extra:
  `docs skill --install` writes the fetched skill to `~/.claude/skills/shipeasy-<sdk>/`
  (an fs side-effect layered on the worker-safe op).
- To add a shared sugar command, add a `CustomOp` to `@shipeasy/openapi/custom`
  — both surfaces pick it up.

Not here: the `ops bug/feature` alias subtree is **CLI-only commander sugar**
(maps to the generated `ops` commands); it's a follow-up, not a shared op.

Test: `src/__tests__/custom-ops.test.ts`.

## Filesystem / AST commands — CLI-strict

**The CLI owns the entire filesystem surface; it has no `@shipeasy/mcp`
dependency.** (MCP never touches the fs.) The i18n source scanner was vendored
out of `@shipeasy/mcp` into the CLI:

| Command | Logic | Test |
| --- | --- | --- |
| `i18n scan` / `i18n validate` | `src/i18n/scan.ts` (`scanFiles` — TS AST walk for translatable JSX/props/`t()`) | `i18n.scan.test.ts` |
| `i18n codemod` | `src/commands/codemod.ts` + the shipped `codemods/` runner (@babel) | `i18n.codemod.test.ts` |
| `i18n install-loader` | `detectFramework` + `injectNextjsApp`/`injectIndexHtml` in `src/commands/i18n.ts` | `i18n.install-loader.test.ts` |
| `i18n keys` | SDK key minting (API, not fs) | — |

Notes:
- `typescript` is a **runtime dependency** (the scanner uses the TS compiler API);
  `tsup` keeps it external (it's in `dependencies`).
- The only remaining `@shipeasy/mcp` references are **strings** — `npx -y
  @shipeasy/mcp@latest` for `shipeasy mcp serve` and agent-config registration
  (`src/setup/`, `src/commands/mcp.ts`). No module import.
- Each fs command exposes its pure logic as an exported function so it's unit-
  testable without invoking commander (`scanFiles`, `resolveTargets`,
  `detectFramework`, `injectNextjsApp`, `injectIndexHtml`).
