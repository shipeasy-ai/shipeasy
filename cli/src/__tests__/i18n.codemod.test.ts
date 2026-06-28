import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveTargets } from "../commands/codemod";

/**
 * Codemod is a CLI-strict FS/AST command. Two layers under test:
 *  1. `resolveTargets` — the target-directory resolution logic in the command.
 *  2. the shipped `codemods/runner.mjs` pipeline — run end-to-end on a fixture.
 */
const CODEMODS = resolve(__dirname, "../../codemods");
const importMjs = (rel: string) => import(pathToFileURL(join(CODEMODS, rel)).href);

describe("i18n codemod · resolveTargets", () => {
  let dir: string;
  let prevCwd: string;
  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "se-codemod-")));
    mkdirSync(join(dir, "app"));
    mkdirSync(join(dir, "components"));
    prevCwd = process.cwd();
    process.chdir(dir);
  });
  afterAll(() => {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it("honours an explicit target", () => {
    expect(resolveTargets("app", "src")).toEqual([resolve(dir, "app")]);
  });

  it("uses the configured srcDir when it exists", () => {
    mkdirSync(join(dir, "src"));
    expect(resolveTargets(undefined, "src")).toEqual([resolve(dir, "src")]);
    rmSync(join(dir, "src"), { recursive: true });
  });

  it("auto-detects common layouts when no src/ or explicit target", () => {
    const targets = resolveTargets(undefined, "src");
    expect(targets).toEqual(
      expect.arrayContaining([resolve(dir, "app"), resolve(dir, "components")]),
    );
  });
});

describe("i18n codemod · runner pipeline", () => {
  let dir: string;
  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "se-codemod-run-")));
    writeFileSync(
      join(dir, "Hero.tsx"),
      [
        `export function Hero() {`,
        `  return <h1>Welcome to our store</h1>;`,
        `}`,
      ].join("\n"),
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("scans files in dry-run without writing", async () => {
    const { loadConfig } = await importMjs("lib/config-schema.mjs");
    const { run } = await importMjs("runner.mjs");
    const before = readFileSync(join(dir, "Hero.tsx"), "utf8");
    const result = await run(loadConfig(null), { target: dir, dryRun: true, type: null, migrate: null });
    expect(result.filesScanned).toBeGreaterThan(0);
    // dry-run leaves the source untouched
    expect(readFileSync(join(dir, "Hero.tsx"), "utf8")).toBe(before);
  });

  it("wraps translatable strings with t() when run for real", async () => {
    const { loadConfig } = await importMjs("lib/config-schema.mjs");
    const { run } = await importMjs("runner.mjs");
    await run(loadConfig(null), { target: dir, dryRun: false, type: null, migrate: null });
    const after = readFileSync(join(dir, "Hero.tsx"), "utf8");
    expect(after).toMatch(/\bt\(/); // the literal got wrapped in a t(...) call
    expect(after).not.toContain("<h1>Welcome to our store</h1>");
  });
});
