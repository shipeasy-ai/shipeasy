import { spawnSync } from "node:child_process";
import { MARKETPLACE_SLUG } from "./agents";

/**
 * The single source of truth mapping a Shipeasy feature to the marketplace
 * skill(s) that document it. `shipeasy setup` installs these (via the `skills`
 * CLI) into the coding agents it wired, so every selected feature ships with
 * its own how-to skill.
 *
 * **Scalability:** this is the ONE place to edit when skills are added, renamed,
 * or split — setup reads the map, it hardcodes nothing. Each feature points at
 * its umbrella *-install skill; those umbrellas pull in their own sub-skills, so
 * we never enumerate the whole tree here.
 */
export const FEATURE_SKILLS: Record<string, string[]> = {
  flags: ["shipeasy-flags"],
  ops: ["shipeasy-ops"],
  i18n: ["shipeasy-i18n"],
};

/** Repo-relative dir holding the marketplace skills (the plugin root). */
export const SKILLS_SUBDIR = "shipeasy/skills";

/** The `skills add` source for a marketplace skill by name (GitHub tree path). */
export function marketplaceSkillSource(name: string): string {
  return `${MARKETPLACE_SLUG}/${SKILLS_SUBDIR}/${name}`;
}

/** Raw-content URL for a marketplace skill's SKILL.md (for templated install). */
export function marketplaceSkillRawUrl(name: string, ref = "main"): string {
  return `https://raw.githubusercontent.com/${MARKETPLACE_SLUG}/${ref}/${SKILLS_SUBDIR}/${name}/SKILL.md`;
}

/** De-duplicated skill names for a set of selected features (unknown → []). */
export function skillsForFeatures(features: string[]): string[] {
  const out = new Set<string>();
  for (const f of features) for (const s of FEATURE_SKILLS[f] ?? []) out.add(s);
  return [...out];
}

export interface SkillsCliResult {
  source: string;
  agent: string | null;
  ok: boolean;
}

/**
 * Run the `skills` CLI ourselves to install one source into agents. With
 * `agents` we install into each named agent non-interactively; with none we let
 * `skills` auto-detect + prompt. Best-effort: a missing `npx`/`skills`/network
 * yields `ok:false` rather than throwing, so setup surfaces it and moves on.
 */
export function runSkillsAdd(
  source: string,
  opts: { agents?: string[]; global?: boolean } = {},
): SkillsCliResult[] {
  const runs = opts.agents && opts.agents.length ? opts.agents : [null];
  return runs.map((agent) => {
    const args = ["-y", "skills", "add", source];
    if (opts.global) args.push("-g");
    if (agent) args.push("-a", agent);
    const res = spawnSync("npx", args, { stdio: "inherit" });
    return { source, agent, ok: res.status === 0 };
  });
}
