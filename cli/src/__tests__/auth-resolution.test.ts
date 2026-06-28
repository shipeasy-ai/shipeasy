import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getGeneratedClient } from "../api/client";
import { loadCredentials } from "../auth/storage";
import { bindProject, getBoundProjectId, findProjectConfigDir } from "../util/project-config";

/**
 * End-to-end auth/project resolution: the `.shipeasy` project binding (walked up
 * like `.git`) + the user creds file ($XDG_CONFIG_HOME/shipeasy/config.json),
 * combined in getGeneratedClient → X-Project-Id + X-SDK-Key on the configured
 * generated client. Confirms the CLI still wires real auth after the cutover.
 */
describe("auth + .shipeasy resolution", () => {
  let root: string; // holds .shipeasy
  let cfgHome: string; // XDG_CONFIG_HOME with the creds file
  let prevCwd: string;
  const env = { ...process.env };

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "se-bound-")));
    cfgHome = realpathSync(mkdtempSync(join(tmpdir(), "se-xdg-")));
    // creds file: the CLI session is on proj_session
    mkdirSync(join(cfgHome, "shipeasy"), { recursive: true });
    writeFileSync(
      join(cfgHome, "shipeasy", "config.json"),
      JSON.stringify({
        project_id: "proj_session",
        cli_token: "sdk_tok_123",
        api_base_url: "https://api.test",
        app_base_url: "https://app.test/",
        created_at: new Date(0).toISOString(),
      }),
    );
    // .shipeasy binds this directory to proj_bound
    bindProject(root, "proj_bound", "Acme");
    prevCwd = process.cwd();
    process.chdir(root);
    process.env.XDG_CONFIG_HOME = cfgHome;
    delete process.env.SHIPEASY_CLI_TOKEN;
    delete process.env.SHIPEASY_PROJECT_ID;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    process.chdir(prevCwd);
    process.env = { ...env };
    rmSync(root, { recursive: true, force: true });
    rmSync(cfgHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it(".shipeasy is found by walking up from a nested dir", () => {
    const nested = join(root, "a", "b");
    mkdirSync(nested, { recursive: true });
    expect(findProjectConfigDir(nested)).toBe(root);
    expect(getBoundProjectId(nested)).toBe("proj_bound");
  });

  it("loads creds from the XDG config file", () => {
    const creds = loadCredentials();
    expect(creds?.cli_token).toBe("sdk_tok_123");
    expect(creds?.project_id).toBe("proj_session");
  });

  it(".shipeasy binding wins over the session default for X-Project-Id", () => {
    const cfg = getGeneratedClient().getConfig() as { baseUrl?: string; headers: Headers };
    expect(cfg.headers.get("X-Project-Id")).toBe("proj_bound"); // bound dir, not proj_session
    expect(cfg.headers.get("X-SDK-Key")).toBe("sdk_tok_123");
    expect(cfg.baseUrl).toBe("https://app.test"); // trailing slash trimmed
  });

  it("--project override beats the .shipeasy binding", () => {
    const cfg = getGeneratedClient({}, "proj_override").getConfig() as { headers: Headers };
    expect(cfg.headers.get("X-Project-Id")).toBe("proj_override");
  });

  it("env credentials (SHIPEASY_CLI_TOKEN/PROJECT_ID) take precedence over the file", () => {
    process.env.SHIPEASY_CLI_TOKEN = "sdk_env";
    process.env.SHIPEASY_PROJECT_ID = "proj_env";
    expect(loadCredentials()?.cli_token).toBe("sdk_env");
    expect(loadCredentials()?.project_id).toBe("proj_env");
  });
});
