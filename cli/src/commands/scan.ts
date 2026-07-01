import fs from "node:fs";
import path from "node:path";
import { detect } from "package-manager-detector";

// ── types ──────────────────────────────────────────────────────────────────

interface ShipeasySdkState {
  installed: boolean;
  version: string | null;
  configured: boolean;
  subentry?: string;
  profile?: string;
}

interface LoaderScriptState {
  present: boolean;
  data_key?: string;
  data_profile?: string;
}

interface ProjectInfo {
  path: string;
  language: string;
  frameworks: string[];
  package_manager: string;
  entry_points: string[];
  shipeasy: {
    experimentation_sdk: ShipeasySdkState;
    i18n_sdk: ShipeasySdkState;
    loader_script_tag: LoaderScriptState;
    env_keys_detected: string[];
    template_warning?: string;
  };
}

interface ClarificationNeeded {
  status: "needs_clarification";
  reason: string;
  question: string;
  detected_subdirs?: string[];
}

interface DetectResult {
  status: "ok";
  projects: ProjectInfo[];
}

// ── helpers ────────────────────────────────────────────────────────────────

function safeReadFile(filePath: string, root: string): string | null {
  try {
    const real = fs.realpathSync(filePath);
    if (!real.startsWith(root + path.sep) && real !== root) return null;
    return fs.readFileSync(real, "utf8");
  } catch {
    return null;
  }
}

function resolveRoot(inputPath?: string): string {
  const target = inputPath ? path.resolve(inputPath) : process.cwd();
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

function isAmbiguous(info: Omit<ProjectInfo, "path">): boolean {
  if (!["typescript", "javascript", "unknown"].includes(info.language)) return false;
  return info.frameworks.length === 0 && info.entry_points.length === 0;
}

function findProjectSubdirs(root: string): string[] {
  const PROJECT_SIGNALS = ["package.json", "Gemfile", "go.mod", "pyproject.toml", "composer.json"];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
    .map((e) => path.join(root, e.name))
    .filter((dir) => PROJECT_SIGNALS.some((sig) => fs.existsSync(path.join(dir, sig))));
}

// ── JS/TS detection ────────────────────────────────────────────────────────

async function detectFromPackageJson(
  root: string,
): Promise<Omit<ProjectInfo, "path" | "shipeasy"> & { allDeps: Record<string, string> }> {
  const raw = safeReadFile(path.join(root, "package.json"), root);
  if (!raw)
    return {
      language: "unknown",
      frameworks: [],
      package_manager: "unknown",
      entry_points: [],
      allDeps: {},
    };

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {
      language: "unknown",
      frameworks: [],
      package_manager: "unknown",
      entry_points: [],
      allDeps: {},
    };
  }

  const deps: Record<string, string> = {
    ...((pkg.dependencies as Record<string, string>) ?? {}),
    ...((pkg.devDependencies as Record<string, string>) ?? {}),
    ...((pkg.peerDependencies as Record<string, string>) ?? {}),
  };

  const language = "typescript" in deps ? "typescript" : "javascript";
  const pmDetected = await detect({ cwd: root });
  const package_manager = pmDetected?.name ?? "npm";

  const FRAMEWORK_SIGNALS: Array<[string, string]> = [
    ["next", "nextjs"],
    ["react", "react"],
    ["react-dom", "react"],
    ["vue", "vue"],
    ["nuxt", "nuxt"],
    ["svelte", "svelte"],
    ["@sveltejs/kit", "sveltekit"],
    ["@angular/core", "angular"],
    ["remix", "remix"],
    ["@remix-run/react", "remix"],
    ["tailwindcss", "tailwind"],
    ["@tanstack/react-query", "tanstack-query"],
    ["express", "express"],
    ["fastify", "fastify"],
    ["hono", "hono"],
    ["drizzle-orm", "drizzle"],
    ["prisma", "prisma"],
  ];

  const frameworks = Array.from(
    new Set(FRAMEWORK_SIGNALS.filter(([dep]) => dep in deps).map(([, label]) => label)),
  );

  const ENTRY_CANDIDATES = [
    "src/app/layout.tsx",
    "src/app/layout.ts",
    "src/main.tsx",
    "src/main.ts",
    "src/index.tsx",
    "src/index.ts",
    "app/layout.tsx",
    "pages/_app.tsx",
    "pages/_document.tsx",
    "index.ts",
    "index.js",
  ];
  const entry_points = ENTRY_CANDIDATES.filter((f) => fs.existsSync(path.join(root, f)));

  return { language, frameworks, package_manager, entry_points, allDeps: deps };
}

// ── Shipeasy SDK analysis ──────────────────────────────────────────────────

function searchInDir(dir: string, pattern: RegExp, root: string, maxDepth: number): string | null {
  if (maxDepth <= 0) return null;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = searchInDir(full, pattern, root, maxDepth - 1);
      if (hit) return hit;
    } else if (entry.isFile() && /\.[jt]sx?$/.test(entry.name)) {
      const content = safeReadFile(full, root);
      if (!content) continue;
      const m = pattern.exec(content);
      if (m) return m[1] ?? "true";
    }
  }
  return null;
}

function detectShipeasyExp(deps: Record<string, string>, root: string): ShipeasySdkState {
  const version = deps["shipeasy"] ?? null;
  if (!version) return { installed: false, version: null, configured: false };

  const envFiles = [".env", ".env.local", ".env.production", ".env.development"];
  const envKeys = new Set<string>();
  for (const f of envFiles) {
    const content = safeReadFile(path.join(root, f), root);
    if (!content) continue;
    for (const line of content.split("\n")) {
      const [key] = line.split("=");
      if (key?.trim()) envKeys.add(key.trim());
    }
  }
  const configured = envKeys.has("SHIPEASY_SERVER_KEY");

  const subentryPattern = /from ['"]shipeasy\/(react|vue|svelte|angular)['"]/;
  let subentry: string | undefined;
  for (const entry of ["src/", "app/", "pages/"]) {
    const dir = path.join(root, entry);
    if (!fs.existsSync(dir)) continue;
    const found = searchInDir(dir, subentryPattern, root, 3);
    if (found) {
      subentry = `shipeasy/${found}`;
      break;
    }
  }

  return { installed: true, version, configured, ...(subentry ? { subentry } : {}) };
}

function detectShipeasyI18n(deps: Record<string, string>, root: string): ShipeasySdkState {
  const version = deps["shipeasy"] ?? null;
  if (!version) return { installed: false, version: null, configured: false };

  const envFiles = [".env", ".env.local", ".env.production", ".env.development"];
  const envKeys = new Set<string>();
  for (const f of envFiles) {
    const content = safeReadFile(path.join(root, f), root);
    if (!content) continue;
    for (const line of content.split("\n")) {
      const [key] = line.split("=");
      if (key?.trim()) envKeys.add(key.trim());
    }
  }
  const configured =
    envKeys.has("NEXT_PUBLIC_SHIPEASY_CLIENT_KEY") || envKeys.has("SHIPEASY_CLIENT_KEY");

  let profile: string | undefined;
  const profilePattern = /data-profile=["']([a-z]{2,5}:[a-z]+)['"]/;
  const layoutFiles = [
    "src/app/layout.tsx",
    "src/app/layout.ts",
    "pages/_document.tsx",
    "index.html",
    "app/views/layouts/application.html.erb",
  ];
  for (const f of layoutFiles) {
    const content = safeReadFile(path.join(root, f), root);
    if (!content) continue;
    const m = profilePattern.exec(content);
    if (m) {
      profile = m[1];
      break;
    }
  }

  return { installed: true, version, configured, ...(profile ? { profile } : {}) };
}

function detectLoaderScript(root: string): LoaderScriptState {
  const LAYOUT_CANDIDATES = [
    "src/app/layout.tsx",
    "src/app/layout.ts",
    "pages/_document.tsx",
    "index.html",
    "app/views/layouts/application.html.erb",
    "templates/base.html",
  ];

  for (const f of LAYOUT_CANDIDATES) {
    const content = safeReadFile(path.join(root, f), root);
    if (!content || !content.includes("loader.js")) continue;

    const keyMatch = /data-key=["']([^"']+)["']/.exec(content);
    const profileMatch = /data-profile=["']([^"']+)["']/.exec(content);
    return {
      present: true,
      ...(keyMatch ? { data_key: keyMatch[1] } : {}),
      ...(profileMatch ? { data_profile: profileMatch[1] } : {}),
    };
  }
  return { present: false };
}

function detectEnvKeys(root: string): string[] {
  const INTERESTING = [
    "SHIPEASY_SERVER_KEY",
    "SHIPEASY_CLIENT_KEY",
    "NEXT_PUBLIC_SHIPEASY_CLIENT_KEY",
  ];
  const envFiles = [".env", ".env.local", ".env.production", ".env.development"];
  const found = new Set<string>();
  for (const f of envFiles) {
    const content = safeReadFile(path.join(root, f), root);
    if (!content) continue;
    for (const line of content.split("\n")) {
      const key = line.split("=")[0]?.trim() ?? "";
      if (INTERESTING.includes(key)) found.add(key);
    }
  }
  return Array.from(found);
}

function detectNonJs(
  root: string,
): { language: string; package_manager: string; frameworks: string[] } | null {
  if (fs.existsSync(path.join(root, "go.mod"))) {
    return { language: "go", package_manager: "go", frameworks: [] };
  }
  if (
    fs.existsSync(path.join(root, "pyproject.toml")) ||
    fs.existsSync(path.join(root, "setup.py")) ||
    fs.existsSync(path.join(root, "requirements.txt"))
  ) {
    const pm = fs.existsSync(path.join(root, "pyproject.toml")) ? "poetry" : "pip";
    const frameworks: string[] = [];
    const req = safeReadFile(path.join(root, "requirements.txt"), root) ?? "";
    const pyproject = safeReadFile(path.join(root, "pyproject.toml"), root) ?? "";
    const combined = req + pyproject;
    if (/django/i.test(combined)) frameworks.push("django");
    if (/flask/i.test(combined)) frameworks.push("flask");
    if (/fastapi/i.test(combined)) frameworks.push("fastapi");
    return { language: "python", package_manager: pm, frameworks };
  }
  if (fs.existsSync(path.join(root, "Gemfile"))) {
    return { language: "ruby", package_manager: "bundler", frameworks: ["rails"] };
  }
  if (fs.existsSync(path.join(root, "composer.json"))) {
    return { language: "php", package_manager: "composer", frameworks: ["laravel"] };
  }
  if (fs.existsSync(path.join(root, "pom.xml"))) {
    return { language: "java", package_manager: "maven", frameworks: [] };
  }
  // Kotlin DSL (`build.gradle.kts`) → Kotlin SDK; plain Groovy `build.gradle` → Java.
  if (fs.existsSync(path.join(root, "build.gradle.kts"))) {
    return { language: "kotlin", package_manager: "gradle", frameworks: [] };
  }
  if (fs.existsSync(path.join(root, "build.gradle"))) {
    return { language: "java", package_manager: "gradle", frameworks: [] };
  }
  if (fs.existsSync(path.join(root, "Package.swift"))) {
    return { language: "swift", package_manager: "swiftpm", frameworks: [] };
  }
  return null;
}

// ── single-path inspection ─────────────────────────────────────────────────

async function inspectOne(
  root: string,
): Promise<Omit<ProjectInfo, "path"> & { allDeps: Record<string, string> }> {
  const nonJs = detectNonJs(root);
  const { language, frameworks, package_manager, entry_points, allDeps } = nonJs
    ? { ...nonJs, entry_points: [], allDeps: {} as Record<string, string> }
    : await detectFromPackageJson(root);

  return {
    language: language ?? "unknown",
    frameworks: frameworks ?? [],
    package_manager: package_manager ?? "unknown",
    entry_points: entry_points ?? [],
    allDeps,
    shipeasy: {
      experimentation_sdk: detectShipeasyExp(allDeps, root),
      i18n_sdk: detectShipeasyI18n(allDeps, root),
      loader_script_tag: detectLoaderScript(root),
      env_keys_detected: detectEnvKeys(root),
    },
  };
}

// ── core function (also used by MCP handler) ───────────────────────────────

export async function detectProject(
  inputPaths?: string | string[],
): Promise<DetectResult | ClarificationNeeded> {
  const paths: string[] = inputPaths
    ? Array.isArray(inputPaths)
      ? inputPaths
      : [inputPaths]
    : [process.cwd()];

  const roots = paths.map(resolveRoot);

  const results = await Promise.all(
    roots.map(async (root) => {
      const info = await inspectOne(root);
      const { allDeps: _, ...rest } = info;
      return { path: root, ...rest } as ProjectInfo;
    }),
  );

  if (paths.length === 1 && results.every(isAmbiguous)) {
    const subdirs = findProjectSubdirs(roots[0]!);
    return {
      status: "needs_clarification",
      reason:
        `Could not detect a recognizable project structure at "${roots[0]}". ` +
        `The directory appears to be a workspace root or monorepo manifest with no app code at the top level.`,
      question:
        subdirs.length > 0
          ? `Which of these subdirectories contains your app? Re-run with the full path(s):\n` +
            subdirs.map((d) => `  - ${d}`).join("\n")
          : `Please provide the full path to your app directory and re-run.`,
      ...(subdirs.length > 0 ? { detected_subdirs: subdirs } : {}),
    };
  }

  return { status: "ok", projects: results };
}

// ── recursive monorepo discovery + per-folder recommendations ──────────────
// This is the engine behind `shipeasy detect`: walk the tree, find every
// install target, and emit a per-folder recommendation the setup skill can act
// on without re-deriving the install command / secret store / docs handle.

const TARGET_MANIFESTS = [
  "package.json",
  "pyproject.toml",
  "setup.py",
  "requirements.txt",
  "Gemfile",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "composer.json",
  "Package.swift",
];
const PRUNE_DIRS = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  ".git",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
  "target",
  ".gradle",
]);

/** Walk `root` (default cwd), returning every directory that holds a known
 *  project manifest. Prunes vendor/build dirs; bounded by `maxDepth`. */
export function discoverTargets(root: string, maxDepth = 4): string[] {
  const found = new Set<string>();
  const walk = (dir: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && TARGET_MANIFESTS.includes(e.name))) found.add(dir);
    if (depth >= maxDepth) return;
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || PRUNE_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(resolveRoot(root), 0);
  return [...found].sort();
}

/** `docs` MCP `sdk` value per detected language (drives `shipeasy docs get`). */
const SDK_FOR_LANGUAGE: Record<string, string> = {
  typescript: "typescript",
  javascript: "typescript",
  python: "python",
  ruby: "ruby",
  go: "go",
  php: "php",
  java: "java",
  kotlin: "kotlin",
  swift: "swift",
};

const BROWSER_FRAMEWORKS = new Set([
  "nextjs",
  "react",
  "vue",
  "nuxt",
  "svelte",
  "sveltekit",
  "angular",
  "remix",
]);

function installHint(language: string, pm: string, frameworks: string[]): string {
  switch (language) {
    case "typescript":
    case "javascript": {
      const mgr = pm && pm !== "unknown" ? pm : "npm";
      const verb = mgr === "npm" ? "install" : "add"; // npm uses `install`, pnpm/yarn/bun use `add`
      const react = frameworks.includes("react") || frameworks.includes("nextjs");
      return `${mgr} ${verb} @shipeasy/sdk${react ? " @shipeasy/react" : ""}`;
    }
    case "python":
      return "pip install shipeasy (or add `shipeasy` to pyproject/requirements)";
    case "ruby":
      return 'add `gem "shipeasy-sdk"` then `bundle install`';
    case "go":
      return "go get github.com/shipeasy-ai/sdk-go";
    case "php":
      return "composer require shipeasy/shipeasy";
    case "java":
      return "add dependency `ai.shipeasy:shipeasy:<latest>` (Maven/Gradle)";
    case "kotlin":
      return 'implementation("ai.shipeasy:shipeasy-kotlin:<latest>")';
    case "swift":
      return "add SwiftPM package github.com/shipeasy-ai/sdk-swift";
    default:
      return "unsupported language — no Shipeasy SDK";
  }
}

function secretStoreHint(language: string, frameworks: string[], root: string): string {
  if (fs.existsSync(path.join(root, "wrangler.toml")) || fs.existsSync(path.join(root, "wrangler.jsonc")))
    return "wrangler secret put SHIPEASY_SERVER_KEY";
  if (frameworks.includes("rails") || language === "ruby")
    return "rails credentials:edit → shipeasy_server_key (or .env if using dotenv)";
  if (frameworks.includes("django")) return ".env via django-environ (or process env)";
  if (language === "java" || language === "kotlin")
    return "application.properties → ${SHIPEASY_SERVER_KEY} + process env";
  if (language === "php") return ".env (Laravel) or process env";
  if (language === "typescript" || language === "javascript") return "<dir>/.env.local (gitignored)";
  return "process env / .env (gitignored)";
}

export interface SkillRecommendation {
  /** `docs` MCP sdk value — `shipeasy docs get --sdk <sdk> installation`. */
  sdk: string | null;
  /** Whole-tree action: skip the workspace root, install, or already done. */
  action: "install" | "set_key" | "skip_workspace_root" | "skip_unsupported" | "already_onboarded";
  reason: string;
  install: string | null;
  keys: Array<"server" | "client">;
  secret_store: string | null;
  /** How to pull the version-correct install + wiring docs for this folder. */
  docs: string | null;
  /** Feature installs/skills that apply once the SDK is wired. */
  next_skills: string[];
}

export interface TargetRecommendation extends ProjectInfo {
  recommendation: SkillRecommendation;
}

function isWorkspaceRoot(root: string): boolean {
  if (fs.existsSync(path.join(root, "pnpm-workspace.yaml"))) return true;
  const raw = safeReadFile(path.join(root, "package.json"), root);
  if (!raw) return false;
  try {
    const pkg = JSON.parse(raw) as { workspaces?: unknown; dependencies?: object };
    const hasWorkspaces = Array.isArray(pkg.workspaces) || typeof pkg.workspaces === "object";
    const noAppDeps = !pkg.dependencies || Object.keys(pkg.dependencies).length === 0;
    return hasWorkspaces && noAppDeps;
  } catch {
    return false;
  }
}

function recommend(info: ProjectInfo, hasNestedTargets: boolean): SkillRecommendation {
  const sdk = SDK_FOR_LANGUAGE[info.language] ?? null;
  const featureSkills = [
    "shipeasy-flags-install",
    "shipeasy-ops-install",
    "shipeasy-i18n-install",
  ];

  if (!sdk) {
    return {
      sdk: null,
      action: "skip_unsupported",
      reason: `No Shipeasy SDK for language "${info.language}".`,
      install: null,
      keys: [],
      secret_store: null,
      docs: null,
      next_skills: [],
    };
  }

  // A JS workspace root that only declares workspaces (no app deps) and has real
  // targets beneath it: don't install the SDK here — bind .shipeasy and move on.
  if (
    hasNestedTargets &&
    (info.language === "typescript" || info.language === "javascript") &&
    !info.shipeasy.experimentation_sdk.installed &&
    isWorkspaceRoot(info.path)
  ) {
    return {
      sdk,
      action: "skip_workspace_root",
      reason: "Workspace root (declares workspaces, no app deps) — install in the subprojects instead.",
      install: null,
      keys: [],
      secret_store: null,
      docs: null,
      next_skills: [],
    };
  }

  const needsClient = info.frameworks.some((f) => BROWSER_FRAMEWORKS.has(f));
  const keys: Array<"server" | "client"> = needsClient ? ["server", "client"] : ["server"];
  const docs = `shipeasy docs get --sdk ${sdk} installation`;

  if (info.shipeasy.experimentation_sdk.installed) {
    const configured = info.shipeasy.experimentation_sdk.configured;
    return {
      sdk,
      action: configured ? "already_onboarded" : "set_key",
      reason: configured
        ? "SDK installed and SHIPEASY_SERVER_KEY present — already onboarded."
        : "SDK installed but no SHIPEASY_SERVER_KEY detected — mint a key and persist it.",
      install: null,
      keys: configured ? [] : keys,
      secret_store: configured ? null : secretStoreHint(info.language, info.frameworks, info.path),
      docs,
      next_skills: featureSkills,
    };
  }

  return {
    sdk,
    action: "install",
    reason: "No Shipeasy SDK installed — install it, mint keys, wire the entry point.",
    install: installHint(info.language, info.package_manager, info.frameworks),
    keys,
    secret_store: secretStoreHint(info.language, info.frameworks, info.path),
    docs,
    next_skills: featureSkills,
  };
}

export interface DetectTargetsResult {
  status: "ok";
  root: string;
  targets: TargetRecommendation[];
}

/** Recursive, recommendation-emitting detection — the `shipeasy detect` engine.
 *  Walks the tree under each given path (or the cwd) and unions the targets. */
export async function detectTargets(inputPaths?: string[]): Promise<DetectTargetsResult> {
  const roots =
    inputPaths && inputPaths.length > 0 ? inputPaths.map(resolveRoot) : [resolveRoot()];
  const dirSet = new Set<string>();
  for (const r of roots) for (const d of discoverTargets(r)) dirSet.add(d);
  const dirs = [...dirSet].sort();
  const root = roots[0]!;

  const targets: TargetRecommendation[] = [];
  for (const dir of dirs) {
    const info = await inspectOne(dir);
    const { allDeps: _drop, ...rest } = info;
    const project: ProjectInfo = { path: dir, ...rest };
    const hasNested = dirs.some((d) => d !== dir && d.startsWith(dir + path.sep));
    targets.push({ ...project, recommendation: recommend(project, hasNested) });
  }

  return { status: "ok", root, targets };
}

