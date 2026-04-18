import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Mock auth/config ────────────────────────────────────────────────────────

const FAKE_CONFIG = {
  project_id: "proj-1",
  cli_token: "tok",
  app_base_url: "https://app.test",
  api_base_url: "https://api.test",
  created_at: "2025-01-01",
};

vi.mock("../auth/config.js", () => ({
  readConfig: vi.fn().mockResolvedValue(FAKE_CONFIG),
  configPath: vi.fn().mockReturnValue("/tmp/shipeasy-test-config.json"),
  writeConfig: vi.fn().mockResolvedValue(undefined),
  clearConfig: vi.fn().mockResolvedValue(true),
  defaultApiBaseUrl: vi.fn().mockReturnValue("https://api.test"),
  defaultAppBaseUrl: vi.fn().mockReturnValue("https://app.test"),
}));

// ── type helpers ────────────────────────────────────────────────────────────

type ToolResult = { content: Array<{ text: string }>; isError?: boolean };

// ── fetch mock ──────────────────────────────────────────────────────────────

function mockFetch(responses: Record<string, unknown>) {
  return vi.fn().mockImplementation((url: string, _opts?: RequestInit) => {
    // Find the first matching key
    for (const [pattern, body] of Object.entries(responses)) {
      if (url.includes(pattern)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(body),
        });
      }
    }
    return Promise.resolve({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: `Not found: ${url}` }),
    });
  });
}

function parseResult(result: ToolResult) {
  return JSON.parse(result.content[0].text);
}

// ── helpers ─────────────────────────────────────────────────────────────────

function makeTmp(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "shipeasy-tools-test-")));
}

function write(dir: string, file: string, content: string) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

// ── exp tools ───────────────────────────────────────────────────────────────

describe("handleCreateGate", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/api/admin/gates": { id: "gate-1", name: "my_gate" },
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("happy path — creates a gate", async () => {
    const { handleCreateGate } = await import("../tools/exp/index.js");
    const result = await handleCreateGate({ name: "my_gate", rollout: 50 });
    expect((result as ToolResult).isError).toBeUndefined();
    const data = parseResult(result);
    expect(data.name).toBe("my_gate");
  });

  it("returns notAuthenticated when no config", async () => {
    const { readConfig } = await import("../auth/config.js");
    vi.mocked(readConfig).mockResolvedValueOnce(null);
    const { handleCreateGate } = await import("../tools/exp/index.js");
    const result = await handleCreateGate({ name: "my_gate" });
    expect((result as ToolResult).isError).toBe(true);
    expect(result.content[0].text).toContain("Not authenticated");
  });
});

describe("handleCreateExperiment", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/api/admin/experiments": { id: "exp-1", name: "my_exp" },
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("happy path — creates an experiment with default groups", async () => {
    const { handleCreateExperiment } = await import("../tools/exp/index.js");
    const result = await handleCreateExperiment({ name: "my_exp", universe: "u-1" });
    expect((result as ToolResult).isError).toBeUndefined();
    const data = parseResult(result);
    expect(data.name).toBe("my_exp");
  });

  it("parses custom groups from JSON string", async () => {
    const { handleCreateExperiment } = await import("../tools/exp/index.js");
    const groups = JSON.stringify([
      { name: "ctrl", weight: 3000, params: {} },
      { name: "treat_a", weight: 3000, params: {} },
      { name: "treat_b", weight: 4000, params: {} },
    ]);
    const result = await handleCreateExperiment({ name: "my_exp", universe: "u-1", groups });
    expect((result as ToolResult).isError).toBeUndefined();
  });
});

describe("handleStartExperiment / handleStopExperiment", () => {
  const experimentList = [
    {
      id: "exp-1",
      name: "my_exp",
      status: "draft",
      significance_threshold: 0.05,
      min_runtime_days: 0,
    },
  ];

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/api/admin/experiments/exp-1/status": { id: "exp-1", status: "running" },
        // GET /api/admin/experiments returns the list
        "/api/admin/experiments": experimentList,
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts an experiment by name", async () => {
    const { handleStartExperiment } = await import("../tools/exp/index.js");
    const result = await handleStartExperiment({ name: "my_exp" });
    expect((result as ToolResult).isError).toBeUndefined();
    const data = parseResult(result);
    expect(data.status).toBe("running");
  });

  it("stops an experiment by name", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/api/admin/experiments/exp-1/status": { id: "exp-1", status: "stopped" },
        "/api/admin/experiments": experimentList,
      }),
    );
    const { handleStopExperiment } = await import("../tools/exp/index.js");
    const result = await handleStopExperiment({ name: "my_exp" });
    expect((result as ToolResult).isError).toBeUndefined();
    const data = parseResult(result);
    expect(data.status).toBe("stopped");
  });

  it("includes promote_group note when specified", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/api/admin/experiments/exp-1/status": { id: "exp-1", status: "stopped" },
        "/api/admin/experiments": experimentList,
      }),
    );
    const { handleStopExperiment } = await import("../tools/exp/index.js");
    const result = await handleStopExperiment({ name: "my_exp", promote_group: "treatment" });
    const data = parseResult(result);
    expect(data.promote_group_note).toContain("treatment");
  });
});

describe("handleExperimentStatus", () => {
  const experimentList = [
    {
      id: "exp-1",
      name: "my_exp",
      status: "running",
      significance_threshold: 0.05,
      min_runtime_days: 7,
      started_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];

  afterEach(() => vi.unstubAllGlobals());

  it("returns wait verdict when no results", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/results")) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
        }
        if (url.includes("/api/admin/experiments/exp-1")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(experimentList[0]),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(experimentList),
        });
      }),
    );
    const { handleExperimentStatus } = await import("../tools/exp/index.js");
    const result = await handleExperimentStatus({ name: "my_exp" });
    const data = parseResult(result);
    expect(data.verdict).toBe("wait");
    expect(data.reason).toBe("no data yet");
  });

  it("returns ship verdict when p_value < threshold", async () => {
    const results = [{ group: "treatment", p_value: 0.01 }];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/results")) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(results) });
        }
        if (url.endsWith("/exp-1")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(experimentList[0]),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(experimentList),
        });
      }),
    );
    const { handleExperimentStatus } = await import("../tools/exp/index.js");
    const result = await handleExperimentStatus({ name: "my_exp" });
    const data = parseResult(result);
    expect(data.verdict).toBe("ship");
  });

  it("returns not_running when experiment is stopped", async () => {
    const stopped = { ...experimentList[0], status: "stopped" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/results")) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
        }
        if (url.endsWith("/exp-1")) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(stopped) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([stopped]) });
      }),
    );
    const { handleExperimentStatus } = await import("../tools/exp/index.js");
    const result = await handleExperimentStatus({ name: "my_exp" });
    const data = parseResult(result);
    expect(data.verdict).toBe("not_running");
  });
});

// ── list_resources ──────────────────────────────────────────────────────────

describe("handleListResources", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lists profiles", async () => {
    const profiles = [{ id: "p-1", name: "en:prod" }];
    vi.stubGlobal("fetch", mockFetch({ "/api/admin/i18n/profiles": profiles }));
    const { handleListResources } = await import("../tools/shared/list-resources.js");
    const result = await handleListResources({ kind: "profiles" });
    const data = parseResult(result);
    expect(data.count).toBe(1);
    expect(data.items[0].name).toBe("en:prod");
  });
});

// ── i18n profiles ───────────────────────────────────────────────────────────

describe("handleCreateProfile", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a profile", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({ "/api/admin/i18n/profiles": { id: "p-2", name: "fr:prod" } }),
    );
    const { handleCreateProfile } = await import("../tools/i18n/profiles.js");
    const result = await handleCreateProfile({ name: "fr:prod" });
    const data = parseResult(result);
    expect(data.name).toBe("fr:prod");
  });
});

// ── i18n keys ───────────────────────────────────────────────────────────────

describe("handleCreateKey", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a key in a profile", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/api/admin/i18n/profiles")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([{ id: "p-1", name: "en:prod" }]),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ pushed_count: 1, skipped_count: 0, failed_keys: [] }),
        });
      }),
    );
    const { handleCreateKey } = await import("../tools/i18n/keys.js");
    const result = await handleCreateKey({
      profile: "en:prod",
      key: "hello",
      value: "Hello World",
    });
    const data = parseResult(result);
    expect(data.pushed_count).toBe(1);
  });
});

// ── scan_code ────────────────────────────────────────────────────────────────

describe("handleScanCode", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmp();
    write(
      tmpDir,
      "App.tsx",
      `
export function App() {
  return (
    <div>
      <h1>Welcome to ShipEasy</h1>
      <button>Get Started</button>
    </div>
  );
}
`,
    );
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds JSX text candidates", async () => {
    const { handleScanCode } = await import("../tools/i18n/scan.js");
    const result = await handleScanCode({ paths: [tmpDir] });
    const data = parseResult(result);
    expect(data.total_candidates).toBeGreaterThan(0);
    expect(data.candidates.some((c: { text: string }) => c.text.includes("Welcome"))).toBe(true);
  });
});

// ── codemod ──────────────────────────────────────────────────────────────────

describe("handleCodemodPreview", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmp();
    write(
      tmpDir,
      "Button.tsx",
      `
export function Button() {
  return <button title="Click me">Submit Form</button>;
}
`,
    );
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns a diff without writing files", async () => {
    const { handleCodemodPreview } = await import("../tools/i18n/codemod.js");
    const result = await handleCodemodPreview({ framework: "react", files: [tmpDir] });
    const data = parseResult(result);
    expect(data.files_changed).toBe(1);
    expect(data.total_strings).toBeGreaterThan(0);
    expect(data.diffs[0].diff).toContain("---");
    // File should NOT be modified
    const fileContent = fs.readFileSync(path.join(tmpDir, "Button.tsx"), "utf8");
    expect(fileContent).toContain("Submit Form"); // original still there
  });
});

describe("handleCodemodApply", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = makeTmp();
    write(
      tmpDir,
      "Label.tsx",
      `
export function Label() {
  return <label aria-label="First name">First name</label>;
}
`,
    );
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("requires confirm: true", async () => {
    const { handleCodemodApply } = await import("../tools/i18n/codemod.js");
    const result = await handleCodemodApply({
      framework: "react",
      files: [tmpDir],
      confirm: false,
    });
    expect((result as ToolResult).isError).toBe(true);
    expect(result.content[0].text).toContain("confirm");
  });

  it("writes files and creates review JSON", async () => {
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      const { handleCodemodApply } = await import("../tools/i18n/codemod.js");
      const result = await handleCodemodApply({
        framework: "react",
        files: [tmpDir],
        confirm: true,
      });
      const data = parseResult(result);
      expect(data.files_changed).toBe(1);
      expect(data.review_file).toBe("i18n-codemod-review.json");

      // Review file should exist with key->value mapping
      const reviewPath = path.join(tmpDir, "i18n-codemod-review.json");
      expect(fs.existsSync(reviewPath)).toBe(true);
      const review = JSON.parse(fs.readFileSync(reviewPath, "utf8")) as Record<string, string>;
      expect(Object.keys(review).length).toBeGreaterThan(0);
    } finally {
      process.chdir(origCwd);
    }
  });
});
