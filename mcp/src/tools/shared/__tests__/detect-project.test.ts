import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleDetectProject } from "../detect-project.js";

// ── fixture helpers ────────────────────────────────────────────────────────

function makeTmp(): string {
  // Resolve symlinks so paths match what resolveRoot() returns (e.g. /tmp → /private/tmp on macOS)
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "shipeasy-detect-")));
}

function write(dir: string, file: string, content: string) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function pkgJson(
  deps: Record<string, string> = {},
  devDeps: Record<string, string> = {},
  extra: Record<string, unknown> = {},
) {
  return JSON.stringify({ dependencies: deps, devDependencies: devDeps, ...extra }, null, 2);
}

// Unwrap helpers — parse the JSON response and pull out the first project
async function detect(p: string) {
  const raw = JSON.parse((await handleDetectProject(p)).content[0].text);
  return raw;
}

async function project(p: string) {
  const raw = await detect(p);
  if (raw.status !== "ok") throw new Error(`Expected ok, got: ${JSON.stringify(raw)}`);
  return raw.projects[0];
}

// ── language detection ─────────────────────────────────────────────────────

describe("language detection", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmp();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("detects typescript when typescript is in devDeps", async () => {
    write(dir, "package.json", pkgJson({ react: "^18" }, { typescript: "^5" }));
    write(dir, "src/main.tsx", "");
    expect((await project(dir)).language).toBe("typescript");
  });

  it("falls back to javascript when no typescript dep", async () => {
    write(dir, "package.json", pkgJson({ react: "^18" }));
    write(dir, "src/main.tsx", "");
    expect((await project(dir)).language).toBe("javascript");
  });

  it("detects python from pyproject.toml", async () => {
    write(dir, "pyproject.toml", "[tool.poetry]\nname = 'myapp'");
    const p = await project(dir);
    expect(p.language).toBe("python");
    expect(p.package_manager).toBe("poetry");
  });

  it("detects python from requirements.txt with pip", async () => {
    write(dir, "requirements.txt", "django==4.2\n");
    const p = await project(dir);
    expect(p.language).toBe("python");
    expect(p.package_manager).toBe("pip");
  });

  it("detects ruby from Gemfile", async () => {
    const p = await detect(dir);
    // empty dir → needs_clarification, so add Gemfile for a real result
    write(dir, "Gemfile", "gem 'rails'");
    const r = await project(dir);
    expect(r.language).toBe("ruby");
    expect(r.package_manager).toBe("bundler");
  });

  it("detects go from go.mod", async () => {
    write(dir, "go.mod", "module example.com/app\n\ngo 1.22\n");
    const p = await project(dir);
    expect(p.language).toBe("go");
    expect(p.package_manager).toBe("go");
  });

  it("detects php from composer.json", async () => {
    write(dir, "composer.json", JSON.stringify({ require: { "laravel/framework": "^10" } }));
    const p = await project(dir);
    expect(p.language).toBe("php");
    expect(p.package_manager).toBe("composer");
  });
});

// ── package manager detection ──────────────────────────────────────────────

describe("package manager detection", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmp();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("detects pnpm from pnpm-lock.yaml", async () => {
    write(dir, "package.json", pkgJson({ react: "^18" }));
    write(dir, "src/main.tsx", "");
    write(dir, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    expect((await project(dir)).package_manager).toBe("pnpm");
  });

  it("detects yarn from yarn.lock", async () => {
    write(dir, "package.json", pkgJson({ react: "^18" }));
    write(dir, "src/main.tsx", "");
    write(dir, "yarn.lock", "# yarn lockfile v1\n");
    expect((await project(dir)).package_manager).toBe("yarn");
  });

  it("detects pnpm from packageManager field", async () => {
    write(dir, "package.json", pkgJson({ react: "^18" }, {}, { packageManager: "pnpm@10.0.0" }));
    write(dir, "src/main.tsx", "");
    expect((await project(dir)).package_manager).toBe("pnpm");
  });

  it("detects pnpm lockfile in parent (monorepo)", async () => {
    write(dir, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    const sub = path.join(dir, "apps", "ui");
    fs.mkdirSync(sub, { recursive: true });
    write(sub, "package.json", pkgJson({ next: "^15" }));
    write(sub, "src/app/layout.tsx", "");
    expect((await project(sub)).package_manager).toBe("pnpm");
  });
});

// ── framework detection ────────────────────────────────────────────────────

describe("framework detection", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmp();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("detects nextjs and react", async () => {
    write(dir, "package.json", pkgJson({ next: "^15", react: "^19", "react-dom": "^19" }));
    write(dir, "src/app/layout.tsx", "");
    const p = await project(dir);
    expect(p.frameworks).toContain("nextjs");
    expect(p.frameworks).toContain("react");
  });

  it("detects vue", async () => {
    write(dir, "package.json", pkgJson({ vue: "^3" }));
    write(dir, "src/main.ts", "");
    expect((await project(dir)).frameworks).toContain("vue");
  });

  it("detects svelte and sveltekit", async () => {
    write(dir, "package.json", pkgJson({ svelte: "^4", "@sveltejs/kit": "^2" }));
    write(dir, "src/index.ts", "");
    const p = await project(dir);
    expect(p.frameworks).toContain("svelte");
    expect(p.frameworks).toContain("sveltekit");
  });

  it("deduplicates react when both react and react-dom present", async () => {
    write(dir, "package.json", pkgJson({ react: "^19", "react-dom": "^19" }));
    write(dir, "src/main.tsx", "");
    const p = await project(dir);
    expect(p.frameworks.filter((f: string) => f === "react").length).toBe(1);
  });

  it("detects django in requirements.txt", async () => {
    write(dir, "requirements.txt", "django==4.2\nrequests==2.31\n");
    expect((await project(dir)).frameworks).toContain("django");
  });
});

// ── entry point detection ──────────────────────────────────────────────────

describe("entry point detection", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmp();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("finds src/app/layout.tsx", async () => {
    write(dir, "package.json", pkgJson({ next: "^15" }));
    write(dir, "src/app/layout.tsx", "export default function Layout() {}");
    expect((await project(dir)).entry_points).toContain("src/app/layout.tsx");
  });

  it("finds src/main.tsx for plain react", async () => {
    write(dir, "package.json", pkgJson({ react: "^19" }));
    write(dir, "src/main.tsx", "import React from 'react';");
    expect((await project(dir)).entry_points).toContain("src/main.tsx");
  });
});

// ── shipeasy SDK detection ─────────────────────────────────────────────────

describe("shipeasy SDK detection", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmp();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("reports SDK not installed when shipeasy absent from deps", async () => {
    write(dir, "package.json", pkgJson({ next: "^15" }));
    write(dir, "src/app/layout.tsx", "");
    const p = await project(dir);
    expect(p.shipeasy.experimentation_sdk.installed).toBe(false);
    expect(p.shipeasy.i18n_sdk.installed).toBe(false);
  });

  it("reports SDK installed when shipeasy in deps", async () => {
    write(dir, "package.json", pkgJson({ shipeasy: "^1.0.0" }));
    write(dir, "src/main.ts", "");
    const p = await project(dir);
    expect(p.shipeasy.experimentation_sdk.installed).toBe(true);
    expect(p.shipeasy.experimentation_sdk.version).toBe("^1.0.0");
    expect(p.shipeasy.i18n_sdk.installed).toBe(true);
  });

  it("detects server key configured via .env.local", async () => {
    write(dir, "package.json", pkgJson({ shipeasy: "^1.0.0" }));
    write(dir, "src/main.ts", "");
    write(dir, ".env.local", "SHIPEASY_SERVER_KEY=sdk_server_abc\n");
    const p = await project(dir);
    expect(p.shipeasy.experimentation_sdk.configured).toBe(true);
    expect(p.shipeasy.env_keys_detected).toContain("SHIPEASY_SERVER_KEY");
  });

  it("detects client key for i18n via .env.local", async () => {
    write(dir, "package.json", pkgJson({ shipeasy: "^1.0.0" }));
    write(dir, "src/main.ts", "");
    write(dir, ".env.local", "NEXT_PUBLIC_SHIPEASY_CLIENT_KEY=sdk_client_xyz\n");
    const p = await project(dir);
    expect(p.shipeasy.i18n_sdk.configured).toBe(true);
    expect(p.shipeasy.env_keys_detected).toContain("NEXT_PUBLIC_SHIPEASY_CLIENT_KEY");
  });
});

// ── loader script detection ────────────────────────────────────────────────

describe("loader script detection", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmp();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("detects loader script in layout.tsx with key and profile", async () => {
    write(dir, "package.json", pkgJson({ next: "^15" }));
    write(
      dir,
      "src/app/layout.tsx",
      `export default function Layout() {
  return (
    <html>
      <head>
        <script
          src="https://api.shipeasy.ai/sdk/i18n/loader.js"
          data-key="sdk_client_abc123"
          data-profile="en:prod"
          async
        />
      </head>
    </html>
  );
}`,
    );
    const p = await project(dir);
    expect(p.shipeasy.loader_script_tag.present).toBe(true);
    expect(p.shipeasy.loader_script_tag.data_key).toBe("sdk_client_abc123");
    expect(p.shipeasy.loader_script_tag.data_profile).toBe("en:prod");
  });

  it("reports loader script absent when not in layout", async () => {
    write(dir, "package.json", pkgJson({ next: "^15" }));
    write(dir, "src/app/layout.tsx", "export default function Layout() { return <html />; }");
    expect((await project(dir)).shipeasy.loader_script_tag.present).toBe(false);
  });
});

// ── clarification flow ─────────────────────────────────────────────────────

describe("clarification flow", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTmp();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("returns needs_clarification for empty/workspace-root dirs", async () => {
    // bare package.json with no frameworks and no entry points → ambiguous
    write(dir, "package.json", pkgJson());
    const raw = await detect(dir);
    expect(raw.status).toBe("needs_clarification");
    expect(raw.question).toMatch(/full path/i);
  });

  it("includes detected_subdirs when subproject dirs exist", async () => {
    write(dir, "package.json", pkgJson());
    // add a subdir that looks like a real project
    write(path.join(dir, "frontend"), "package.json", pkgJson({ react: "^18" }));
    const raw = await detect(dir);
    expect(raw.status).toBe("needs_clarification");
    expect(raw.detected_subdirs).toContain(path.join(dir, "frontend"));
  });

  it("returns ok when a real project is detected", async () => {
    write(dir, "package.json", pkgJson({ next: "^15" }));
    write(dir, "src/app/layout.tsx", "");
    const raw = await detect(dir);
    expect(raw.status).toBe("ok");
    expect(raw.projects).toHaveLength(1);
  });
});

// ── multi-path support ─────────────────────────────────────────────────────

describe("multi-path support", () => {
  let dirA: string;
  let dirB: string;
  beforeEach(() => {
    dirA = makeTmp();
    dirB = makeTmp();
  });
  afterEach(() => {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  });

  it("returns a project entry for each path", async () => {
    write(dirA, "package.json", pkgJson({ next: "^15" }));
    write(dirA, "src/app/layout.tsx", "");
    write(dirB, "package.json", pkgJson({ vue: "^3" }));
    write(dirB, "src/main.ts", "");

    const raw = JSON.parse((await handleDetectProject([dirA, dirB])).content[0].text);
    expect(raw.status).toBe("ok");
    expect(raw.projects).toHaveLength(2);
    const paths = raw.projects.map((p: { path: string }) => p.path);
    expect(paths).toContain(dirA);
    expect(paths).toContain(dirB);
  });

  it("does not ask for clarification when multiple explicit paths given", async () => {
    // even if one path is ambiguous, we respect the explicit input
    write(dirA, "package.json", pkgJson());
    write(dirB, "package.json", pkgJson());
    const raw = JSON.parse((await handleDetectProject([dirA, dirB])).content[0].text);
    expect(raw.status).toBe("ok");
  });

  it("reports correct framework per path", async () => {
    write(dirA, "package.json", pkgJson({ next: "^15" }));
    write(dirA, "src/app/layout.tsx", "");
    write(dirB, "Gemfile", "gem 'rails'");

    const raw = JSON.parse((await handleDetectProject([dirA, dirB])).content[0].text);
    const a = raw.projects.find((p: { path: string }) => p.path === dirA);
    const b = raw.projects.find((p: { path: string }) => p.path === dirB);
    expect(a.frameworks).toContain("nextjs");
    expect(b.language).toBe("ruby");
  });
});
