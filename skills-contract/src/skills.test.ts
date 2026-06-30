import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, it, expect } from "vitest";

// The real surfaces, exactly as shipped. `^build` (turbo) builds both before
// this test runs, so we validate against the freshly-generated command tree and
// tool catalog — not a stale copy.
import { buildProgram } from "@shipeasy/cli/program";
import { ALL_TOOLS } from "@shipeasy/mcp/tools-manifest";

import {
  type CliRef,
  type CmdNode,
  type McpRef,
  type ToolDef,
  extractCliRefs,
  extractMcpRefs,
  toolPrefixesFrom,
  validateCliRef,
  validateMcpRef,
} from "./scan.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..");
const SKILLS_DIR = join(REPO, "shipeasy", "skills");

const skillFiles = readdirSync(SKILLS_DIR)
  .map((d) => join(SKILLS_DIR, d, "SKILL.md"))
  .filter(existsSync);

const program = buildProgram() as unknown as CmdNode;
const tools = ALL_TOOLS as unknown as ToolDef[];
const toolByName = new Map(tools.map((t) => [t.name, t]));
const toolPrefixes = toolPrefixesFrom(tools);

// Collect every reference once, up front, so each gets its own `it` case.
const cliRefs: CliRef[] = [];
const mcpRefs: McpRef[] = [];
for (const file of skillFiles) {
  const rel = relative(REPO, file);
  const raw = readFileSync(file, "utf8");
  cliRefs.push(...extractCliRefs(rel, raw));
  mcpRefs.push(...extractMcpRefs(rel, raw, toolPrefixes));
}

// Dedupe so identical invocations across skills don't spam the report.
function dedupe<T>(items: T[], key: (x: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const x of items) if (!seen.has(key(x))) seen.set(key(x), x);
  return [...seen.values()];
}
const uniqueCli = dedupe(cliRefs, (r) => `${r.file}::${r.raw}`);
const uniqueMcp = dedupe(mcpRefs, (r) => `${r.file}::${r.name}::${r.keys.join(",")}::${r.kind}`);

describe("skills reference a real command surface", () => {
  // Guard against a broken scanner silently passing: if the extractors stop
  // finding references (regex rot, moved skills), this fails loudly instead of
  // reporting a vacuous green.
  it("finds skills and a non-trivial number of references", () => {
    expect(skillFiles.length).toBeGreaterThan(0);
    expect(cliRefs.length).toBeGreaterThan(30);
    expect(mcpRefs.length).toBeGreaterThan(30);
  });
});

describe("CLI commands referenced by skills exist (path + flags)", () => {
  it.each(uniqueCli.map((r) => [`${r.file} → ${r.raw}`, r] as const))("%s", (_label, ref) => {
    expect(validateCliRef(ref, program)).toEqual([]);
  });
});

describe("MCP tools referenced by skills exist (name + params)", () => {
  it.each(
    uniqueMcp.map(
      (r) =>
        [`${r.file} → ${r.name}${r.keys.length ? ` {${r.keys.join(", ")}}` : ""}`, r] as const,
    ),
  )("%s", (_label, ref) => {
    expect(validateMcpRef(ref, toolByName)).toEqual([]);
  });
});
