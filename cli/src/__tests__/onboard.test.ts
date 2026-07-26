import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bindTargetDirs,
  checkPreconditions,
  clientKeyVar,
  ensureGitignored,
  envFileFor,
  frameworkSetupArgv,
  installArgv,
  maskKey,
  needsStoreMove,
  peerConflictRetryArgv,
  persistEnv,
  projectIdVar,
  rnDevtoolsInstallArgv,
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
    // Expo inlines EXPO_PUBLIC_* at build time; the `react` an RN app also
    // carries must not win and hand it a bare name the bundler ignores.
    expect(clientKeyVar(["react-native", "expo", "react"])).toBe(
      "EXPO_PUBLIC_SHIPEASY_CLIENT_KEY",
    );
    // Bare React Native has no env convention at all.
    expect(clientKeyVar(["react-native", "react"])).toBe("SHIPEASY_CLIENT_KEY");
  });

  it("derives the project-id var with the same prefix", () => {
    expect(projectIdVar(["nextjs"])).toBe("NEXT_PUBLIC_SHIPEASY_PROJECT_ID");
    expect(projectIdVar(["expo"])).toBe("EXPO_PUBLIC_SHIPEASY_PROJECT_ID");
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

describe("peerConflictRetryArgv", () => {
  it("retries an npm install with --legacy-peer-deps", () => {
    // npm aborts on ERESOLVE for a peer conflict the app already had — that must
    // not be where onboarding stops.
    expect(peerConflictRetryArgv(["npm", "install", "@shipeasy/sdk"])).toEqual([
      "npm",
      "install",
      "@shipeasy/sdk",
      "--legacy-peer-deps",
    ]);
  });

  it("has no retry for managers that don't fail on peer conflicts", () => {
    for (const argv of [
      ["pnpm", "add", "@shipeasy/sdk"],
      ["yarn", "add", "@shipeasy/sdk"],
      ["bun", "add", "@shipeasy/sdk"],
      ["bundle", "add", "shipeasy-sdk"],
      ["composer", "require", "shipeasy/shipeasy"],
    ]) {
      expect(peerConflictRetryArgv(argv)).toBeNull();
    }
  });
});

describe("installArgv", () => {
  it("runs JS installs with the detected package manager", () => {
    expect(installArgv("typescript", "pnpm", ["nextjs", "react"])).toEqual([
      "pnpm",
      "add",
      "@shipeasy/sdk",
    ]);
    expect(installArgv("javascript", "npm", ["express"])).toEqual([
      "npm",
      "install",
      "@shipeasy/sdk",
    ]);
  });

  it("defers manifest-edit-first ecosystems to the wiring doc", () => {
    expect(installArgv("java", "maven", [])).toBeNull();
    expect(installArgv("kotlin", "gradle", [])).toBeNull();
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

  it("runs `bundle add` for Ruby (records in the Gemfile)", () => {
    expect(installArgv("ruby", "bundler", [])).toEqual(["bundle", "add", "shipeasy-sdk"]);
    expect(installArgv("ruby", "bundler", ["rails"])).toEqual(["bundle", "add", "shipeasy-sdk"]);
  });

  it("runs the manifest-recording Python manager, with the django extra", () => {
    expect(installArgv("python", "uv", [])).toEqual(["uv", "add", "shipeasy"]);
    expect(installArgv("python", "pipenv", [])).toEqual(["pipenv", "install", "shipeasy"]);
    expect(installArgv("python", "pdm", [])).toEqual(["pdm", "add", "shipeasy"]);
    expect(installArgv("python", "uv", ["django"])).toEqual(["uv", "add", "shipeasy[django]"]);
    expect(installArgv("python", "poetry", ["django"])).toEqual([
      "poetry",
      "add",
      "shipeasy[django]",
    ]);
  });
});

describe("rnDevtoolsInstallArgv", () => {
  it("installs the overlay + its required form peers with the detected manager", () => {
    const plan = rnDevtoolsInstallArgv("pnpm", ["react-native", "expo"]);
    expect(plan.main).toEqual([
      "pnpm",
      "add",
      "@shipeasy/react-native-devtools",
      "react-hook-form",
      "@hookform/resolvers",
      "zod",
    ]);
    // The overlay is NOT part of @shipeasy/sdk — that's the whole point of the
    // native branch of the devtools step.
    expect(plan.main).not.toContain("@shipeasy/sdk");
  });

  it("routes the expo-module peers through `expo install`, and only for Expo apps", () => {
    // `expo install` resolves the version matching the app's Expo SDK; a plain
    // `npm install` of these is how you break a native build.
    const expo = rnDevtoolsInstallArgv("npm", ["react-native", "expo"]);
    expect(expo.main[1]).toBe("install");
    expect(expo.expoPeers?.slice(0, 3)).toEqual(["npx", "expo", "install"]);
    expect(expo.expoPeers).toContain("expo-sensors"); // shake-to-open
    expect(expo.expoPeers).toContain("expo-web-browser"); // login round-trip

    // Bare React Native: no expo CLI to call, so the optional peers are skipped
    // and the wiring doc explains the imperative `ref.open()` fallback.
    expect(rnDevtoolsInstallArgv("yarn", ["react-native"]).expoPeers).toBeNull();
  });
});

describe("frameworkSetupArgv", () => {
  it("runs the Rails generator only with a real rails signal file", () => {
    const dir = tmp();
    try {
      expect(frameworkSetupArgv("ruby", ["rails"], dir)).toBeNull(); // no signal yet
      mkdirSync(join(dir, "config"), { recursive: true });
      writeFileSync(join(dir, "config", "application.rb"), "");
      expect(frameworkSetupArgv("ruby", ["rails"], dir)).toEqual([
        "bundle",
        "exec",
        "rails",
        "generate",
        "shipeasy:install",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns the Laravel generator when artisan is present, null otherwise", () => {
    const dir = tmp();
    try {
      expect(frameworkSetupArgv("php", ["laravel"], dir)).toBeNull();
      writeFileSync(join(dir, "artisan"), "#!/usr/bin/env php");
      expect(frameworkSetupArgv("php", ["laravel"], dir)).toEqual([
        "php",
        "artisan",
        "shipeasy:install",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null for frameworks without a generator", () => {
    const dir = tmp();
    try {
      expect(frameworkSetupArgv("python", ["django"], dir)).toBeNull();
      expect(frameworkSetupArgv("go", [], dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    publicIds: {
      clientKey: "sdk_client_devtools_val",
      clientKeyVar: "NEXT_PUBLIC_SHIPEASY_CLIENT_KEY",
      projectIdVar: "NEXT_PUBLIC_SHIPEASY_PROJECT_ID",
    },
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
    // Every target gets the identity / targeting-attributes wiring step, pointing at
    // its own SDK's configuration doc and the read-only attributes-schema check.
    expect(doc).toContain("Wire user identity + targeting attributes");
    expect(doc).toContain("shipeasy docs get --sdk typescript configuration");
    expect(doc).toContain("shipeasy docs get --sdk ruby configuration");
    expect(doc).toContain("shipeasy release flags attributes list");
    // Browser target also feeds the same transform through identify().
    expect(doc).toContain("identify()`s the visitor");
    // Target 2 has no fetched doc → falls back to the docs-get instruction.
    expect(doc).toContain("shipeasy docs get --sdk ruby installation");
    expect(doc).toContain('add `gem "shipeasy-sdk"`');
    expect(doc).toContain("rails credentials:edit");
    // The head tags are emitted from the SDK for an SSR target — the overlay
    // rides `getDevtoolsData()`, so no hand-templated <script> appears here.
    expect(doc).toContain("## Browser head tags");
    expect(doc).toContain("se.getBootstrapData()");
    expect(doc).toContain("se.getDevtoolsData()");
    expect(doc).toContain("boot.i18nLoader"); // i18n enabled → loader tag included
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

  // The gate's first command is `shipeasy whoami`, which reads the CLI session —
  // a different credential from the MCP authorization. An agent that hits this
  // with no session can't fix it silently (browser flow), so the doc has to say
  // so rather than leave it looking like a dead end.
  it("tells the agent how to recover a missing CLI session at the gate", () => {
    const doc = buildWiringDoc(input);
    expect(doc).toContain("shipeasy whoami");
    expect(doc).toContain("run `shipeasy login`, show the user");
    expect(doc).toContain("separate from your MCP connection");
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

  // A repo with no server evaluation gets literal tags, so the key it can't
  // read from env has to be inlined — or fall back to naming the var.
  it("falls back to the env var name when the client key wasn't re-minted", () => {
    const staticSite: WiringDocInput = {
      ...input,
      targets: [{ ...input.targets[0]!, sdk: "html", language: "html", frameworks: [] }],
      publicIds: { ...input.publicIds!, clientKey: null },
    };
    const doc = buildWiringDoc(staticSite);
    expect(doc).toContain("<value of NEXT_PUBLIC_SHIPEASY_CLIENT_KEY in env>");
    // The project id is always known, so it stays inlined even in the fallback.
    expect(doc).toContain('data-project-id="proj_123"');
    expect(buildWiringDoc({ ...staticSite, publicIds: input.publicIds })).toContain(
      'data-client-api-key="sdk_client_devtools_val"',
    );
  });

  it("omits module sections that weren't selected", () => {
    const doc = buildWiringDoc({ ...input, devtools: null, enabledFeatures: ["flags"] });
    expect(doc).not.toContain("## Devtools overlay");
    expect(doc).not.toContain("## Ops wiring");
    expect(doc).not.toContain("## Translations (i18n) wiring");
    // The head tags are NOT a devtools sub-section: a page still needs a runtime
    // tag when the overlay was declined, just without the overlay in the block.
    expect(doc).toContain("## Browser head tags");
    expect(doc).not.toContain("se-devtools.js");
    expect(doc).not.toContain("i18nLoader");
  });

  it("falls back to a docs-get line when a feature doc wasn't fetched", () => {
    const doc = buildWiringDoc({ ...input, featureDocs: {} });
    expect(doc).toContain("shipeasy docs get --sdk typescript error-reporting");
    expect(doc).toContain("shipeasy docs get --sdk typescript i18n");
  });

  describe("React Native surface", () => {
    const nativeInput: WiringDocInput = {
      ...input,
      targets: [
        {
          relPath: "apps/mobile",
          language: "typescript",
          sdk: "typescript",
          frameworks: ["react-native", "expo", "react"],
          packageManager: "npm",
          entryPoints: ["app/_layout.tsx"],
          sdkInstalled: true,
          installCmd: null,
          installationDoc: null,
          envFile: ".env",
          envVars: ["EXPO_PUBLIC_SHIPEASY_CLIENT_KEY"],
          secretStoreMove: null,
          browser: true,
          native: true,
        },
      ],
      devtools: {
        surfaces: ["react-native"],
        clientKeyVar: "EXPO_PUBLIC_SHIPEASY_CLIENT_KEY",
        projectIdVar: "EXPO_PUBLIC_SHIPEASY_PROJECT_ID",
        clientKey: "sdk_client_devtools_val",
        native: {
          relPath: "apps/mobile",
          installCmd: null,
          expoPeersCmd: "npx expo install expo-web-browser expo-sensors",
          doc: "# React Native devtools\n\nMount `<ShipeasyDevtools/>`.",
        },
      },
    };

    it("emits the mount + scheme steps and never the browser <script> tag", () => {
      const doc = buildWiringDoc(nativeInput);
      expect(doc).toContain("## Devtools overlay — React Native");
      expect(doc).toContain("<ShipeasyDevtools");
      expect(doc).toContain("expo.scheme"); // where the deep-link scheme comes from
      expect(doc).toContain("npx expo install expo-web-browser");
      expect(doc).toContain("Mount `<ShipeasyDevtools/>`."); // embedded doc
      // A phone app can't host the <script> overlay — offering it would send the
      // agent editing an HTML shell that doesn't exist.
      expect(doc).not.toContain("cdn.shipeasy.ai/se-devtools.js");
      expect(doc).not.toContain("?se=1");
    });

    it("reads the key from EXPO_PUBLIC env, and inlines it for a bare RN app", () => {
      expect(buildWiringDoc(nativeInput)).toContain(
        "process.env.EXPO_PUBLIC_SHIPEASY_CLIENT_KEY",
      );
      const bare = buildWiringDoc({
        ...nativeInput,
        devtools: { ...nativeInput.devtools!, clientKeyVar: "SHIPEASY_CLIENT_KEY" },
      });
      // No bundler env channel → the (public) key goes in literally, or the
      // mount would silently read `undefined`.
      expect(bare).toContain('clientKey={"sdk_client_devtools_val"}');
      expect(bare).not.toContain("process.env.SHIPEASY_CLIENT_KEY");
    });

    it("wires a native target to the CLIENT key only — never a server key", () => {
      const doc = buildWiringDoc(nativeInput);
      expect(doc).toContain("EXPO_PUBLIC_SHIPEASY_CLIENT_KEY");
      expect(doc).toContain("a server key in an app bundle is a leaked secret");
      expect(doc).not.toContain("reading the\n      server key");
      expect(doc).not.toContain("Also initialise the browser SDK");
    });

    it("keeps the install step open when the CLI could not run it", () => {
      const doc = buildWiringDoc({
        ...nativeInput,
        devtools: {
          ...nativeInput.devtools!,
          native: {
            ...nativeInput.devtools!.native!,
            installCmd: "npm install @shipeasy/react-native-devtools react-hook-form",
            expoPeersCmd: null,
          },
        },
      });
      expect(doc).toContain("- [ ] Install it (the CLI could not run this one)");
      expect(doc).toContain("Bare React Native (no Expo)");
      expect(doc).toContain("ref.current?.open()");
    });

    it("emits BOTH sections when the repo has a web app and a mobile app", () => {
      const doc = buildWiringDoc({
        ...nativeInput,
        devtools: { ...nativeInput.devtools!, surfaces: ["browser", "react-native"] },
      });
      expect(doc).toContain("## Browser head tags");
      expect(doc).toContain("## Devtools overlay — React Native");
    });
  });
});
