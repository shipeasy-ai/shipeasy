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

describe("i18n codemod · emitted calls", () => {
  let dir: string;
  let prevCwd: string;
  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "se-codemod-emit-")));
    prevCwd = process.cwd();
    process.chdir(dir);
  });
  afterAll(() => {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  async function codemod(file: string, source: string, overrides: Record<string, unknown> = {}) {
    const { loadConfig } = await importMjs("lib/config-schema.mjs");
    const { run } = await importMjs("runner.mjs");
    const src = join(dir, "src");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, file), source);
    writeFileSync(join(dir, ".i18n-codemod.json"), JSON.stringify(overrides));
    await run(loadConfig(null), { target: src, dryRun: false, type: null, migrate: null });
    const keys = JSON.parse(readFileSync(join(dir, "src/i18n/en.json"), "utf8"));
    return { out: readFileSync(join(src, file), "utf8"), keys };
  }

  it("passes the fallback, so SSR renders the copy instead of the key", async () => {
    const { out } = await codemod("Hero.tsx", `export const Hero = () => <h1>Welcome to our store</h1>;\n`);
    expect(out).toContain(`{i18n.t('hero.welcomeToOurStore', 'Welcome to our store')}`);
  });

  it("sizes JSX text by its raw source and collapses lines the way React renders them", async () => {
    const { out, keys } = await codemod(
      "Note.tsx",
      [
        `export const Note = () => (`,
        `  <p>`,
        `    It&apos;s in front of the team now. You&apos;ll hear back`,
        `    within a few hours`,
        `  </p>`,
        `);`,
        ``,
      ].join("\n"),
    );
    expect(out).toContain(
      `{i18n.t('note.itsInFrontOfThe', "It's in front of the team now. You'll hear back within a few hours")}`,
    );
    // nothing of the raw text is left behind the call
    expect(out).not.toMatch(/\)\}\S/);
    expect(keys["note.itsInFrontOfThe"]).toBe(
      "It's in front of the team now. You'll hear back within a few hours",
    );
  });

  it("prefixes every key, common.* included", async () => {
    const { keys } = await codemod("Bar.tsx", `export const Bar = () => <button>Save changes</button>;\n`, {
      keyPrefix: "landing",
    });
    expect(Object.keys(keys)).toContain("landing.common.saveChanges");
  });

  it("leaves module-scope copy alone by default", async () => {
    const { out } = await codemod(
      "Nav.tsx",
      `const LINKS = [{ label: "Documentation" }];\nexport const Nav = () => <a>{LINKS[0].label}</a>;\n`,
    );
    expect(out).toContain(`const LINKS = [{ label: "Documentation" }];`);
  });

  it("turns a safe module-scope const into a thunk in thunk mode", async () => {
    const { out } = await codemod(
      "Menu.tsx",
      [
        `type Item = { label: string };`,
        `const ITEMS: Item[] = [{ label: "Documentation" }];`,
        `export const LABELS = [{ label: "Exported stays put" }];`,
        `export function Menu() {`,
        `  const all = { ITEMS };`,
        `  return <ul>{ITEMS.map((i) => <li key={i.label}>{i.label}</li>)}{all.ITEMS.length}</ul>;`,
        `}`,
        ``,
      ].join("\n"),
      { moduleScope: "thunk" },
    );
    expect(out).toMatch(
      /const ITEMS = \(\): Item\[\] => \(\[\{ label: i18n\.t\('[\w.]+', 'Documentation'\) \}\]\);/,
    );
    expect(out).toContain(`{ITEMS().map(`);
    expect(out).toContain(`const all = { ITEMS: ITEMS() };`);
    expect(out).toContain(`export const LABELS = [{ label: "Exported stays put" }];`);
  });
});
