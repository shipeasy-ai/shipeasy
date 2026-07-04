import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverTargets, detectTargets, type TargetRecommendation } from "../commands/scan";

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
