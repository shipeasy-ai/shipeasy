import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { zCreateKeyRequest } from "@shipeasy/openapi/schemas";
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

// ── SDK keys: provenance label ───────────────────────────────────────────────

/**
 * Longest `name` the create-key API accepts, read straight off the spec schema
 * (`CreateKeyRequest.name`) so the label budget tracks the contract instead of
 * a copy of it. Falls back to the conservative pre-widening cap if the
 * generated shape ever changes under us — a short label is a cosmetic loss, a
 * rejected one fails the mint.
 */
function maxKeyNameLength(): number {
  try {
    const max = zCreateKeyRequest.shape.name.unwrap().maxLength;
    return typeof max === "number" && max > 0 ? max : 80;
  } catch {
    return 80;
  }
}

/** `python/django`, or bare `python` when no framework was detected. */
function stackLabel(target: TargetRecommendation): string {
  const fw = target.frameworks[0];
  return fw ? `${target.language}/${fw}` : target.language;
}

/**
 * What the operator calls the thing setup ran in: the declared package name
 * when the target has one, else the folder name. `package.json#name` beats the
 * directory because that's the identity a JS monorepo actually uses (`apps/web`
 * on disk is `@acme/web` in every other tool).
 */
function packageLabel(dir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: unknown };
    if (typeof pkg.name === "string" && pkg.name.trim()) return pkg.name.trim();
  } catch {
    // no package.json, or not JSON — fall through to the folder name
  }
  return basename(dir) || dir;
}

/** Dedupe, keep source order, and collapse a long tail into "+N more". */
function joinDistinct(values: string[], keep: number): string {
  const seen = [...new Set(values.filter(Boolean))];
  if (seen.length <= keep) return seen.join(" + ");
  return `${seen.slice(0, keep).join(" + ")} +${seen.length - keep} more`;
}

export interface KeyLabelInput {
  /** Kind of key being minted — leads the label so a server/client pair minted
   *  from the same target doesn't produce two identical rows. */
  type: "server" | "client";
  /** The targets this key was minted for (the ones that asked for this type). */
  targets: TargetRecommendation[];
  /** Operator who ran setup, from the CLI session. */
  email?: string;
  /** Stamped by the caller so the label is deterministic under test. */
  now: Date;
}

/**
 * Human label for a key minted by `shipeasy setup`, e.g.
 *
 *   `server key — shipeasy setup · python/django · billing-api · 2026-07-27 · dev@acme.com`
 *
 * Keys outlive the session that minted them, so the row has to answer "where
 * did this come from?" on its own: which stack it was wired into, which package
 * in the repo, when, and by whom. The alternative is the API's generic
 * fallback name, which tells a reader nothing beyond "some tool made this" —
 * and a project with several apps ends up with a column of identical labels.
 *
 * The stack/package segment is what gets squeezed if the whole thing would
 * exceed the API cap: a truncated package name still reads, a truncated email
 * or date is worse than useless.
 */
export function keyLabel({ type, targets, email, now }: KeyLabelInput): string {
  const date = now.toISOString().slice(0, 10);
  const head = `${type} key — shipeasy setup`;
  const tail = [date, email].filter(Boolean).join(" · ");

  const stacks = joinDistinct(targets.map(stackLabel), 2);
  const packages = joinDistinct(
    targets.map((t) => packageLabel(t.path)),
    2,
  );
  const middle = [stacks, packages].filter(Boolean).join(" · ");
  if (!middle) return `${head} · ${tail}`;

  // Everything but `middle` is fixed cost; spend what's left on it. Below ~8
  // chars there's nothing legible to keep, so drop the segment outright rather
  // than ship "ty… · @a…".
  const budget = maxKeyNameLength() - `${head} · ${tail}`.length - " · ".length;
  if (budget < 8) return `${head} · ${tail}`;
  return `${head} · ${middle.length <= budget ? middle : `${middle.slice(0, budget - 1)}…`} · ${tail}`;
}

// ── SDK keys: env var naming + .env persistence ──────────────────────────────

export const SERVER_KEY_VAR = "SHIPEASY_SERVER_KEY";

/** Public client-key var name per framework's env-exposure convention. */
export function clientKeyVar(frameworks: string[]): string {
  // Expo inlines `EXPO_PUBLIC_*` into the bundle at build time; a bare React
  // Native app has no env convention at all, so it keeps the plain name and
  // the value gets wired through the app's own config.
  if (frameworks.includes("expo")) return "EXPO_PUBLIC_SHIPEASY_CLIENT_KEY";
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
 * ecosystems — Java/Kotlin (pom.xml, build.gradle) and Swift (Package.swift),
 * plus bare pip (no manifest write) — return null and go into the wiring
 * instructions instead.
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
      // React/Next targets need no separate package — the browser build ships in
      // @shipeasy/sdk (the `@shipeasy/sdk/client` export). @shipeasy/react is sunset.
      return [mgr, verb, "@shipeasy/sdk"];
    }
    case "ruby":
      // `bundle add` fetches AND records in the Gemfile (unlike hand-editing it).
      return ["bundle", "add", "shipeasy-sdk"];
    case "python": {
      // Django needs the `shipeasy[django]` extra (management command + AppConfig).
      // Only managers that record the dep in the manifest can be auto-run; bare
      // pip (no manifest write) is deferred to the wiring instructions.
      const pkg = frameworks.includes("django") ? "shipeasy[django]" : "shipeasy";
      switch (packageManager) {
        case "poetry":
          return ["poetry", "add", pkg];
        case "uv":
          return ["uv", "add", pkg];
        case "pipenv":
          return ["pipenv", "install", pkg];
        case "pdm":
          return ["pdm", "add", pkg];
        default:
          return null; // bare pip
      }
    }
    case "go":
      return ["go", "get", "github.com/shipeasy-ai/sdk-go"];
    case "php":
      return ["composer", "require", "shipeasy/shipeasy"];
    default:
      return null;
  }
}

/**
 * A framework's own "install into this app" generator, run AFTER the package is
 * added — the idiomatic way to scaffold the config an SDK ships a generator for.
 * Only frameworks whose generator is reachable immediately after the package
 * install qualify: Rails (auto-loaded Railtie) and Laravel (auto-discovered
 * service provider). Django's `manage.py shipeasy_install` needs the app in
 * INSTALLED_APPS first — a bootstrap it can't do itself — so it stays in the
 * wiring instructions. Guarded on a real framework signal file so a mis-tagged
 * target (the scanner assumes rails/laravel) never runs a bogus command.
 */
export function frameworkSetupArgv(
  language: string,
  frameworks: string[],
  root: string,
): string[] | null {
  if (
    language === "ruby" &&
    frameworks.includes("rails") &&
    (existsSync(join(root, "bin", "rails")) || existsSync(join(root, "config", "application.rb")))
  ) {
    return ["bundle", "exec", "rails", "generate", "shipeasy:install"];
  }
  if (language === "php" && frameworks.includes("laravel") && existsSync(join(root, "artisan"))) {
    return ["php", "artisan", "shipeasy:install"];
  }
  return null;
}

export interface InstallOutcome {
  /** ran = we executed it; deferred = left for the wiring instructions. */
  status: "ran" | "failed" | "deferred";
  cmd: string;
  /** The framework generator run after a successful package install, if any. */
  frameworkStep?: { status: "ran" | "failed"; cmd: string };
}

/**
 * npm's strict peer resolver (v7+) aborts the whole install with `ERESOLVE` when
 * anything ALREADY in the tree has an unsatisfiable peer — a pre-existing
 * conflict between the app's own packages, nothing to do with the SDK we're
 * adding (`@shipeasy/sdk`'s only peers are optional). That must not be where
 * onboarding stops, so npm installs get one retry with the escape hatch npm
 * itself suggests. Only npm has this failure mode: pnpm/yarn/bun warn instead of
 * failing, so they get no retry argv.
 */
export function peerConflictRetryArgv(argv: string[]): string[] | null {
  return argv[0] === "npm" ? [...argv, "--legacy-peer-deps"] : null;
}

/**
 * Run one package install in `cwd`, streaming its output, with npm's
 * ERESOLVE retry. Returns the argv that actually succeeded (or the last one
 * tried) so callers report the command the user can re-run themselves.
 */
function runInstallArgv(argv: string[], cwd: string): { ok: boolean; argv: string[] } {
  let res = spawnSync(argv[0]!, argv.slice(1), { cwd, stdio: "inherit" });
  const retry = res.status !== 0 ? peerConflictRetryArgv(argv) : null;
  if (retry) {
    console.log(`\n  install failed — retrying: ${retry.join(" ")}`);
    res = spawnSync(retry[0]!, retry.slice(1), { cwd, stdio: "inherit" });
    if (res.status === 0) return { ok: true, argv: retry };
  }
  return { ok: res.status === 0, argv };
}

/** Run the SDK install in the target dir (streaming output to the terminal),
 *  then the framework's own generator (rails/laravel) when it ships one. */
export function runSdkInstall(target: TargetRecommendation): InstallOutcome {
  const initial = installArgv(target.language, target.package_manager, target.frameworks);
  const fallback = target.recommendation.install ?? "(see wiring instructions)";
  if (!initial || !onPath(initial[0]!)) return { status: "deferred", cmd: fallback };

  const { ok, argv } = runInstallArgv(initial, target.path);
  if (!ok) return { status: "failed", cmd: argv.join(" ") };

  // Package recorded — run the framework's own generator if it ships one and its
  // tool is available. Best-effort: a failure here doesn't fail the install (the
  // wiring instructions still cover finishing it).
  const fw = frameworkSetupArgv(target.language, target.frameworks, target.path);
  if (fw && onPath(fw[0]!)) {
    const fwRes = spawnSync(fw[0]!, fw.slice(1), { cwd: target.path, stdio: "inherit" });
    return {
      status: "ran",
      cmd: argv.join(" "),
      frameworkStep: { status: fwRes.status === 0 ? "ran" : "failed", cmd: fw.join(" ") },
    };
  }
  return { status: "ran", cmd: argv.join(" ") };
}

// ── React Native devtools overlay ────────────────────────────────────────────

/**
 * The RN devtools overlay ships as its OWN package, deliberately not part of
 * `@shipeasy/sdk` — an app that only reads flags never pulls a UI toolchain
 * into its bundle. So unlike the browser overlay (a `<script>` tag, nothing to
 * install) the native one needs a real install before it can be mounted.
 */
export const RN_DEVTOOLS_PACKAGE = "@shipeasy/react-native-devtools";

/** Required peers — the form stack the bug/feature forms validate against. */
const RN_DEVTOOLS_REQUIRED_PEERS = ["react-hook-form", "@hookform/resolvers", "zod"];

/**
 * Optional peers, each degrading gracefully when absent (shake-to-open, the
 * login browser round-trip, session persistence, screenshots, menu icons).
 * They are expo modules, so they go through `expo install`, which resolves the
 * version matching the app's Expo SDK — a plain `npm install` of these is how
 * you break a native build.
 */
const RN_DEVTOOLS_EXPO_PEERS = [
  "expo-web-browser",
  "expo-crypto",
  "expo-secure-store",
  "expo-sensors",
  "expo-image-picker",
  "react-native-view-shot",
  "react-native-svg",
  // Window insets for the overlay's bottom sheet — without it the sheet pads
  // itself with a constant instead of the device's real home-indicator inset.
  "react-native-safe-area-context",
];

export interface RnDevtoolsInstallPlan {
  /** Overlay + required peers — any JS package manager can run this. */
  main: string[];
  /** Optional expo-module peers; null for a bare React Native app. */
  expoPeers: string[] | null;
}

export function rnDevtoolsInstallArgv(
  packageManager: string,
  frameworks: string[],
): RnDevtoolsInstallPlan {
  const mgr = packageManager && packageManager !== "unknown" ? packageManager : "npm";
  const verb = mgr === "npm" ? "install" : "add";
  return {
    main: [mgr, verb, RN_DEVTOOLS_PACKAGE, ...RN_DEVTOOLS_REQUIRED_PEERS],
    expoPeers: frameworks.includes("expo")
      ? ["npx", "expo", "install", ...RN_DEVTOOLS_EXPO_PEERS]
      : null,
  };
}

/** Install the overlay in a React Native target, then its optional expo peers
 *  (reported as the `frameworkStep`, exactly like a rails/laravel generator). */
export function runRnDevtoolsInstall(target: TargetRecommendation): InstallOutcome {
  const plan = rnDevtoolsInstallArgv(target.package_manager, target.frameworks);
  if (!onPath(plan.main[0]!)) return { status: "deferred", cmd: plan.main.join(" ") };

  const { ok, argv } = runInstallArgv(plan.main, target.path);
  if (!ok) return { status: "failed", cmd: argv.join(" ") };

  if (plan.expoPeers && onPath(plan.expoPeers[0]!)) {
    const res = spawnSync(plan.expoPeers[0]!, plan.expoPeers.slice(1), {
      cwd: target.path,
      stdio: "inherit",
    });
    return {
      status: "ran",
      cmd: argv.join(" "),
      frameworkStep: {
        status: res.status === 0 ? "ran" : "failed",
        cmd: plan.expoPeers.join(" "),
      },
    };
  }
  return { status: "ran", cmd: argv.join(" ") };
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
