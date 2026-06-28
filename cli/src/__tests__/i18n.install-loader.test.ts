import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectFramework, injectNextjsApp, injectIndexHtml } from "../commands/i18n";

/** `i18n install-loader` is CLI-strict FS: framework detection + tag injection. */
describe("i18n install-loader", () => {
  let dir: string;
  const TAG = `<script src="https://x/sdk/i18n/loader.js" data-key="ck_1" data-profile="en:prod" defer></script>`;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "se-loader-")));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("detects a Next.js App Router project", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { next: "16" } }));
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "app", "layout.tsx"), `<html><head></head><body/></html>`);
    expect(detectFramework(dir)).toBe("nextjs-app");
  });

  it("detects a Vite project (no next, has index.html)", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ devDependencies: { vite: "5" } }));
    writeFileSync(join(dir, "index.html"), `<html><head></head></html>`);
    expect(detectFramework(dir)).toBe("react-vite");
  });

  it("returns unknown without package.json", () => {
    expect(detectFramework(dir)).toBe("unknown");
  });

  it("injects the loader tag before </head> in a Next layout", () => {
    const layout = join(dir, "layout.tsx");
    writeFileSync(layout, `export default () => (\n  <html>\n    <head></head>\n    <body/>\n  </html>\n);`);
    injectNextjsApp(layout, TAG);
    const out = readFileSync(layout, "utf8");
    expect(out).toContain(TAG);
    expect(out.indexOf(TAG)).toBeLessThan(out.indexOf("</head>"));
  });

  it("is idempotent — does not double-inject", () => {
    const layout = join(dir, "layout.tsx");
    writeFileSync(layout, `<html><head></head><body/></html>`);
    injectNextjsApp(layout, TAG);
    injectNextjsApp(layout, TAG);
    const occurrences = readFileSync(layout, "utf8").split("data-key=").length - 1;
    expect(occurrences).toBe(1);
  });

  it("injects into an index.html for Vite", () => {
    const html = join(dir, "index.html");
    writeFileSync(html, `<html>\n  <head></head>\n  <body></body>\n</html>`);
    injectIndexHtml(html, TAG);
    const out = readFileSync(html, "utf8");
    expect(out).toContain(TAG);
    expect(out.indexOf(TAG)).toBeLessThan(out.indexOf("</head>"));
  });
});
