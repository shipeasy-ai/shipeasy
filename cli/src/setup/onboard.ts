import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { TargetRecommendation } from "../commands/scan";
import { onPath } from "./agents";

/**
 * The deterministic half of onboarding, as plain functions the
 * `setup` command orchestrates: preconditions, per-target binding, key
 * persistence, SDK package installs, the pointer skill, and small shared
 * helpers. Everything here is mechanical — no judgement calls, no codebase
 * edits. The judgement-requiring remainder (entry-point wiring, non-.env
 * secret stores, overlay injection) is emitted as agent instructions by
 * `wiring-doc.ts` instead.
 */

// ── preconditions ────────────────────────────────────────────────────────────

export interface Preconditions {
  nodeVersion: string;
  nodeOk: boolean;
  gitRepo: boolean;
}

export function checkPreconditions(cwd: string): Preconditions {
  const nodeVersion = process.versions.node;
  const major = Number(nodeVersion.split(".")[0]);
  const git = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    nodeVersion,
    nodeOk: Number.isFinite(major) && major >= 20,
    gitRepo: git.status === 0,
  };
}

export function gitInit(cwd: string): boolean {
  return spawnSync("git", ["init"], { cwd, stdio: ["ignore", "pipe", "pipe"] }).status === 0;
}

// ── targets ──────────────────────────────────────────────────────────────────

/** The targets setup acts on: fresh installs + SDK-present-but-keyless. */
export function actionableTargets(targets: TargetRecommendation[]): TargetRecommendation[] {
  return targets.filter(
    (t) => t.recommendation.action === "install" || t.recommendation.action === "set_key",
  );
}

export function relPath(root: string, p: string): string {
  const r = relative(root, p);
  return r === "" ? "." : r;
}

// ── per-target binding ───────────────────────────────────────────────────────

export interface BindOutcome {
  dir: string;
  action: "bound" | "already" | "kept_other";
  projectId: string;
}

/**
 * Give each target dir its own `.shipeasy` binding (detect already wrote the
 * sdk/language there). A target already bound to a DIFFERENT project is left
 * alone — surfaced as `kept_other` so the caller can tell the user how to
 * override. Reads the LOCAL file only (never the walk-up view) so an ancestor
 * binding doesn't mask an unbound subproject.
 */
export function bindTargetDirs(
  dirs: string[],
  projectId: string,
  projectName: string | undefined,
  bind: (dir: string, projectId: string, name?: string) => { path: string; created: boolean },
): BindOutcome[] {
  const out: BindOutcome[] = [];
  for (const dir of dirs) {
    const local = readLocalShipeasy(dir);
    if (local.project_id === projectId) {
      out.push({ dir, action: "already", projectId });
    } else if (local.project_id) {
      out.push({ dir, action: "kept_other", projectId: local.project_id });
    } else {
      bind(dir, projectId, projectName);
      out.push({ dir, action: "bound", projectId });
    }
  }
  return out;
}

function readLocalShipeasy(dir: string): { project_id?: string; sdk?: string } {
  try {
    return JSON.parse(readFileSync(join(dir, ".shipeasy"), "utf8")) as {
      project_id?: string;
      sdk?: string;
    };
  } catch {
    return {};
  }
}

// ── SDK keys: env var naming + .env persistence ──────────────────────────────

export const SERVER_KEY_VAR = "SHIPEASY_SERVER_KEY";

/** Public client-key var name per framework's env-exposure convention. */
export function clientKeyVar(frameworks: string[]): string {
  if (frameworks.includes("nextjs")) return "NEXT_PUBLIC_SHIPEASY_CLIENT_KEY";
  if (frameworks.includes("nuxt")) return "NUXT_PUBLIC_SHIPEASY_CLIENT_KEY";
  if (frameworks.includes("sveltekit")) return "PUBLIC_SHIPEASY_CLIENT_KEY";
  return "SHIPEASY_CLIENT_KEY";
}

/** Project-id var (devtools overlay attribute) — same exposure prefix. */
export function projectIdVar(frameworks: string[]): string {
  return clientKeyVar(frameworks).replace("SHIPEASY_CLIENT_KEY", "SHIPEASY_PROJECT_ID");
}

/** Which env file we persist keys into for this target. */
export function envFileFor(target: TargetRecommendation): string {
  return target.frameworks.includes("nextjs") ? ".env.local" : ".env";
}

const ENV_FILES = [".env", ".env.local", ".env.production", ".env.development"];

export interface EnvWrite {
  file: string;
  added: string[];
  existing: string[];
}

/**
 * Append `entries` (VAR → value) to `<dir>/<file>`, skipping any var already
 * defined in any of the conventional env files. Never rewrites existing lines
 * — mint-once key values must not be clobbered.
 */
export function persistEnv(dir: string, file: string, entries: Record<string, string>): EnvWrite {
  const present = new Set<string>();
  for (const f of ENV_FILES) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const key = line.split("=")[0]?.trim();
      if (key && !key.startsWith("#")) present.add(key);
    }
  }

  const added: string[] = [];
  const existing: string[] = [];
  let block = "";
  for (const [name, value] of Object.entries(entries)) {
    if (present.has(name)) {
      existing.push(name);
    } else {
      added.push(name);
      block += `${name}=${value}\n`;
    }
  }
  if (added.length) {
    const path = join(dir, file);
    const current = existsSync(path) ? readFileSync(path, "utf8") : "";
    const sep = current && !current.endsWith("\n") ? "\n" : "";
    writeFileSync(path, `${current}${sep}# Shipeasy SDK keys (minted by \`shipeasy setup\`)\n${block}`, "utf8");
  }
  return { file, added, existing };
}

export interface GitignoreResult {
  action: "ok" | "added";
  detail: string;
}

/**
 * Make sure the env file holding a server key never gets committed: if git
 * doesn't already ignore it, append it to the target's `.gitignore`.
 */
export function ensureGitignored(dir: string, file: string): GitignoreResult {
  const check = spawnSync("git", ["check-ignore", "-q", file], {
    cwd: dir,
    stdio: ["ignore", "ignore", "ignore"],
  });
  if (check.status === 0) return { action: "ok", detail: `${file} already gitignored` };

  const gi = join(dir, ".gitignore");
  const current = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  const lines = current.split("\n").map((l) => l.trim());
  if (lines.includes(file) || lines.includes(`/${file}`)) {
    return { action: "ok", detail: `${file} listed in .gitignore` };
  }
  const sep = current && !current.endsWith("\n") ? "\n" : "";
  writeFileSync(gi, `${current}${sep}${file}\n`, "utf8");
  return { action: "added", detail: `added ${file} to ${gi}` };
}

export function maskKey(key: string): string {
  return `*…${key.slice(-4)}`;
}

// ── SDK package install ──────────────────────────────────────────────────────

/**
 * The argv for installs a CLI can safely run itself: ones that both fetch the
 * package AND record it in the project's manifest/lockfile. Manifest-edit-first
 * ecosystems (Gemfile, pom.xml, build.gradle, Package.swift, bare pip) return
 * null — those go into the wiring instructions instead.
 */
export function installArgv(
  language: string,
  packageManager: string,
  frameworks: string[],
): string[] | null {
  switch (language) {
    case "typescript":
    case "javascript": {
      const mgr = packageManager && packageManager !== "unknown" ? packageManager : "npm";
      const verb = mgr === "npm" ? "install" : "add";
      const react = frameworks.includes("react") || frameworks.includes("nextjs");
      return [mgr, verb, "@shipeasy/sdk", ...(react ? ["@shipeasy/react"] : [])];
    }
    case "python":
      return packageManager === "poetry" ? ["poetry", "add", "shipeasy"] : null;
    case "go":
      return ["go", "get", "github.com/shipeasy-ai/sdk-go"];
    case "php":
      return ["composer", "require", "shipeasy/shipeasy"];
    default:
      return null;
  }
}

export interface InstallOutcome {
  /** ran = we executed it; deferred = left for the wiring instructions. */
  status: "ran" | "failed" | "deferred";
  cmd: string;
}

/** Run the SDK install in the target dir (streaming output to the terminal). */
export function runSdkInstall(target: TargetRecommendation): InstallOutcome {
  const argv = installArgv(target.language, target.package_manager, target.frameworks);
  const fallback = target.recommendation.install ?? "(see wiring instructions)";
  if (!argv || !onPath(argv[0]!)) return { status: "deferred", cmd: fallback };

  const res = spawnSync(argv[0]!, argv.slice(1), { cwd: target.path, stdio: "inherit" });
  return { status: res.status === 0 ? "ran" : "failed", cmd: argv.join(" ") };
}

// ── secret-store classification ──────────────────────────────────────────────

/**
 * True when the target's idiomatic secret store is something OTHER than the
 * plain env file we just wrote (wrangler secrets, Rails credentials, JVM
 * application.properties). The wiring instructions then include a "move the
 * value out of .env" step.
 */
export function needsStoreMove(secretStore: string | null): boolean {
  if (!secretStore) return false;
  return /wrangler|rails credentials|application\.properties/i.test(secretStore);
}
