import fs from "node:fs";
import path from "node:path";
import { detect } from "package-manager-detector";
import type { Command } from "commander";

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
  if (fs.existsSync(path.join(root, "build.gradle"))) {
    return { language: "java", package_manager: "gradle", frameworks: [] };
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

// ── CLI command wiring ─────────────────────────────────────────────────────

function printHuman(result: DetectResult | ClarificationNeeded): void {
  if (result.status === "needs_clarification") {
    console.error(`⚠  ${result.reason}`);
    console.error(`\n${result.question}`);
    return;
  }

  for (const project of result.projects) {
    console.log(`\nPath:            ${project.path}`);
    console.log(`Language:        ${project.language}`);
    console.log(`Frameworks:      ${project.frameworks.join(", ") || "—"}`);
    console.log(`Package manager: ${project.package_manager}`);
    if (project.entry_points.length) {
      console.log(`Entry points:    ${project.entry_points.join(", ")}`);
    }

    const exp = project.shipeasy.experimentation_sdk;
    console.log(`\nExperimentation SDK:`);
    console.log(`  installed:  ${exp.installed}${exp.version ? ` (${exp.version})` : ""}`);
    if (exp.installed) console.log(`  configured: ${exp.configured}`);
    if (exp.subentry) console.log(`  subentry:   ${exp.subentry}`);

    const i18n = project.shipeasy.i18n_sdk;
    console.log(`\ni18n SDK:`);
    console.log(`  installed:  ${i18n.installed}${i18n.version ? ` (${i18n.version})` : ""}`);
    if (i18n.installed) console.log(`  configured: ${i18n.configured}`);
    if (i18n.profile) console.log(`  profile:    ${i18n.profile}`);

    const loader = project.shipeasy.loader_script_tag;
    console.log(`\nLoader script:   ${loader.present ? "present" : "not found"}`);
    if (loader.data_key) console.log(`  data-key:     ${loader.data_key}`);
    if (loader.data_profile) console.log(`  data-profile: ${loader.data_profile}`);

    if (project.shipeasy.env_keys_detected.length) {
      console.log(`\nEnv keys found:  ${project.shipeasy.env_keys_detected.join(", ")}`);
    }
  }
}

export function scanCommand(program: Command): void {
  program
    .command("scan [paths...]")
    .description("Detect project language, framework, and ShipEasy SDK state")
    .option("--json", "Output raw JSON")
    .action(async (paths: string[], opts: { json?: boolean }) => {
      const result = await detectProject(paths.length ? paths : undefined);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printHuman(result);
      }

      if (result.status === "needs_clarification") process.exit(1);
    });
}
