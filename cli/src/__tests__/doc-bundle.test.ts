import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DOCS_DIRNAME,
  type DocBundle,
  type DocIndex,
  type DocPlanInput,
  planTopics,
  resolveHandle,
  toReferenceDocs,
  writeDocBundle,
} from "../setup/doc-bundle";

const base: DocPlanInput = {
  sdks: [{ sdk: "typescript", framework: "nextjs" }],
  servesPages: false,
  devtoolsBrowser: false,
  devtoolsNative: false,
  features: [],
};

/** A manifest index shaped like sdk-ts's real one. */
const tsIndex: DocIndex = {
  pages: [
    "overview",
    "installation",
    "configuration",
    "flags",
    "configs",
    "killswitches",
    "experiments",
    "i18n",
    "error-reporting",
    "browser-devtools",
    "react-native-devtools",
    "advanced",
  ],
  snippets: { release: ["flags"], metrics: ["track"], ops: ["see"] },
  setup: {},
  fallback: false,
};

describe("planTopics", () => {
  it("always pulls installation + configuration, whatever was selected", () => {
    expect(planTopics(base)).toEqual(["installation", "configuration"]);
    expect(planTopics({ ...base, features: ["i18n"] })).toContain("installation");
  });

  it("adds the head-tag and overlay topics only for the surfaces accepted", () => {
    expect(planTopics({ ...base, servesPages: true })).toContain("head-tags");
    expect(planTopics(base)).not.toContain("head-tags");

    const browser = planTopics({ ...base, servesPages: true, devtoolsBrowser: true });
    expect(browser).toContain("browser-devtools");
    expect(browser).not.toContain("react-native-devtools");

    const native = planTopics({ ...base, devtoolsNative: true });
    expect(native).toContain("react-native-devtools");
    expect(native).not.toContain("browser-devtools");
    // A native-only app renders no page, so it takes no tag docs.
    expect(native).not.toContain("head-tags");
  });

  it("expands each feature module into the pages that module's wiring needs", () => {
    const flags = planTopics({ ...base, features: ["flags"] });
    expect(flags).toEqual(
      expect.arrayContaining(["flags", "configs", "killswitches", "experiments", "metrics"]),
    );
    expect(flags).not.toContain("error-reporting");
    expect(flags).not.toContain("i18n");

    expect(planTopics({ ...base, features: ["ops"] })).toContain("error-reporting");
    expect(planTopics({ ...base, features: ["i18n"] })).toContain("i18n");
  });
});

describe("resolveHandle", () => {
  it("resolves a topic to the page the SDK actually publishes", () => {
    expect(resolveHandle(tsIndex, "installation")).toBe("installation");
    expect(resolveHandle(tsIndex, "head-tags")).toBe("advanced");
    expect(resolveHandle(tsIndex, "metrics")).toBe("metrics/track");
  });

  it("falls through the alias list when the preferred page isn't published", () => {
    const idx: DocIndex = { ...tsIndex, pages: ["installation", "translations"] };
    // `i18n` is gone, but the SDK still publishes the same content as `translations`.
    expect(resolveHandle(idx, "i18n")).toBe("translations");
  });

  it("reports nothing rather than inventing a page the SDK doesn't have", () => {
    const idx: DocIndex = { ...tsIndex, pages: ["installation"], snippets: {} };
    expect(resolveHandle(idx, "experiments")).toBeNull();
    expect(resolveHandle(idx, "metrics")).toBeNull();
  });

  it("lets the SDK repo's own manifest override the CLI's handle list", () => {
    // The point of the `setup` map: an SDK can retarget a topic at a page this
    // CLI version has never heard of, without waiting for a CLI release.
    const idx: DocIndex = {
      ...tsIndex,
      pages: [...tsIndex.pages, "devtools-v2"],
      setup: { "browser-devtools": ["devtools-v2"] },
    };
    expect(resolveHandle(idx, "browser-devtools")).toBe("devtools-v2");
  });

  it("ignores a manifest override that points at a page it doesn't publish", () => {
    const idx: DocIndex = { ...tsIndex, setup: { flags: ["gates-v9"] } };
    expect(resolveHandle(idx, "flags")).toBe("flags");
  });
});

describe("writeDocBundle", () => {
  const bundle: DocBundle = {
    dir: DOCS_DIRNAME,
    docs: [
      {
        sdk: "typescript",
        topic: "installation",
        handle: "installation",
        title: "Installation",
        why: "install + the one configure call",
        file: `${DOCS_DIRNAME}/typescript/installation.md`,
        content: "# Installation\n\nnpm i @shipeasy/sdk\n",
      },
    ],
    missing: [{ sdk: "ruby", topic: "browser-devtools" }],
  };

  it("writes each page under <dir>/<sdk>/<topic>.md with a re-pull header", () => {
    const root = mkdtempSync(join(tmpdir(), "se-docs-"));
    try {
      writeDocBundle(root, bundle);
      const written = readFileSync(
        join(root, DOCS_DIRNAME, "typescript", "installation.md"),
        "utf8",
      );
      expect(written).toContain("npm i @shipeasy/sdk");
      // Provenance: which SDK + handle it came from, and how to refresh it.
      expect(written).toContain("shipeasy docs get --sdk typescript installation");
      expect(written).toContain("LATEST published page as of setup");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("drops page bodies when handing the bundle to the wiring doc", () => {
    const refs = toReferenceDocs(bundle);
    expect(refs.dir).toBe(DOCS_DIRNAME);
    expect(refs.pages[0]).not.toHaveProperty("content");
    expect(refs.pages[0]?.file).toBe(`${DOCS_DIRNAME}/typescript/installation.md`);
    expect(refs.missing).toEqual([{ sdk: "ruby", topic: "browser-devtools" }]);
  });
});
