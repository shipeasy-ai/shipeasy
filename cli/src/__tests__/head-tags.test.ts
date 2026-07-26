import { describe, expect, it } from "vitest";

import { headTagsSection, tagStrategy, type HeadTagsInput } from "../setup/head-tags";
import type { WiringTarget } from "../setup/wiring-doc";

function target(over: Partial<WiringTarget> = {}): WiringTarget {
  return {
    relPath: "apps/web",
    language: "typescript",
    sdk: "typescript",
    frameworks: ["nextjs", "react"],
    packageManager: "pnpm",
    entryPoints: ["app/layout.tsx"],
    sdkInstalled: true,
    installCmd: null,
    installationDoc: null,
    envFile: ".env.local",
    envVars: ["SHIPEASY_SERVER_KEY", "NEXT_PUBLIC_SHIPEASY_CLIENT_KEY"],
    secretStoreMove: null,
    browser: true,
    ...over,
  };
}

function section(over: Partial<HeadTagsInput> = {}): string {
  return (
    headTagsSection({
      projectId: "proj_123",
      clientKey: "sdk_client_abc",
      clientKeyVar: "NEXT_PUBLIC_SHIPEASY_CLIENT_KEY",
      projectIdVar: "NEXT_PUBLIC_SHIPEASY_PROJECT_ID",
      targets: [target()],
      i18n: false,
      devtools: false,
      ...over,
    }) ?? ""
  );
}

describe("tagStrategy", () => {
  it("routes server SDKs to their own tag helpers", () => {
    for (const sdk of ["python", "ruby", "php", "go", "java", "kotlin"]) {
      expect(tagStrategy({ sdk, frameworks: [], native: false })).toBe("sdk-helper");
    }
  });

  // A meta-framework evaluates on the server, so the browser must not evaluate
  // again — it gets the payload-bearing runtime tag. A plain SPA has no server
  // to produce that payload, and its bundler already carries the npm SDK.
  it("splits JS by whether the framework renders on a server", () => {
    expect(tagStrategy({ sdk: "typescript", frameworks: ["nextjs", "react"], native: false })).toBe(
      "sdk-helper",
    );
    expect(tagStrategy({ sdk: "typescript", frameworks: ["sveltekit"], native: false })).toBe(
      "sdk-helper",
    );
    expect(tagStrategy({ sdk: "typescript", frameworks: ["react"], native: false })).toBe(
      "npm-client",
    );
    expect(tagStrategy({ sdk: "javascript", frameworks: ["vue"], native: false })).toBe(
      "npm-client",
    );
  });

  it("gives a bare HTML target the edge-evaluated tag, and a native app none", () => {
    expect(tagStrategy({ sdk: "html", frameworks: [], native: false })).toBe("hosted");
    expect(tagStrategy({ sdk: "typescript", frameworks: ["react-native"], native: true })).toBe(
      "none",
    );
  });
});

describe("headTagsSection", () => {
  // A repo the scan couldn't attribute a page to still has a page — a CMS
  // template, a static shell — so it falls back to the edge-evaluated tag
  // rather than emitting nothing.
  it("falls back to the hosted tag when no target renders the page", () => {
    const doc = section({ targets: [target({ browser: true, native: true })] });
    expect(doc).toContain("no server-side evaluation detected");
    expect(doc).toContain("/sdk/boot.js");
  });

  // The two mistakes the tag set actually punishes: two runtimes on one page,
  // and a server key in HTML. Both have to be stated wherever tags are pasted.
  it("states the one-runtime and public-key-only rules", () => {
    const doc = section();
    expect(doc).toContain("Exactly one runtime tag per page");
    expect(doc).toContain("Only `sdk_client_…` keys belong in HTML");
    expect(doc).toContain("https://docs.shipeasy.ai/sdks/script-loader");
  });

  describe("per-SDK helper syntax", () => {
    const cases: Array<[string, string[]]> = [
      ["python", ["shipeasy.bootstrap_script_tag(user, anon_id=anon_id)"]],
      ["ruby", ["<%= Shipeasy.bootstrap_script_tag(user, anon_id: anon_id) %>"]],
      ["php", ["use function Shipeasy\\bootstrapScriptTag;", "bootstrapScriptTag($user"]],
      ["go", ["shipeasy.BootstrapScriptTag(user, shipeasy.TagOptions{AnonID: anonID})"]],
      ["java", ["Shipeasy.bootstrapScriptTag(user, anonId)"]],
      ["kotlin", ["import ai.shipeasy.bootstrapScriptTag", "bootstrapScriptTag(user, anonId = anonId)"]],
      ["typescript", ["se.getBootstrapData()", "boot.bootstrap.attrs"]],
    ];
    for (const [sdk, expected] of cases) {
      it(`emits the ${sdk} spelling, not a hand-templated tag`, () => {
        const doc = section({ targets: [target({ sdk, language: sdk })] });
        for (const snippet of expected) expect(doc).toContain(snippet);
        // The payload is JSON assembled by the SDK — never by hand.
        expect(doc).not.toContain("data-flags=");
        expect(doc).toContain(`shipeasy docs get --sdk ${sdk} advanced`);
      });
    }
  });

  it("adds the i18n and devtools helpers only when those were enabled", () => {
    const bare = section({ targets: [target({ sdk: "python", language: "python" })] });
    expect(bare).not.toContain("i18n_script_tag");
    expect(bare).not.toContain("devtools_script_tag");

    const full = section({
      targets: [target({ sdk: "python", language: "python" })],
      i18n: true,
      devtools: true,
    });
    expect(full).toContain("shipeasy.i18n_script_tag()");
    expect(full).toContain("shipeasy.devtools_script_tag()");
  });

  // A bundled SPA that also loads a hosted runtime ends up with two things
  // fighting over `window.shipeasy` — the second silently loses.
  it("gives a bundler app no runtime tag, only the overlay", () => {
    const doc = section({
      targets: [target({ frameworks: ["react"] })],
      devtools: true,
    });
    expect(doc).toContain("no hosted runtime tag");
    expect(doc).not.toContain("/sdk/boot.js");
    expect(doc).not.toContain("/sdk/runtime.js");
    expect(doc).toContain('data-client-api-key="sdk_client_abc" data-project-id="proj_123"');
  });

  it("inlines the real project id and client key into the hosted boot tag", () => {
    const doc = section({ targets: [target({ sdk: "html", language: "html", frameworks: [] })] });
    expect(doc).toContain("/sdk/boot.js?p=proj_123&k=sdk_client_abc&a=");
    expect(doc).toContain("__se_anon_id");
    // The escaped closing tag is what keeps document.write valid inside a script.
    expect(doc).toContain("<\\/script>");
  });

  it("names the env var when no key was minted this run", () => {
    const doc = section({
      clientKey: null,
      targets: [target({ sdk: "html", language: "html", frameworks: [] })],
    });
    expect(doc).toContain("<value of NEXT_PUBLIC_SHIPEASY_CLIENT_KEY in env>");
  });

  // Both endpoints now 404, so a page carrying one has no runtime at all —
  // this is a repair step, and it has to name the file it is repairing.
  it("turns a deleted tag already in the repo into a replace step", () => {
    const doc = section({
      targets: [
        target({
          sdk: "html",
          language: "html",
          frameworks: [],
          existingScripts: { current: [], legacy: ["loader"], file: "index.html" },
        }),
      ],
    });
    expect(doc).toContain("Dead tags already in this repo");
    expect(doc).toContain("`apps/web/index.html` carries `/sdk/loader.js`");
  });

  it("says nothing about legacy tags when the repo has none", () => {
    expect(section()).not.toContain("Dead tags already in this repo");
  });
});
