import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { cliUpdateArgv, resolveScope, sdkUpdateArgv } from "../commands/upgrade";
import { buildProgram } from "../index";
import type { TargetRecommendation } from "../commands/scan";

/** Build a minimal TargetRecommendation for the argv derivation under test. */
function target(over: Partial<TargetRecommendation>): TargetRecommendation {
  return {
    path: "/repo",
    language: "typescript",
    frameworks: [],
    package_manager: "npm",
    entry_points: [],
    shipeasy: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      experimentation_sdk: "absent" as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      i18n_sdk: "absent" as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loader_script_tag: "absent" as any,
      env_keys_detected: [],
    },
    recommendation: {
      sdk: "typescript",
      action: "already_onboarded",
      reason: "",
      install: null,
      keys: [],
      secret_store: null,
      docs: null,
      next_skills: [],
    },
    ...over,
  } as TargetRecommendation;
}

describe("cliUpdateArgv", () => {
  it("targets @shipeasy/cli@latest globally per package manager", () => {
    expect(cliUpdateArgv("npm")).toEqual(["npm", "install", "-g", "@shipeasy/cli@latest"]);
    expect(cliUpdateArgv("pnpm")).toEqual(["pnpm", "add", "-g", "@shipeasy/cli@latest"]);
    expect(cliUpdateArgv("yarn")).toEqual(["yarn", "global", "add", "@shipeasy/cli@latest"]);
    expect(cliUpdateArgv("bun")).toEqual(["bun", "add", "-g", "@shipeasy/cli@latest"]);
  });
});

describe("sdkUpdateArgv", () => {
  it("uses install for npm and add for other JS managers, with @latest", () => {
    expect(sdkUpdateArgv(target({ package_manager: "npm" }))).toEqual([
      "npm",
      "install",
      "@shipeasy/sdk@latest",
    ]);
    expect(sdkUpdateArgv(target({ package_manager: "pnpm" }))).toEqual([
      "pnpm",
      "add",
      "@shipeasy/sdk@latest",
    ]);
  });

  it("installs only @shipeasy/sdk@latest for react/next targets (no separate react pkg)", () => {
    expect(sdkUpdateArgv(target({ package_manager: "npm", frameworks: ["nextjs"] }))).toEqual([
      "npm",
      "install",
      "@shipeasy/sdk@latest",
    ]);
  });

  it("maps ruby/go/php to their update verbs", () => {
    expect(sdkUpdateArgv(target({ language: "ruby" }))).toEqual([
      "bundle",
      "update",
      "shipeasy-sdk",
    ]);
    expect(sdkUpdateArgv(target({ language: "go" }))).toEqual([
      "go",
      "get",
      "github.com/shipeasy-ai/sdk-go@latest",
    ]);
    expect(sdkUpdateArgv(target({ language: "php" }))).toEqual([
      "composer",
      "update",
      "shipeasy/shipeasy",
    ]);
  });

  it("handles python managers and defers bare pip", () => {
    expect(sdkUpdateArgv(target({ language: "python", package_manager: "uv" }))).toEqual([
      "uv",
      "add",
      "--upgrade",
      "shipeasy",
    ]);
    expect(sdkUpdateArgv(target({ language: "python", package_manager: "poetry", frameworks: ["django"] }))).toEqual([
      "poetry",
      "add",
      "shipeasy[django]@latest",
    ]);
    expect(sdkUpdateArgv(target({ language: "python", package_manager: "pip" }))).toBeNull();
  });

  it("returns null for languages with no safe auto-run", () => {
    expect(sdkUpdateArgv(target({ language: "java" }))).toBeNull();
    expect(sdkUpdateArgv(target({ language: "swift" }))).toBeNull();
  });
});

describe("option flow (regression: --dry-run must reach the action)", () => {
  /** Find a command by its path, replace its action with a capture, parse, and
   *  return the merged options the handler would see. */
  async function optsFor(path: string[], argv: string[]): Promise<Record<string, unknown>> {
    const program = buildProgram();
    let cmd: Command | undefined = program;
    for (const name of path) cmd = cmd?.commands.find((c) => c.name() === name);
    if (!cmd) throw new Error(`no command ${path.join(" ")}`);
    let captured: Record<string, unknown> = {};
    // Mirror the real handlers: read optsWithGlobals, not the bare first arg.
    cmd.action((_o: unknown, c: Command) => {
      captured = c.optsWithGlobals();
    });
    await program.parseAsync(["node", "shipeasy", ...path, ...argv]);
    return captured;
  }

  it("delivers --dry-run to `upgrade`", async () => {
    expect((await optsFor(["upgrade"], ["--dry-run"])).dryRun).toBe(true);
  });

  it("delivers --dry-run + value flags to `upgrade skills` (the shared-flag bug)", async () => {
    const opts = await optsFor(["upgrade", "skills"], ["--dry-run", "--agents", "claude", "--scope", "user"]);
    expect(opts.dryRun).toBe(true);
    expect(opts.agents).toBe("claude");
    expect(opts.scope).toBe("user");
  });
});

describe("resolveScope", () => {
  it("honours an explicit --scope", () => {
    expect(resolveScope({ scope: "user" }, "/nope")).toBe("user");
    expect(resolveScope({ scope: "project" }, "/nope")).toBe("project");
  });

  it("throws on an invalid --scope", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => resolveScope({ scope: "global" as any }, "/nope")).toThrow(/Invalid --scope/);
  });

  it("infers project scope from an in-repo signal, else user", () => {
    const dir = mkdtempSync(join(tmpdir(), "se-scope-"));
    try {
      expect(resolveScope({}, dir)).toBe("user"); // empty dir → global
      writeFileSync(join(dir, ".shipeasy"), "{}");
      expect(resolveScope({}, dir)).toBe("project"); // bound → in-repo
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("treats an in-repo .claude/skills dir as a project signal", () => {
    const dir = mkdtempSync(join(tmpdir(), "se-scope-"));
    try {
      mkdirSync(join(dir, ".claude", "skills"), { recursive: true });
      expect(resolveScope({}, dir)).toBe("project");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
