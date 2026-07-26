import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverTargets,
  detectTargets,
  targetSurface,
  type TargetRecommendation,
} from "../commands/scan";

/**
 * `shipeasy detect` engine — recursive monorepo discovery + per-folder
 * onboarding recommendations. Builds a throwaway monorepo on disk and asserts
 * each folder's recommendation (install command, keys, docs handle, skips).
 */
describe("detect (detectTargets / discoverTargets)", () => {
  let dir: string;
  const byPath = (ts: TargetRecommendation[], suffix: string) =>
    ts.find((t) => t.path.endsWith(suffix));

  beforeAll(() => {
    // realpath up front so comparisons survive macOS /var → /private/var.
    dir = realpathSync(mkdtempSync(join(tmpdir(), "se-detect-")));

    // Workspace root: declares workspaces, no app deps → should be skipped.
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "root", private: true, workspaces: ["apps/*"] }),
    );
    writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");

    // Next.js frontend → install, needs server + client keys.
    mkdirSync(join(dir, "apps/web/src/app"), { recursive: true });
    writeFileSync(
      join(dir, "apps/web/package.json"),
      JSON.stringify({ name: "web", dependencies: { next: "15", react: "19", typescript: "5" } }),
    );
    writeFileSync(join(dir, "apps/web/src/app/layout.tsx"), "export default function L() {}");

    // Go backend → install, server key only.
    mkdirSync(join(dir, "apps/api"), { recursive: true });
    writeFileSync(join(dir, "apps/api/go.mod"), "module example.com/api\n\ngo 1.22\n");

    // Django app → server-rendered HTML, so it's a browser target: server +
    // client keys (the client key powers the in-page devtools overlay).
    mkdirSync(join(dir, "apps/admin"), { recursive: true });
    writeFileSync(join(dir, "apps/admin/requirements.txt"), "Django>=5.0\n");

    // Expo app → a NATIVE surface: it depends on `react` like any web app, so
    // the classifier has to prefer react-native over the browser match.
    mkdirSync(join(dir, "apps/mobile/app"), { recursive: true });
    writeFileSync(
      join(dir, "apps/mobile/package.json"),
      JSON.stringify({
        name: "mobile",
        dependencies: { expo: "54", react: "19", "react-native": "0.81", typescript: "5" },
      }),
    );
    writeFileSync(join(dir, "apps/mobile/app/_layout.tsx"), "export default function L() {}");

    // Pruned dir — a manifest inside node_modules must never be discovered.
    mkdirSync(join(dir, "node_modules/pkg"), { recursive: true });
    writeFileSync(join(dir, "node_modules/pkg/package.json"), JSON.stringify({ name: "pkg" }));
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("discovers every manifest dir and prunes node_modules", () => {
    const targets = discoverTargets(dir);
    expect(targets).toContain(dir);
    expect(targets.some((t) => t.endsWith("/apps/web"))).toBe(true);
    expect(targets.some((t) => t.endsWith("/apps/api"))).toBe(true);
    expect(targets.some((t) => t.includes("node_modules"))).toBe(false);
  });

  it("recommends install + both keys for a Next.js frontend", async () => {
    const { targets } = await detectTargets([dir + "/apps/web"]);
    const web = byPath(targets, "/apps/web")!;
    expect(web.recommendation.action).toBe("install");
    expect(web.recommendation.sdk).toBe("typescript");
    expect(web.recommendation.keys).toEqual(["server", "client"]);
    expect(web.recommendation.install).toContain("@shipeasy/sdk");
    expect(web.recommendation.install).not.toContain("@shipeasy/react");
    expect(web.recommendation.docs).toBe("shipeasy docs get --sdk typescript installation");
  });

  it("recommends install + server-only key for a Go service", async () => {
    const { targets } = await detectTargets([dir + "/apps/api"]);
    const api = byPath(targets, "/apps/api")!;
    expect(api.recommendation.action).toBe("install");
    expect(api.recommendation.sdk).toBe("go");
    expect(api.recommendation.keys).toEqual(["server"]);
    expect(api.recommendation.docs).toBe("shipeasy docs get --sdk go installation");
  });

  it("treats a Django app as a browser target (server + client keys)", async () => {
    const { targets } = await detectTargets([dir + "/apps/admin"]);
    const admin = byPath(targets, "/apps/admin")!;
    expect(admin.recommendation.action).toBe("install");
    expect(admin.recommendation.sdk).toBe("python");
    expect(admin.frameworks).toContain("django");
    expect(admin.recommendation.keys).toEqual(["server", "client"]);
  });

  it("classifies an Expo app as react-native, client key ONLY", async () => {
    // The bundle ships to devices: a `sdk_server_*` in it is a leaked secret,
    // so a native target must never be recommended a server key.
    const { targets } = await detectTargets([dir + "/apps/mobile"]);
    const mobile = byPath(targets, "/apps/mobile")!;
    expect(mobile.frameworks).toEqual(expect.arrayContaining(["react-native", "expo", "react"]));
    expect(targetSurface(mobile.frameworks)).toBe("react-native");
    expect(mobile.recommendation.keys).toEqual(["client"]);
    expect(mobile.recommendation.secret_store).not.toContain("SHIPEASY_SERVER_KEY");
    expect(mobile.entry_points).toContain("app/_layout.tsx");
  });

  // `/sdk/loader.js` and `/sdk/bootstrap.js` were deleted and now 404, while
  // `/sdk/i18n/loader.js` is very much alive — and "loader.js" is a substring of
  // both. Confusing them either reports a broken page as wired, or sends the
  // agent to rip out a working translations tag.
  describe("existing Shipeasy script tags", () => {
    const shell = (html: string): string => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "se-tags-")));
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "site", dependencies: {} }));
      writeFileSync(join(root, "index.html"), html);
      return root;
    };

    it("separates the live tags from the deleted ones", async () => {
      const root = shell(
        `<script src="https://cdn.shipeasy.ai/sdk/i18n/loader.js" data-key="sdk_client_x" data-profile="en:prod"></script>` +
          `<script src="https://cdn.shipeasy.ai/sdk/boot.js?p=p&k=k"></script>` +
          `<script src="https://cdn.shipeasy.ai/se-devtools.js"></script>`,
      );
      const { targets } = await detectTargets([root]);
      const tags = targets[0]!.shipeasy.loader_script_tag;
      expect(tags.present).toBe(true);
      expect(tags.scripts).toEqual(expect.arrayContaining(["boot", "i18n-loader", "devtools"]));
      expect(tags.legacy).toEqual([]);
      expect(tags.data_profile).toBe("en:prod");
      expect(tags.file).toBe("index.html");
      rmSync(root, { recursive: true, force: true });
    });

    it("names a dead endpoint as legacy, never as a live tag", async () => {
      const root = shell(`<script src="https://cdn.shipeasy.ai/sdk/loader.js"></script>`);
      const { targets } = await detectTargets([root]);
      const tags = targets[0]!.shipeasy.loader_script_tag;
      expect(tags.legacy).toEqual(["loader"]);
      expect(tags.scripts).toEqual([]);
      rmSync(root, { recursive: true, force: true });
    });

    it("reports a page with no Shipeasy tags as absent", async () => {
      const root = shell(`<script src="/app.js"></script>`);
      const { targets } = await detectTargets([root]);
      expect(targets[0]!.shipeasy.loader_script_tag.present).toBe(false);
      rmSync(root, { recursive: true, force: true });
    });
  });

  it("flags the workspace root as skip when scanning the whole tree", async () => {
    const { targets } = await detectTargets([dir]);
    const root = targets.find((t) => t.recommendation.action === "skip_workspace_root");
    expect(root).toBeTruthy();
    expect(["typescript", "javascript"]).toContain(root!.language);
    // and the real leaf targets are still present + actionable
    expect(byPath(targets, "/apps/web")?.recommendation.action).toBe("install");
    expect(byPath(targets, "/apps/api")?.recommendation.action).toBe("install");
  });
});
