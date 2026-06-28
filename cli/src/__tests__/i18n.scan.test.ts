import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanFiles, type ScanCandidate } from "../i18n/scan";

/**
 * FS/AST scanner test — CLI-strict (the scanner was vendored out of @shipeasy/mcp
 * so the CLI owns the whole filesystem surface). Covers each candidate kind plus
 * the keys-only mode used by `i18n validate`.
 */
describe("i18n scan (scanFiles)", () => {
  let dir: string;
  const byKind = (cs: ScanCandidate[], kind: ScanCandidate["kind"]) =>
    cs.filter((c) => c.kind === kind);
  const keys = (cs: ScanCandidate[]) => cs.map((c) => c.suggested_key);

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "se-scan-"));
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    // ignored dir — must not be scanned
    writeFileSync(join(dir, "node_modules", "Lib.tsx"), `export const X = () => <p>Ignore me please</p>;`);
    writeFileSync(
      join(dir, "Page.tsx"),
      [
        `export function Page({ name }: { name: string }) {`,
        `  return (`,
        `    <div>`,
        `      <h1>Welcome to the dashboard</h1>`,
        `      <span>Hello {name}, good to see you</span>`,
        `      <button title="Save changes" aria-label="Save the form">Go</button>`,
        `      <p>{t("existing.key")}</p>`,
        `      <a href="https://example.com">https://example.com</a>`,
        `    </div>`,
        `  );`,
        `}`,
      ].join("\n"),
    );
    // a plain .ts file (not tsx/jsx) — should be skipped entirely
    writeFileSync(join(dir, "util.ts"), `export const msg = "This is a long sentence in a TS file";`);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("finds plain JSX text", async () => {
    const cs = await scanFiles([dir]);
    expect(keys(byKind(cs, "jsx_text"))).toContain("welcome_to_the_dashboard");
  });

  it("finds mixed JSX text with interpolated variables", async () => {
    const cs = await scanFiles([dir]);
    const mixed = byKind(cs, "jsx_mixed").find((c) => c.text.includes("Hello"));
    expect(mixed).toBeDefined();
    expect(mixed!.variables).toEqual(["name"]);
    expect(mixed!.text).toContain("{{name}}");
  });

  it("finds translatable string props (title, aria-label)", async () => {
    const cs = await scanFiles([dir]);
    expect(keys(byKind(cs, "string_prop"))).toEqual(
      expect.arrayContaining(["save_changes", "save_the_form"]),
    );
  });

  it("detects existing t() calls", async () => {
    const cs = await scanFiles([dir]);
    expect(byKind(cs, "t_call").map((c) => c.text)).toContain("existing.key");
  });

  it("skips URLs, node_modules, and non-jsx files", async () => {
    const cs = await scanFiles([dir]);
    expect(cs.some((c) => c.text.includes("example.com"))).toBe(false);
    expect(cs.some((c) => c.text.includes("Ignore me"))).toBe(false);
    expect(cs.some((c) => c.text.includes("TS file"))).toBe(false);
  });

  it("keysOnly mode surfaces only t() calls (for `i18n validate`)", async () => {
    const cs = await scanFiles([dir], { keysOnly: true });
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.every((c) => c.kind === "t_call")).toBe(true);
  });

  it("records file + line for each candidate", async () => {
    const cs = await scanFiles([dir]);
    for (const c of cs) {
      expect(c.file.endsWith("Page.tsx")).toBe(true);
      expect(c.line).toBeGreaterThan(0);
    }
  });
});
