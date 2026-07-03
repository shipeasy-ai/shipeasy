/**
 * Build the isolated sandbox a headless `claude -p` run executes in:
 *
 *   <workdir>/
 *     .shipeasy                     project binding (mutating tools require it)
 *     .claude/skills/<name>/…       a copy of every shipped skill so `-p` can
 *                                   auto-discover + route to them
 *     .xdg/shipeasy/config.json     MCP session pointing at the LOCAL backend
 *     mcp-config.json               --mcp-config for the run
 *
 * Everything is scoped under `workdir` and an isolated `XDG_CONFIG_HOME`, so the
 * harness never reads or clobbers your real `~/.config/shipeasy` prod session.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { SKILLS_DIR, MCP_SERVER_NAME } from "./catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** …/marketplace/mcp — the local MCP build we point the run at by default. */
const MCP_PKG = resolve(__dirname, "../../mcp");
/** Repo root, for resolving the default example app. */
const REPO_ROOT = resolve(__dirname, "../../..");
/**
 * Default sandbox app: a generated SDK example (real code the agent can read so
 * "A/B test the checkout button" doesn't stall for lack of a codebase). Override
 * with SHIPEASY_EVAL_APP_DIR. Empty string → bare sandbox (no app).
 */
const DEFAULT_APP_DIR = resolve(REPO_ROOT, "packages/server-sdks/sdk-ts/examples/guide");
/** Never copy these into the sandbox (huge / irrelevant). */
const SKIP_COPY = /(^|\/)(node_modules|\.next|\.git|dist|\.turbo|coverage)(\/|$)|\.tsbuildinfo$/;

export interface EnvConfig {
  /** Admin SDK key minted against the local backend (X-SDK-Key). */
  token: string;
  projectId: string;
  /** Local admin API base, e.g. http://localhost:3100 (apps/ui dev server). */
  baseUrl: string;
  /** Override the MCP launch command (default: local `marketplace/mcp` build). */
  mcpCommand?: string;
  mcpArgs?: string[];
  /**
   * Example app whose source is copied into the sandbox as read material.
   * Absolute path; "" for a bare sandbox. Defaults to the sdk-ts guide example.
   */
  appDir?: string;
}

export interface PreparedEnv {
  workdir: string;
  mcpConfigPath: string;
  xdgHome: string;
  /** The example app copied in, or "" if none. */
  appDir: string;
}

export function readEnvConfigFromEnv(): EnvConfig {
  const token = req("SHIPEASY_EVAL_TOKEN");
  const projectId = req("SHIPEASY_EVAL_PROJECT_ID");
  const baseUrl = process.env.SHIPEASY_EVAL_BASE_URL ?? "http://localhost:3100";
  const appDir = process.env.SHIPEASY_EVAL_APP_DIR ?? DEFAULT_APP_DIR;
  return { token, projectId, baseUrl, appDir };
}

export function prepareEnv(cfg: EnvConfig, workdir: string): PreparedEnv {
  rmSync(workdir, { recursive: true, force: true });
  mkdirSync(workdir, { recursive: true });

  // 0. Copy the example app in first, so the agent has real code to read
  //    (skipping node_modules/build dirs). Overlays below sit alongside it.
  const appDir = cfg.appDir ?? DEFAULT_APP_DIR;
  if (appDir && existsSync(appDir)) {
    cpSync(appDir, workdir, {
      recursive: true,
      filter: (src) => !SKIP_COPY.test(src.slice(appDir.length)),
    });
  }

  // 1. Project binding — unblocks mutating tools (the GENERATED_MUTATES guard).
  writeFileSync(
    join(workdir, ".shipeasy"),
    JSON.stringify({ schema_version: 1, project_id: cfg.projectId }, null, 2) + "\n",
  );

  // 2. Skills — copy each shipped skill so headless `-p` can discover + route.
  const skillsDest = join(workdir, ".claude", "skills");
  mkdirSync(skillsDest, { recursive: true });
  for (const name of readdirSync(SKILLS_DIR)) {
    const src = join(SKILLS_DIR, name);
    try {
      cpSync(src, join(skillsDest, name), { recursive: true });
    } catch {
      /* not a directory — skip */
    }
  }

  // 3. Isolated MCP session → LOCAL backend. `getGeneratedClient()` reads
  //    `app_base_url` from this file (NOT the hardcoded prod constant), so this
  //    is the whole local-override mechanism. The SHIPEASY_CLI_TOKEN env path is
  //    deliberately avoided — it forces prod URLs.
  const xdgHome = join(workdir, ".xdg");
  const cfgDir = join(xdgHome, "shipeasy");
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(
    join(cfgDir, "config.json"),
    JSON.stringify(
      {
        project_id: cfg.projectId,
        cli_token: cfg.token,
        api_base_url: cfg.baseUrl,
        app_base_url: cfg.baseUrl,
        user_email: "skills-eval@local",
        created_at: "1970-01-01T00:00:00.000Z",
      },
      null,
      2,
    ) + "\n",
  );

  // 4. MCP config for the run — the spawned server inherits the isolated XDG.
  const mcpConfigPath = join(workdir, "mcp-config.json");
  writeFileSync(
    mcpConfigPath,
    JSON.stringify(
      {
        mcpServers: {
          [MCP_SERVER_NAME]: {
            command: cfg.mcpCommand ?? "node",
            args: cfg.mcpArgs ?? [join(MCP_PKG, "bin", "mcp.js")],
            env: { XDG_CONFIG_HOME: xdgHome },
          },
        },
      },
      null,
      2,
    ) + "\n",
  );

  return { workdir, mcpConfigPath, xdgHome, appDir: appDir && existsSync(appDir) ? appDir : "" };
}

function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `Missing env ${name}. See marketplace/skills-eval/README.md → "Point it at local dev".`,
    );
  }
  return v;
}
