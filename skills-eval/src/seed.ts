/**
 * Seed `cases/<skill>.json` from every shipped SKILL.md: each trigger phrase
 * becomes a draft prompt, and the skill's documented MCP tools become the
 * candidate `expect_tools`. The output is a STARTING POINT — cases land with
 * `tools_match: "none"` (informational) so nothing is falsely asserted; you then
 * refine each prompt into a natural request and promote the right tool(s) to
 * `"all"`/`"any"`.
 *
 *   pnpm --filter @shipeasy/skills-eval seed          # all skills
 *   pnpm --filter @shipeasy/skills-eval seed -- flags # one skill (suffix match)
 *
 * Existing case files are NOT overwritten unless you pass --force, so your hand
 * edits survive a re-seed.
 */
import { readdirSync, readFileSync, existsSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SKILLS_DIR, CASES_DIR } from "./catalog.js";
import { parseSkill } from "./parse-skill.js";
import type { EvalCase } from "./types.js";

const args = process.argv.slice(2);
const force = args.includes("--force");
const filter = args.find((a) => !a.startsWith("--"));

const skillDirs = readdirSync(SKILLS_DIR).filter((d) => {
  const md = join(SKILLS_DIR, d, "SKILL.md");
  if (!existsSync(md) || !statSync(join(SKILLS_DIR, d)).isDirectory()) return false;
  return filter ? d.includes(filter) : true;
});

let wrote = 0;
for (const dir of skillDirs) {
  const raw = readFileSync(join(SKILLS_DIR, dir, "SKILL.md"), "utf8");
  const parsed = parseSkill(dir, raw);
  if (parsed.triggers.length === 0) {
    console.warn(`· ${dir}: no trigger phrases found, skipped`);
    continue;
  }
  const cases: EvalCase[] = parsed.triggers.map((phrase) => ({
    id: `${dir}/${slug(phrase)}`,
    prompt: phrase, // DRAFT: refine into a natural user request
    expect_skill: dir,
    expect_tools: parsed.tools,
    tools_match: "none", // promote to "all"/"any" once you pick the real tool(s)
    note: "auto-seeded from trigger phrase; refine prompt + expect_tools",
  }));

  const out = join(CASES_DIR, `${dir}.json`);
  if (existsSync(out) && !force) {
    console.warn(`· ${dir}: exists, skipped (use --force to regenerate)`);
    continue;
  }
  writeFileSync(out, JSON.stringify(cases, null, 2) + "\n");
  console.log(`✓ ${dir}: ${cases.length} draft case(s) → cases/${dir}.json`);
  wrote++;
}
console.log(`\nSeeded ${wrote} skill file(s). Edit cases/*.json before running \`pnpm eval\`.`);

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
}
