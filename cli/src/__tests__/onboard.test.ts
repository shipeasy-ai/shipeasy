import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bindTargetDirs,
  checkPreconditions,
  clientKeyVar,
  ensureGitignored,
  envFileFor,
  installArgv,
  maskKey,
  needsStoreMove,
  persistEnv,
  projectIdVar,
} from "../setup/onboard";
import { buildWiringDoc, type WiringDocInput } from "../setup/wiring-doc";
import type { TargetRecommendation } from "../commands/scan";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "se-onboard-"));
}

describe("checkPreconditions", () => {
  it("reports the running node version and no git repo in a bare tmp dir", () => {
    const dir = tmp();
    try {
      const pre = checkPreconditions(dir);
      expect(pre.nodeVersion).toBe(process.versions.node);
      expect(pre.nodeOk).toBe(true); // the repo itself requires node >= 20
      expect(pre.gitRepo).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("key var naming", () => {
  it("uses the framework's public-env prefix for the client key", () => {
    expect(clientKeyVar(["nextjs", "react"])).toBe("NEXT_PUBLIC_SHIPEASY_CLIENT_KEY");
    expect(clientKeyVar(["nuxt", "vue"])).toBe("NUXT_PUBLIC_SHIPEASY_CLIENT_KEY");
    expect(clientKeyVar(["sveltekit"])).toBe("PUBLIC_SHIPEASY_CLIENT_KEY");
    expect(clientKeyVar(["express"])).toBe("SHIPEASY_CLIENT_KEY");
  });

  it("derives the project-id var with the same prefix", () => {
    expect(projectIdVar(["nextjs"])).toBe("NEXT_PUBLIC_SHIPEASY_PROJECT_ID");
    expect(projectIdVar([])).toBe("SHIPEASY_PROJECT_ID");
  });

  it("masks keys down to the last 4 chars", () => {
    expect(maskKey("sdk_server_abcdef1234")).toBe("*…1234");
  });
});

describe("persistEnv", () => {
  it("appends missing vars and never rewrites existing ones (any env file)", () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, ".env"), "SHIPEASY_SERVER_KEY=old_value\n");
      const w = persistEnv(dir, ".env.local", {
        SHIPEASY_SERVER_KEY: "new_value",
        NEXT_PUBLIC_SHIPEASY_CLIENT_KEY: "client_value",
      });
      expect(w.existing).toEqual(["SHIPEASY_SERVER_KEY"]);
      expect(w.added).toEqual(["NEXT_PUBLIC_SHIPEASY_CLIENT_KEY"]);
      // the pre-existing value is untouched
      expect(readFileSync(join(dir, ".env"), "utf8")).toContain("old_value");
      const local = readFileSync(join(dir, ".env.local"), "utf8");
      expect(local).toContain("NEXT_PUBLIC_SHIPEASY_CLIENT_KEY=client_value");
      expect(local).not.toContain("new_value");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent across runs", () => {
    const dir = tmp();
    try {
      persistEnv(dir, ".env", { SHIPEASY_SERVER_KEY: "v1" });
      const w2 = persistEnv(dir, ".env", { SHIPEASY_SERVER_KEY: "v2" });
      expect(w2.added).toEqual([]);
      const content = readFileSync(join(dir, ".env"), "utf8");
      expect(content.match(/SHIPEASY_SERVER_KEY/g)!.length).toBe(1);
      expect(content).toContain("v1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ensureGitignored", () => {
  it("appends the env file to .gitignore when not ignored", () => {
    const dir = tmp();
    try {
      writeFileSync(join(dir, ".gitignore"), "node_modules\n");
      const r = ensureGitignored(dir, ".env.local");
      expect(r.action).toBe("added");
      expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain(".env.local");
      // second run is a no-op
      expect(ensureGitignored(dir, ".env.local").action).toBe("ok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates .gitignore when absent", () => {
    const dir = tmp();
    try {
      const r = ensureGitignored(dir, ".env");
      expect(r.action).toBe("added");
      expect(readFileSync(join(dir, ".gitignore"), "utf8").trim()).toBe(".env");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("installArgv", () => {
  it("runs JS installs with the detected package manager", () => {
    expect(installArgv("typescript", "pnpm", ["nextjs", "react"])).toEqual([
      "pnpm",
      "add",
      "@shipeasy/sdk",
      "@shipeasy/react",
    ]);
    expect(installArgv("javascript", "npm", ["express"])).toEqual([
      "npm",
      "install",
      "@shipeasy/sdk",
    ]);
  });

  it("defers manifest-edit-first ecosystems to the wiring doc", () => {
    expect(installArgv("ruby", "bundler", [])).toBeNull();
    expect(installArgv("java", "maven", [])).toBeNull();
    expect(installArgv("swift", "swiftpm", [])).toBeNull();
    expect(installArgv("python", "pip", [])).toBeNull(); // bare pip isn't durable
  });

  it("keeps runnable non-JS installs", () => {
    expect(installArgv("go", "go", [])).toEqual(["go", "get", "github.com/shipeasy-ai/sdk-go"]);
    expect(installArgv("php", "composer", [])).toEqual([
      "composer",
      "require",
      "shipeasy/shipeasy",
    ]);
    expect(installArgv("python", "poetry", [])).toEqual(["poetry", "add", "shipeasy"]);
  });
});

describe("bindTargetDirs", () => {
  it("binds unbound targets, keeps other-project bindings intact", () => {
    const a = tmp();
    const b = tmp();
    try {
      writeFileSync(join(a, ".shipeasy"), JSON.stringify({ sdk: "typescript" }));
      writeFileSync(join(b, ".shipeasy"), JSON.stringify({ project_id: "proj_other" }));
      const calls: string[] = [];
      const out = bindTargetDirs([a, b], "proj_mine", "Mine", (dir, id) => {
        calls.push(dir);
        writeFileSync(join(dir, ".shipeasy"), JSON.stringify({ project_id: id }));
        return { path: join(dir, ".shipeasy"), created: false };
      });
      expect(out).toEqual([
        { dir: a, action: "bound", projectId: "proj_mine" },
        { dir: b, action: "kept_other", projectId: "proj_other" },
      ]);
      expect(calls).toEqual([a]); // never rebinds a foreign project
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});

describe("needsStoreMove / envFileFor", () => {
  it("flags non-env secret stores", () => {
    expect(needsStoreMove("wrangler secret put SHIPEASY_SERVER_KEY")).toBe(true);
    expect(needsStoreMove("rails credentials:edit → shipeasy_server_key (or .env if using dotenv)")).toBe(true);
    expect(needsStoreMove("application.properties → ${SHIPEASY_SERVER_KEY} + process env")).toBe(true);
    expect(needsStoreMove("<dir>/.env.local (gitignored)")).toBe(false);
    expect(needsStoreMove(null)).toBe(false);
  });

  it("picks .env.local for Next.js, .env otherwise", () => {
    const base = { path: "/x", language: "typescript" } as unknown as TargetRecommendation;
    expect(envFileFor({ ...base, frameworks: ["nextjs", "react"] } as TargetRecommendation)).toBe(".env.local");
    expect(envFileFor({ ...base, frameworks: ["express"] } as TargetRecommendation)).toBe(".env");
  });
});

describe("buildWiringDoc", () => {
  const input: WiringDocInput = {
    projectId: "proj_123",
    targets: [
      {
        relPath: "apps/web",
        language: "typescript",
        sdk: "typescript",
        frameworks: ["nextjs", "react"],
        packageManager: "pnpm",
        entryPoints: ["src/app/layout.tsx"],
        sdkInstalled: true,
        installCmd: null,
        installationDoc: "# Installation (typescript)\n\nCall `shipeasy({ serverKey })`.",
        envFile: ".env.local",
        envVars: ["SHIPEASY_SERVER_KEY", "NEXT_PUBLIC_SHIPEASY_CLIENT_KEY"],
        secretStoreMove: null,
        browser: true,
      },
      {
        relPath: "services/api",
        language: "ruby",
        sdk: "ruby",
        frameworks: ["rails"],
        packageManager: "bundler",
        entryPoints: [],
        sdkInstalled: false,
        installCmd: 'add `gem "shipeasy-sdk"` then `bundle install`',
        installationDoc: null,
        envFile: ".env",
        envVars: ["SHIPEASY_SERVER_KEY"],
        secretStoreMove: "rails credentials:edit → shipeasy_server_key (or .env if using dotenv)",
        browser: false,
      },
    ],
    devtools: {
      clientKeyVar: "NEXT_PUBLIC_SHIPEASY_CLIENT_KEY",
      projectIdVar: "NEXT_PUBLIC_SHIPEASY_PROJECT_ID",
      clientKey: "sdk_client_devtools_val",
    },
    enabledFeatures: ["flags", "ops", "i18n"],
    featureDocs: {
      errorReporting: "# Error reporting\n\nUse `see(err)`.",
      i18n: "# i18n\n\nUse `t('key')`.",
    },
    buildTargets: ["apps/web"],
  };

  it("is complete: rules, per-target steps, devtools, ops, i18n, verification, hand-off", () => {
    const doc = buildWiringDoc(input);
    expect(doc).toContain("## Operating rules");
    expect(doc).toContain("Never print, log, echo, or commit a key value");
    expect(doc).toContain("Target 1: `apps/web/`");
    // Target 1 has a fetched installation doc → embedded inline, not a docs-get line.
    expect(doc).toContain("BEGIN installation doc (sdk: typescript)");
    expect(doc).toContain("shipeasy({ serverKey })");
    expect(doc).toContain("Target 2: `services/api/`");
    // Target 2 has no fetched doc → falls back to the docs-get instruction.
    expect(doc).toContain("shipeasy docs get --sdk ruby installation");
    expect(doc).toContain('add `gem "shipeasy-sdk"`');
    expect(doc).toContain("rails credentials:edit");
    expect(doc).toContain("## Devtools overlay");
    expect(doc).toContain("cdn.shipeasy.ai/se-devtools.js");
    // Public identifiers are inlined as literal values, not "<value of …>" placeholders.
    expect(doc).toContain('data-client-api-key="sdk_client_devtools_val"');
    expect(doc).toContain('data-project-id="proj_123"');
    expect(doc).not.toContain("<value of NEXT_PUBLIC_SHIPEASY_CLIENT_KEY");
    expect(doc).toContain("## Ops wiring");
    expect(doc).toContain("see(err)"); // embedded error-reporting snippet
    expect(doc).toContain("## Translations (i18n) wiring");
    expect(doc).toContain("shipeasy i18n migrate");
    expect(doc).toContain("shipeasy i18n extract");
    expect(doc).toContain("t('key')"); // embedded i18n snippet
    expect(doc).toContain("## Final verification gate");
    expect(doc).toContain("( cd apps/web && (pnpm build || npm run build) )");
    expect(doc).toContain("Do not commit.");
  });

  it("is harness-agnostic — no agent-specific tools or slash commands", () => {
    const doc = buildWiringDoc(input);
    for (const banned of ["Claude", "claude ", "/shipeasy:", "AskUserQuestion", "Cursor", "Copilot", "MCP tool"]) {
      expect(doc, `doc must not reference ${banned}`).not.toContain(banned);
    }
  });

  it("never contains key values, only var names", () => {
    const doc = buildWiringDoc(input);
    expect(doc).not.toMatch(/sdk_server_[a-z0-9]/i);
    expect(doc).toContain("SHIPEASY_SERVER_KEY");
  });

  it("falls back to the env var name when the client key wasn't re-minted", () => {
    const doc = buildWiringDoc({
      ...input,
      devtools: { ...input.devtools!, clientKey: null },
    });
    expect(doc).toContain("<value of NEXT_PUBLIC_SHIPEASY_CLIENT_KEY in env>");
    // The project id is always known, so it stays inlined even in the fallback.
    expect(doc).toContain('data-project-id="proj_123"');
  });

  it("omits module sections that weren't selected", () => {
    const doc = buildWiringDoc({ ...input, devtools: null, enabledFeatures: ["flags"] });
    expect(doc).not.toContain("## Devtools overlay");
    expect(doc).not.toContain("## Ops wiring");
    expect(doc).not.toContain("## Translations (i18n) wiring");
  });

  it("falls back to a docs-get line when a feature doc wasn't fetched", () => {
    const doc = buildWiringDoc({ ...input, featureDocs: {} });
    expect(doc).toContain("shipeasy docs get --sdk typescript error-reporting");
    expect(doc).toContain("shipeasy docs get --sdk typescript i18n");
  });
});
