import { spawnSync } from "node:child_process";
import { MARKETPLACE_SLUG, onPath } from "./agents";

/**
 * The single source of truth mapping a Shipeasy feature to the marketplace
 * skill(s) that document it. `shipeasy setup` installs these (via the `skills`
 * CLI) into the coding agents it wired, so every selected feature ships with
 * ALL the how-to skills that its workflow spans — overlap across features is
 * intentional (e.g. both `flags` and `ops` want `shipeasy-metrics`).
 *
 * **Scalability:** this is the ONE place to edit when skills are added, renamed,
 * or split — setup reads the map, it hardcodes nothing. `shipeasy-setup` is not
 * listed here because it rides along with EVERY setup regardless of features
 * (see {@link ALWAYS_SKILLS}).
 *
 * The `flags` key is the setup/`--features` name for the release module (flags,
 * configs, kill switches, experiments, metrics); it maps to that whole skill set.
 */
export const FEATURE_SKILLS: Record<string, string[]> = {
  // release (flags/configs/killswitches/experiments/metrics)
  flags: ["shipeasy-experiments", "shipeasy-flags", "shipeasy-metrics"],
  // ops queue + feedback/errors/alerts + the see() reporting grammar
  ops: [
    "shipeasy-ops",
    "shipeasy-ops-work",
    "shipeasy-see",
    "shipeasy-alerts",
    "shipeasy-metrics",
  ],
  i18n: ["shipeasy-i18n"],
};

/**
 * Skills installed for EVERY `shipeasy setup` run, whatever features are chosen.
 * `shipeasy-setup` documents the onboarding/wiring surface, so it always ships.
 */
export const ALWAYS_SKILLS: string[] = ["shipeasy-setup"];

/** Repo-relative dir holding the marketplace skills (the plugin root). */
export const SKILLS_SUBDIR = "shipeasy/skills";

/** The `skills add` source for a marketplace skill by name (GitHub tree path). */
export function marketplaceSkillSource(name: string): string {
  return `${MARKETPLACE_SLUG}/${SKILLS_SUBDIR}/${name}`;
}

/** Raw-content URL for a marketplace skill's SKILL.md (for templated install). */
export function marketplaceSkillRawUrl(name: string, ref = "main"): string {
  return marketplaceSkillFileRawUrl(name, "SKILL.md", ref);
}

/** Raw-content URL for any file inside a marketplace skill's directory. */
export function marketplaceSkillFileRawUrl(name: string, file: string, ref = "main"): string {
  return `https://raw.githubusercontent.com/${MARKETPLACE_SLUG}/${ref}/${SKILLS_SUBDIR}/${name}/${file}`;
}

/**
 * List a marketplace skill's `references/` files (skill-relative paths) via the
 * GitHub contents API. Best-effort: a skill without references, an API error,
 * or no network all yield `[]` — SKILL.md alone still installs.
 */
export async function listMarketplaceSkillReferences(
  name: string,
  ref = "main",
): Promise<string[]> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${MARKETPLACE_SLUG}/contents/${SKILLS_SUBDIR}/${name}/references?ref=${ref}`,
      { headers: { accept: "application/vnd.github+json" } },
    );
    if (!res.ok) return [];
    const entries = (await res.json()) as Array<{ type?: string; name?: string }>;
    return entries
      .filter((e) => e.type === "file" && typeof e.name === "string")
      .map((e) => `references/${e.name}`);
  } catch {
    return [];
  }
}

/** De-duplicated skill names for a set of selected features (unknown → []). */
export function skillsForFeatures(features: string[]): string[] {
  const out = new Set<string>();
  for (const f of features) for (const s of FEATURE_SKILLS[f] ?? []) out.add(s);
  return [...out];
}

/**
 * The how-to skills `shipeasy setup` installs for a chosen feature set: the
 * always-on {@link ALWAYS_SKILLS} plus every selected feature's skills, deduped.
 * Feature-scoped — an agent only gets the skills for what the user turned on
 * (plus `shipeasy-setup`), never the whole catalogue.
 */
export function setupSkillNames(features: string[]): string[] {
  return [...new Set([...ALWAYS_SKILLS, ...skillsForFeatures(features)])];
}

/**
 * The full how-to skill set (deduped) across every feature — `shipeasy-setup`
 * plus all feature skills. The non-interactive / no-feature fallback so no wired
 * agent is left without workflow skills when nothing specific was selected.
 */
export function baseSkillNames(): string[] {
  return setupSkillNames(Object.keys(FEATURE_SKILLS));
}

export interface SkillsCliResult {
  source: string;
  agent: string | null;
  ok: boolean;
}

/** How the `skills` CLI is reachable on this machine. `argv0` + `prefix` is the
 *  exact command to spawn (`skills …` when it's on PATH, else `npx -y skills …`). */
export interface SkillsCli {
  argv0: string;
  prefix: string[];
  /** Where it came from — `installed` means we ran `npm i -g skills` just now. */
  source: "path" | "npx" | "installed" | "missing";
  detail: string;
}

/** Probe: does `<argv0> <prefix> --version` actually run? */
function skillsCliWorks(argv0: string, prefix: string[]): boolean {
  const res = spawnSync(argv0, [...prefix, "--version"], {
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 120_000,
  });
  return res.status === 0;
}

let cachedSkillsCli: SkillsCli | null = null;

/**
 * Make sure the `skills` CLI is actually available BEFORE we depend on it, and
 * install it when it isn't. Order matters: an already-installed binary wins, then
 * `npx skills` (which self-fetches into the npx cache), and only if neither can
 * run do we install the package globally (`npm i -g skills`) — so we never do a
 * surprise global install on a machine where `npx` already works. Memoized: the
 * probe spawns a process, and setup calls this once per skill batch.
 *
 * Never throws — `source: "missing"` lets the caller fall back to writing the
 * skill files straight into `.claude/skills/`.
 */
export function ensureSkillsCli(): SkillsCli {
  if (cachedSkillsCli) return cachedSkillsCli;

  if (onPath("skills") && skillsCliWorks("skills", [])) {
    cachedSkillsCli = { argv0: "skills", prefix: [], source: "path", detail: "`skills` on PATH" };
    return cachedSkillsCli;
  }
  if (onPath("npx") && skillsCliWorks("npx", ["-y", "skills"])) {
    cachedSkillsCli = {
      argv0: "npx",
      prefix: ["-y", "skills"],
      source: "npx",
      detail: "via `npx -y skills`",
    };
    return cachedSkillsCli;
  }
  // Neither path works — install the package so the rest of setup can use it.
  const install = spawnSync("npm", ["install", "-g", "skills"], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 300_000,
  });
  if (install.status === 0 && onPath("skills")) {
    cachedSkillsCli = {
      argv0: "skills",
      prefix: [],
      source: "installed",
      detail: "installed `skills` globally (npm i -g skills)",
    };
    return cachedSkillsCli;
  }
  cachedSkillsCli = {
    argv0: "skills",
    prefix: [],
    source: "missing",
    detail:
      "`skills` CLI unavailable" +
      (install.status === 0 ? "" : ` (npm i -g skills failed: ${install.status ?? "?"})`),
  };
  return cachedSkillsCli;
}

/** Reset the memoized CLI probe (tests). */
export function resetSkillsCliCache(): void {
  cachedSkillsCli = null;
}

/**
 * Run the `skills` CLI ourselves to install one source into agents. With
 * `agents` we install into each named agent non-interactively; with none we let
 * `skills` auto-detect. Best-effort: a missing `npx`/`skills`/network yields
 * `ok:false` rather than throwing, so setup surfaces it and moves on.
 *
 * Every invocation is fully non-interactive: `-y` skips the confirmation AND the
 * scope prompt, and the scope the user already picked in setup is passed through
 * explicitly — `-g` for user-global, nothing for project (the CLI's default, and
 * what `-y` auto-detects inside a repo). `skills add` has no `-p` counterpart.
 */
export function runSkillsAdd(
  source: string,
  opts: { agents?: string[]; global?: boolean; skills?: string[] } = {},
): SkillsCliResult[] {
  const cli = ensureSkillsCli();
  const runs = opts.agents && opts.agents.length ? opts.agents : [null];
  return runs.map((agent) => {
    if (cli.source === "missing") return { source, agent, ok: false };
    const args = [...cli.prefix, "add", source];
    if (opts.global) args.push("-g");
    args.push("-y"); // never stop to ask about scope or confirmation — setup already asked
    if (agent) args.push("-a", agent);
    // Variadic `--skill a b c` installs several named skills from one source in a
    // single invocation. Keep it LAST so it doesn't swallow the flags above.
    if (opts.skills?.length) args.push("--skill", ...opts.skills);
    const res = spawnSync(cli.argv0, args, { stdio: "inherit" });
    return { source, agent, ok: res.status === 0 };
  });
}
