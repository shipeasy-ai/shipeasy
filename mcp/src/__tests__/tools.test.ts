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

// Mutating tools refuse to run unless the cwd is bound to a project via a
// `.shipeasy` file. Pretend cwd is bound to `proj-1` so the existing tests
// — which exercise the happy path of every mutating tool — keep passing.
// `notBound` returns `{ isError: true, ... }`; the case where binding is
// missing is covered explicitly in api-client tests.
vi.mock("../util/project-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../util/project-config.js")>();
  return {
    ...actual,
    getBoundProjectIdSync: vi.fn().mockReturnValue("proj-1"),
  };
});

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

// Faithful experiments-transport mock. `resolve(name)` first GETs
// `/experiments/<name>` — which 404s for a name in the real API (getExperiment
// matches on id only) — then falls back to the paginated `listAll` to find it
// by name. This mock reproduces that: name lookups 404, the list returns the
// `{ data, next_cursor }` page shape, and get-by-id / results / status POST
// return their fixtures.
function expFetch(opts: {
  detail: Record<string, unknown>;
  list?: Record<string, unknown>[];
  results?: unknown[];
  status?: Record<string, unknown>;
}) {
  const { detail, list = [detail], results = [], status } = opts;
  const id = detail.id as string;
  const j = (body: unknown, ok = true, st = 200) =>
    Promise.resolve({ ok, status: st, json: () => Promise.resolve(body) });
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes(`/experiments/${id}/status`)) return j(status ?? detail);
    if (url.includes("/results")) return j(results);
    if (new RegExp(`/experiments/${id}($|\\?)`).test(url)) return j(detail); // get by id
    if (/\/experiments\/[^/?]+$/.test(url)) return j({ error: "not found" }, false, 404); // by name → 404
    return j({ data: list, next_cursor: null }); // listAll fallback
  });
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

// Gate / kill switch / config / universe tools are now generated from the
// shared operation registry (@shipeasy/openapi). The facade→wire mapping is
// unit-tested there; here we assert the registry tools are exposed and the
// dispatch resolves a gate-create through the typed admin client.
// Gate / kill switch / config / universe / experiment tools are now generated
// from the shared operation registry (@shipeasy/openapi). The facade→wire
// mapping (incl. the experiment goal-metric DSL, guardrails, and verdict) is
// unit-tested there; here we assert the catalog exposes them and the dispatch
// resolves through the typed admin client.
describe("registry-driven release tools", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exposes the renamed release_* tools in the catalog (incl. experiments)", async () => {
    const { TOOLS } = await import("../tools/schema.js");
    const names = TOOLS.map((t) => t.name);
    expect(names).toContain("release_flags_create");
    expect(names).toContain("release_killswitch_set");
    expect(names).toContain("release_configs_publish");
    expect(names).toContain("release_experiments_universes_create");
    expect(names).toContain("release_experiments_create");
    expect(names).toContain("release_experiments_status");
    // old exp_* names are gone (alert rules excepted — ops module)
    expect(names).not.toContain("exp_create_gate");
    expect(names).not.toContain("exp_create_experiment");
  });

  it("dispatches release_flags_create through the admin client", async () => {
    vi.stubGlobal("fetch", mockFetch({ "/api/admin/gates": { id: "gate-1", name: "my_gate" } }));
    const { REGISTRY_DISPATCH } = await import("../tools/registry.js");
    const { getAdminClient } = await import("../util/api-client.js");
    const handle = await getAdminClient();
    const data = await REGISTRY_DISPATCH.release_flags_create(handle!.client, {
      name: "my_gate",
      rollout: 50,
    });
    expect((data as { name: string }).name).toBe("my_gate");
  });

  it("dispatches release_experiments_create with an inline goal metric", async () => {
    const fetchMock = mockFetch({ "/api/admin/experiments": { id: "exp-1", name: "my_exp" } });
    vi.stubGlobal("fetch", fetchMock);
    const { REGISTRY_DISPATCH } = await import("../tools/registry.js");
    const { getAdminClient } = await import("../util/api-client.js");
    const handle = await getAdminClient();
    await REGISTRY_DISPATCH.release_experiments_create(handle!.client, {
      name: "my_exp",
      universe: "u-1",
      successEvent: "checkout_completed",
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.goal_metric).toEqual({ query: "count_users(checkout_completed)" });
  });
});

// ── full-surface registry tools (metrics / events / ops / docs / generic-read removal) ──

describe("full-surface registry catalog", () => {
  it("exposes the new module tools and drops the retired hand-written ones", async () => {
    const { TOOLS } = await import("../tools/schema.js");
    const names = TOOLS.map((t) => t.name);
    // new modules
    expect(names).toContain("metrics_create");
    expect(names).toContain("events_list");
    expect(names).toContain("ops_create");
    expect(names).toContain("ops_alerts_create");
    expect(names).toContain("ops_notify");
    expect(names).toContain("projects_current");
    expect(names).toContain("attributes_list");
    expect(names).toContain("docs_get");
    // retired tools are gone
    for (const gone of [
      "list_resources",
      "get_resource",
      "get_sdk_snippet",
      "exp_create_alert_rule",
      "file_bug",
      "file_feature",
    ]) {
      expect(names).not.toContain(gone);
    }
  });
});

describe("ops_alerts_create (registry)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves the metric by name + maps the Slack channel into the rule", async () => {
    const fetchMock = mockFetch({
      "/api/admin/metrics": [{ id: "met-1", name: "checkout_error_rate" }],
      "/api/admin/slack/channels": { connected: true, channels: [{ id: "C1", name: "incidents" }] },
      "/api/admin/alert-rules": { id: "ar-1" },
    });
    vi.stubGlobal("fetch", fetchMock);
    const { REGISTRY_DISPATCH } = await import("../tools/registry.js");
    const { getAdminClient } = await import("../util/api-client.js");
    const handle = await getAdminClient();
    const data = await REGISTRY_DISPATCH.ops_alerts_create(handle!.client, {
      name: "Checkout errors",
      metric: "checkout_error_rate",
      comparator: "gt",
      threshold: 0,
      slackChannel: "#incidents",
    });
    expect((data as { id: string }).id).toBe("ar-1");
    const postCall = fetchMock.mock.calls.find(
      (c) =>
        String(c[0]).includes("/api/admin/alert-rules") &&
        (c[1] as RequestInit | undefined)?.method === "POST",
    );
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.metricId).toBe("met-1");
    expect(body.notify.slackChannel).toEqual({ id: "C1", name: "incidents" });
  });
});

describe("ops_create (registry)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("files a bug through the bug endpoint", async () => {
    const fetchMock = mockFetch({ "/api/admin/bugs": { id: "fb-1", number: 7 } });
    vi.stubGlobal("fetch", fetchMock);
    const { REGISTRY_DISPATCH } = await import("../tools/registry.js");
    const { getAdminClient } = await import("../util/api-client.js");
    const handle = await getAdminClient();
    const data = await REGISTRY_DISPATCH.ops_create(handle!.client, {
      type: "bug",
      title: "Checkout 500s on Safari",
    });
    expect((data as { number: number }).number).toBe(7);
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
