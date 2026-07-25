#!/usr/bin/env node
/**
 * Generate `src/generated/tools.ts` — the MCP tool-name catalogue the eval uses
 * to tell a real tool reference from prose.
 *
 * Source of truth is `@shipeasy/mcp`'s `ALL_TOOLS` (static auth/projects tools +
 * every registry-projected tool), so the list can never drift from the surface
 * the server actually registers. We emit a committed file rather than importing
 * the manifest at runtime so the fast unit tests keep working without the MCP
 * package built.
 *
 * Run after changing the MCP surface:  pnpm --filter @shipeasy/skills-eval gen:catalog
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_TOOLS } from "@shipeasy/mcp/tools-manifest";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../src/generated/tools.ts");

/** Sorted + deduped tool names, exactly as the MCP server registers them. */
export function toolNames(tools) {
  return [...new Set(tools.map((t) => t.name))].sort();
}

export function render(names) {
  return [
    "// AUTO-GENERATED from @shipeasy/mcp's ALL_TOOLS by scripts/gen-catalog.mjs — DO NOT EDIT.",
    "// Regenerate with `pnpm --filter @shipeasy/skills-eval gen:catalog`.",
    "",
    "/** Every MCP tool suffix (the name minus the `mcp__<server>__` prefix). */",
    "export const KNOWN_TOOLS: readonly string[] = [",
    ...names.map((n) => `  ${JSON.stringify(n)},`),
    "];",
    "",
  ].join("\n");
}

const names = toolNames(ALL_TOOLS);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, render(names), "utf8");
console.log(`wrote ${names.length} tool name(s) → ${OUT}`);
