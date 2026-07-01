import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, realpathSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bindProject,
  mergeDetected,
  readProjectConfig,
  getBoundProjectId,
  getBoundSdk,
  findProjectConfigDir,
  SCHEMA_VERSION,
} from "../util/project-config";

/**
 * The per-project `.shipeasy` model: the holding folder is the project root,
 * reads walk up to the NEAREST file (a subproject shadows its ancestor), and
 * writes (bind / detect-merge) stay LOCAL — binding a subproject never mutates
 * the repo-root file.
 */
describe("project-config (.shipeasy per project)", () => {
  let dir: string;
  const read = (d: string) => JSON.parse(readFileSync(join(d, ".shipeasy"), "utf8"));

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "se-cfg-")));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("bind writes a LOCAL file and stamps schema_version", () => {
    const { path, created } = bindProject(dir, "proj_root");
    expect(created).toBe(true);
    expect(path).toBe(join(dir, ".shipeasy"));
    expect(read(dir)).toMatchObject({ project_id: "proj_root", schema_version: SCHEMA_VERSION });
  });

  it("bind on a subproject does NOT reuse an ancestor file — one file per project", () => {
    bindProject(dir, "proj_root");
    const sub = join(dir, "apps", "web");
    mkdirSync(sub, { recursive: true });

    const { created } = bindProject(sub, "proj_web");
    expect(created).toBe(true);
    // Local subproject file created…
    expect(read(sub).project_id).toBe("proj_web");
    // …and the ancestor is untouched.
    expect(read(dir).project_id).toBe("proj_root");
    // Nearest-wins on read from the subproject.
    expect(findProjectConfigDir(sub)).toBe(sub);
    expect(getBoundProjectId(sub)).toBe("proj_web");
    // The ancestor still resolves from a sibling with no local file.
    expect(getBoundProjectId(dir)).toBe("proj_root");
  });

  it("mergeDetected records language/sdk/frameworks without touching project_id", () => {
    bindProject(dir, "proj_root");
    mergeDetected(dir, { language: "typescript", sdk: "typescript", frameworks: ["nextjs"] });
    const cfg = read(dir);
    expect(cfg.project_id).toBe("proj_root"); // preserved
    expect(cfg.sdk).toBe("typescript");
    expect(cfg.language).toBe("typescript");
    expect(cfg.frameworks).toEqual(["nextjs"]);
    expect(getBoundSdk(dir)).toBe("typescript");
  });

  it("mergeDetected creates a file even before the project is bound", () => {
    expect(existsSync(join(dir, ".shipeasy"))).toBe(false);
    mergeDetected(dir, { language: "go", sdk: "go" });
    const cfg = read(dir);
    expect(cfg.sdk).toBe("go");
    expect(cfg.project_id).toBeUndefined();
    // docs default is now available without any bind
    expect(getBoundSdk(dir)).toBe("go");
  });

  it("bind preserves detection fields already recorded locally", () => {
    mergeDetected(dir, { sdk: "python", language: "python" });
    bindProject(dir, "proj_py", "Acme API");
    const cfg = read(dir);
    expect(cfg.project_id).toBe("proj_py");
    expect(cfg.project_name).toBe("Acme API");
    expect(cfg.sdk).toBe("python"); // not clobbered
  });

  it("readProjectConfig walks up to the nearest file", () => {
    mergeDetected(dir, { sdk: "ruby" });
    const nested = join(dir, "a", "b");
    mkdirSync(nested, { recursive: true });
    expect(readProjectConfig(nested).sdk).toBe("ruby");
  });
});
