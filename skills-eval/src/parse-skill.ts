import { KNOWN_TOOLS_SET } from "./catalog.js";

export interface ParsedSkill {
  name: string;
  /** Phrases pulled from the frontmatter `Trigger on "…", "…"` list. */
  triggers: string[];
  /** Real MCP tool suffixes referenced anywhere in the skill body. */
  tools: string[];
}

/**
 * Extract the seed material from one SKILL.md:
 *  - trigger phrases (the quoted list after `Trigger on` in the description)
 *  - the MCP tools it documents (validated against the real tool catalogue so
 *    prose identifiers don't leak in).
 *
 * These two lists are exactly what a case needs: a trigger phrase becomes a
 * prompt, and the referenced tools become the candidate `expect_tools`.
 */
export function parseSkill(name: string, raw: string): ParsedSkill {
  return { name, triggers: extractTriggers(raw), tools: extractTools(raw) };
}

/**
 * Quoted phrases following `Trigger on` in the frontmatter `description`. Bound
 * to the description so a skill *without* a `Trigger on` clause (e.g. the `see`
 * skill) yields nothing rather than scraping every quote in the body.
 */
export function extractTriggers(raw: string): string[] {
  const description = extractDescription(raw);
  const m = description.match(/Trigger on\s+(.+)$/is);
  if (!m?.[1]) return []; // no explicit trigger list → nothing to seed
  const phrases = [...m[1].matchAll(/"([^"]{2,60})"/g)].map((x) => (x[1] ?? "").trim());
  // Drop phrases with placeholders/regex-ish noise (e.g. "notify when <metric> exceeds").
  const clean = phrases.filter((p) => !/[<>{}|]/.test(p));
  return uniq(clean);
}

/** The YAML frontmatter `description:` value (single- or multi-line), or "". */
function extractDescription(raw: string): string {
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  const block = fm?.[1] ?? raw;
  const m = block.match(/^description:\s*(.+(?:\n\s+.+)*)/im);
  // Fall back to the whole block (frontmatter for real files; the raw input for
  // bare test strings) when there's no explicit `description:` key.
  return (m?.[1] ?? block).replace(/\s+/g, " ").trim();
}

/**
 * Tool references, in three styles (mirrors @shipeasy/skills-contract's scan):
 *  1. `mcp tool: release_flags_create {`
 *  2. backtick-wrapped identifier `release_flags_create`
 *  3. bare snake_case token in prose
 * Kept only if it's a real tool suffix in KNOWN_TOOLS.
 */
export function extractTools(raw: string): string[] {
  const candidates = new Set<string>();
  for (const m of raw.matchAll(/mcp tool:\s*([a-z0-9_-]+)/gi)) if (m[1]) candidates.add(m[1]);
  for (const m of raw.matchAll(/`([a-z][a-z0-9_-]*)`/g)) if (m[1]) candidates.add(m[1]);
  for (const m of raw.matchAll(/\b([a-z]+(?:_[a-z0-9-]+){1,4})\b/g)) if (m[1]) candidates.add(m[1]);
  return [...candidates].filter((c) => KNOWN_TOOLS_SET.has(c)).sort();
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];
