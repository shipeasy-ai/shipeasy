#!/usr/bin/env node
// Mirror every non-deprecated slash command into a portable skill.
//
// Why: Claude Code consumes `commands/<ns>/<verb>.md` as `/shipeasy:<ns>:<verb>`
// slash commands. No other host has a slash-command primitive — they install
// *skills* via the `skills` CLI (vercel-labs/skills), which only reads
// `SKILL.md` files. So the command set was invisible everywhere but Claude.
//
// This script gives full parity from ONE source of truth:
//   • source        = commands/<ns>/<verb>.md   (Claude reads these directly)
//   • portable skill = skills/.curated/<ns>-<verb>/SKILL.md  → symlink to source
//
// The `skills` CLI explicitly scans `skills/.curated/`, so it discovers the
// mirror. Claude Code's plugin loader ignores dot-prefixed skill dirs, so the
// mirror does NOT double-register against the real slash commands.
//
// The CLI requires a `name:` field in frontmatter (it skips files without
// one); Claude Code's command loader ignores unrecognized frontmatter keys.
// So we inject `name:` + `user-invocable:` into each mirrored command file —
// harmless to the slash command, required by the skill.
//
// Deprecated tombstones ([moved]/[removed]) and the top-level setup.md (the
// `setup` AREA skill already owns that name) are NOT mirrored.
//
// Run from the repo root:  node scripts/sync-skill-mirror.mjs [--check]
// --check exits non-zero if anything is out of sync (for CI / validate-plugin).

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, symlinkSync, lstatSync, readlinkSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = join(ROOT, "shipeasy");
const COMMANDS = join(PLUGIN, "commands");
const CURATED = join(PLUGIN, "skills", ".curated");

const CHECK = process.argv.includes("--check");
let changed = false;
const problems = [];

/** Recursively collect every commands/*.md path. */
function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const isDeprecated = (md) => /\[(moved|removed)\]/i.test(md.slice(0, 800));

/** Split leading `---\n...\n---\n` frontmatter from the body. */
function splitFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return null;
  return { fm: m[1], body: md.slice(m[0].length), raw: m[0] };
}

/** Ensure `name:` and `user-invocable:` exist in frontmatter; return new md or null if unchanged. */
function ensureFrontmatter(md, name) {
  const parts = splitFrontmatter(md);
  if (!parts) {
    problems.push(`no frontmatter: expected --- block`);
    return null;
  }
  let fm = parts.fm;
  let touched = false;
  // The `skills` CLI parses frontmatter as strict YAML and SILENTLY skips any
  // skill whose block won't parse. Claude Code's looser parser tolerates an
  // unquoted `description` containing `: ` (colon-space) — YAML reads that as a
  // nested mapping and the skill vanishes. Quote such values so both agree.
  const descLine = fm.match(/^description:[ \t]*(.*)$/m);
  if (descLine) {
    const val = descLine[1];
    const quoted = /^["']/.test(val.trim());
    if (!quoted && /: /.test(val)) {
      const esc = val.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      fm = fm.replace(/^description:[ \t]*.*$/m, `description: "${esc}"`);
      touched = true;
    }
  }
  if (!/^name:\s*/m.test(fm)) {
    fm = `name: ${name}\n${fm}`;
    touched = true;
  } else if (!new RegExp(`^name:\\s*${name}\\s*$`, "m").test(fm)) {
    fm = fm.replace(/^name:\s*.*$/m, `name: ${name}`);
    touched = true;
  }
  if (!/^user-invocable:\s*/m.test(fm)) {
    fm = `${fm}\nuser-invocable: true`;
    touched = true;
  }
  if (!touched) return null;
  return `---\n${fm}\n---\n${parts.body}`;
}

// 1. Walk commands, build the desired mirror set, sync frontmatter.
const desired = new Map(); // skillName -> command file abs path
for (const file of walk(COMMANDS).sort()) {
  const rel = relative(COMMANDS, file); // e.g. "ops/work.md" or "setup.md"
  const segs = rel.split("/");
  if (segs.length < 2) continue; // top-level (setup.md) — owned by an area skill
  const ns = segs[0];
  const verb = segs[segs.length - 1].replace(/\.md$/, "");
  const md = readFileSync(file, "utf8");
  if (isDeprecated(md)) continue;
  const name = `${ns}-${verb}`;
  desired.set(name, file);

  const next = ensureFrontmatter(md, name);
  if (next) {
    if (CHECK) problems.push(`frontmatter out of sync: commands/${rel} (missing name:/user-invocable:)`);
    else { writeFileSync(file, next); changed = true; console.log(`fm  commands/${rel}  +name:${name}`); }
  }
}

// 2. Reconcile skills/.curated symlinks against the desired set.
if (!existsSync(CURATED)) {
  if (CHECK) problems.push("skills/.curated/ is missing");
  else { mkdirSync(CURATED, { recursive: true }); changed = true; }
}
const existing = existsSync(CURATED)
  ? readdirSync(CURATED, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  : [];

// remove stale
for (const dir of existing) {
  if (!desired.has(dir)) {
    if (CHECK) problems.push(`stale mirror skill: skills/.curated/${dir}`);
    else { rmSync(join(CURATED, dir), { recursive: true, force: true }); changed = true; console.log(`rm  skills/.curated/${dir}`); }
  }
}

// add/repair
for (const [name, target] of desired) {
  const skillDir = join(CURATED, name);
  const link = join(skillDir, "SKILL.md");
  const wantTarget = relative(skillDir, target); // ../../../commands/<ns>/<verb>.md
  let ok = false;
  try {
    if (lstatSync(link).isSymbolicLink() && readlinkSync(link) === wantTarget) ok = true;
  } catch {
    /* missing */
  }
  if (ok) continue;
  if (CHECK) {
    problems.push(`mirror symlink out of sync: skills/.curated/${name}/SKILL.md -> ${wantTarget}`);
  } else {
    mkdirSync(skillDir, { recursive: true });
    rmSync(link, { force: true });
    symlinkSync(wantTarget, link);
    changed = true;
    console.log(`ln  skills/.curated/${name}/SKILL.md -> ${wantTarget}`);
  }
}

if (CHECK) {
  if (problems.length) {
    console.error("skill mirror out of sync:\n  " + problems.join("\n  "));
    console.error("\nrun:  node scripts/sync-skill-mirror.mjs");
    process.exit(1);
  }
  console.log(`skill mirror in sync (${desired.size} mirrored commands)`);
} else {
  if (problems.length) {
    console.error("problems:\n  " + problems.join("\n  "));
    process.exit(1);
  }
  console.log(`\n${changed ? "updated" : "already in sync"}: ${desired.size} mirrored commands -> skills/.curated/`);
}
