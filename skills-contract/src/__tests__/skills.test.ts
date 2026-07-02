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
} from "../scan.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, "..", "..", "..");
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

// The plugin ships no slash-command surface anymore — every workflow is a
// skill. A `/shipeasy:<…>` token in any shipped skill file (SKILL.md or a
// companion doc like TRIGGER-INSTALL.md) is therefore a stale reference that
// dead-ends on every host. Skills reference each other by skill name instead
// (e.g. "the `shipeasy-ops-work` skill").
describe("skills are self-contained (no stale slash-command refs, namespaced names)", () => {
  const skillDirs = readdirSync(SKILLS_DIR).filter((d) =>
    existsSync(join(SKILLS_DIR, d, "SKILL.md")),
  );

  it("every skill dir is shipeasy-prefixed and matches its frontmatter name", () => {
    for (const dir of skillDirs) {
      expect(dir, `skill dir "${dir}" must be namespaced`).toMatch(/^shipeasy-/);
      const raw = readFileSync(join(SKILLS_DIR, dir, "SKILL.md"), "utf8");
      const name = raw.match(/^---\n[\s\S]*?^name:[ \t]*(\S+)[ \t]*$/m)?.[1];
      expect(name, `skill "${dir}" frontmatter name`).toBe(dir);
    }
  });

  it("no skill file references a /shipeasy:* slash command", () => {
    const offenders: string[] = [];
    for (const dir of skillDirs) {
      for (const f of readdirSync(join(SKILLS_DIR, dir)).filter((f) => f.endsWith(".md"))) {
        const raw = readFileSync(join(SKILLS_DIR, dir, f), "utf8");
        for (const [i, line] of raw.split("\n").entries()) {
          if (line.includes("/shipeasy:")) offenders.push(`${dir}/${f}:${i + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every skill another skill points at actually ships", () => {
    const shipped = new Set(skillDirs);
    const offenders: string[] = [];
    for (const dir of skillDirs) {
      for (const f of readdirSync(join(SKILLS_DIR, dir)).filter((f) => f.endsWith(".md"))) {
        const raw = readFileSync(join(SKILLS_DIR, dir, f), "utf8");
        // `shipeasy-<name>` in backticks or the "shipeasy-<name> skill" phrasing.
        for (const m of raw.matchAll(/`(shipeasy-[a-z0-9-]+)`(?:\s+skill)?|\b(shipeasy-[a-z0-9-]+)\s+skill\b/g)) {
          const name = m[1] ?? m[2];
          // Ignore non-skill shipeasy-* identifiers (packages, hosts, files).
          if (name.startsWith("shipeasy-mcp") || name.startsWith("shipeasy-ai")) continue;
          if (name === "shipeasy-onboarded") continue; // the project pointer setup drops
          if (!shipped.has(name)) offenders.push(`${dir}/${f}: references unknown skill "${name}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
