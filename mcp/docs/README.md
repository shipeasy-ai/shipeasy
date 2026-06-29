# `@shipeasy/mcp` — docs

> Looking for the tool-by-tool reference? See
> [mcp-reference.md](./mcp-reference.md) — auto-generated from the live tool
> catalog by `pnpm docs` (also published to docs.shipeasy.ai/get-started/mcp-reference).

How the tool surface is built: nearly the whole CRUD/read/docs surface is
**generated from `@shipeasy/openapi`'s bundled spec** — `scripts/gen-tools.mjs`
reads `openapi.yaml` and emits `src/generated/tools.gen.ts` (tool name ← the
tag `parent` chain + the `x-cli` verb; input schema ← path/query params + body
properties). Only auth, `detect_project`, `projects_upsert` (which layers the
`.shipeasy` fs bind), and the fs/AST i18n tools stay hand-written in `src/tools/`
and are merged in `src/tools/schema.ts`.

```
@shipeasy/openapi (spec)
        │  openapi.yaml (tags + x-cli)
        ▼  pnpm gen:tools
src/generated/tools.gen.ts  ─┐
src/tools/*.ts (hand-written) ┴─▶  src/tools/schema.ts  TOOLS[]  ─▶  pnpm docs ─▶ mcp-reference.md
```

Regenerate the tool surface with `pnpm gen:tools` (run **after**
`@shipeasy/openapi`'s `pnpm gen`); regenerate this reference with `pnpm docs`.
Never hand-edit `tools.gen.ts` or `mcp-reference.md`.
