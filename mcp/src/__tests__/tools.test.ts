import { describe, it, expect, vi, afterEach } from "vitest";

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

// Capturing fetch for the generated (hey-api) client. hey-api builds a `Request`
// and reads a real `Response` (headers.get / .json()), so unlike `mockFetch`
// above we hand back an actual Response and record the parsed request body so a
// test can assert the wire shape the generated dispatch produced.
function captureFetch(responder: (req: Request) => unknown = () => ({})) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = vi.fn(async (input: Request | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    let body: unknown;
    try {
      const text = await req.clone().text();
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    calls.push({ url: req.url, method: req.method, body });
    return new Response(JSON.stringify(responder(req) ?? {}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { fn, calls };
}

// ── generated catalog ────────────────────────────────────────────────────────

// The whole CRUD/read surface is now projected from the spec (tags + x-cli) by
// scripts/gen-tools.mjs — the MCP twin of the CLI's generated command tree. The
// per-operation facade logic (goal-metric DSL, metric resolve-by-name, Slack
// channel resolution) moved server-side; the tool layer is a thin pass-through.
// Here we assert the catalog shape and that the dispatch hits the right endpoint
// with the right wire body.
describe("generated tool catalog", () => {
  it("exposes the spec-mirrored tool names (clean-break renames + new endpoints)", async () => {
    const { TOOLS } = await import("../tools/schema.js");
    const names = TOOLS.map((t) => t.name);
    // generated CRUD/read
    expect(names).toContain("release_flags_create");
    expect(names).toContain("release_killswitch_set");
    expect(names).toContain("release_configs_update_schema");
    expect(names).toContain("release_experiments_universes_create");
    expect(names).toContain("release_experiments_create");
    expect(names).toContain("metrics_create");
    expect(names).toContain("ops_alerts_create");
    expect(names).toContain("ops_notify");
    expect(names).toContain("projects_current");
    // clean-break renames (tag tree is the source of truth)
    expect(names).toContain("metrics_events_create"); // was events_create
    expect(names).toContain("release_flags_attributes_list"); // was attributes_list
    expect(names).toContain("ops_link_pr"); // was ops_link-pr
    // unified ops create + the per-type x-cli helpers over one endpoint
    expect(names).toContain("ops_create");
    expect(names).toContain("ops_bug");
    expect(names).toContain("ops_feature");
    // new spec endpoints the old MCP never exposed
    expect(names).toContain("release_experiments_results");
    expect(names).toContain("release_killswitch_get");
    // Errors tag — MCP-only read projection (CLI still skips it) so agent skills
    // can read tracked-error analytics; the two mutating error ops stay hidden.
    expect(names).toContain("errors_list");
    expect(names).toContain("errors_series");
    // custom (non-spec) sugar
    expect(names).toContain("metrics_grammar");
    expect(names).toContain("docs_get");
    // dropped / retired surface
    for (const gone of [
      "release_flags_rollout", // no rollout endpoint — use release_flags_update
      "events_create", // → metrics_events_create
      "attributes_list", // → release_flags_attributes_list
      "release_experiments_status", // → release_experiments_results
      "list_resources",
      "get_resource",
      "file_bug",
      "file_feature",
      "errors_update", // updateErrorStatus stays a dashboard concern (SKIP_OPS)
      "errors_file", // fileErrorTicket stays unprojected (SKIP_OPS)
      // Config draft/publish/versions/activity — kept in the spec but hidden
      // from the tool surface via x-cli.hidden (per-env publish flows through
      // release_configs_create/update instead).
      "release_configs_draft",
      "release_configs_discard_draft",
      "release_configs_publish",
      "release_configs_versions",
      "release_configs_activity",
    ]) {
      expect(names).not.toContain(gone);
    }
  });

  it("hands the hand-written projects_upsert (fs bind) priority over the generated one", async () => {
    const { GENERATED_DISPATCH } = await import("../tools/registry.js");
    // The generated upsertProject is excluded (OVERRIDDEN) so the static
    // .shipeasy-binding tool is the only projects_upsert in the catalog.
    expect(GENERATED_DISPATCH.projects_upsert).toBeUndefined();
    expect(GENERATED_DISPATCH.projects_current).toBeTypeOf("function");
  });
});

// ── generated dispatch (thin pass-through to the hey-api client) ─────────────

describe("generated dispatch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("dispatches release_flags_create to POST /api/admin/gates with the body", async () => {
    const { fn, calls } = captureFetch(() => ({ id: "gate-1", name: "my_gate" }));
    vi.stubGlobal("fetch", fn);
    const { GENERATED_DISPATCH } = await import("../tools/registry.js");
    const { getGeneratedClient } = await import("../tools/_gen-runtime.js");
    const handle = await getGeneratedClient();
    const data = await GENERATED_DISPATCH.release_flags_create(handle!.client, { name: "my_gate" });
    expect((data as { name: string }).name).toBe("my_gate");
    const post = calls.find((c) => c.url.includes("/api/admin/gates") && c.method === "POST");
    expect((post!.body as { name: string }).name).toBe("my_gate");
  });

  it("dispatches ops_create to POST /api/admin/ops carrying the type", async () => {
    const { fn, calls } = captureFetch(() => ({ id: "fb-1", number: 7 }));
    vi.stubGlobal("fetch", fn);
    const { GENERATED_DISPATCH } = await import("../tools/registry.js");
    const { getGeneratedClient } = await import("../tools/_gen-runtime.js");
    const handle = await getGeneratedClient();
    const data = await GENERATED_DISPATCH.ops_create(handle!.client, {
      type: "bug",
      title: "Checkout 500s on Safari",
    });
    expect((data as { number: number }).number).toBe(7);
    const post = calls.find((c) => c.url.includes("/api/admin/ops") && c.method === "POST");
    expect((post!.body as { type: string; title: string }).type).toBe("bug");
    expect((post!.body as { title: string }).title).toBe("Checkout 500s on Safari");
  });

  it("ops_bug presets type=bug from the x-cli command (no type arg needed)", async () => {
    const { fn, calls } = captureFetch(() => ({ id: "fb-2", number: 8 }));
    vi.stubGlobal("fetch", fn);
    const { GENERATED_DISPATCH } = await import("../tools/registry.js");
    const { getGeneratedClient } = await import("../tools/_gen-runtime.js");
    const handle = await getGeneratedClient();
    await GENERATED_DISPATCH.ops_bug(handle!.client, { title: "Bug via the bug helper" });
    const post = calls.find((c) => c.url.includes("/api/admin/ops") && c.method === "POST");
    expect((post!.body as { type: string }).type).toBe("bug");
  });
});

// ── custom (non-spec) tools ──────────────────────────────────────────────────

describe("custom tools", () => {
  it("metrics_grammar runs without a client and returns the grammar", async () => {
    const { CUSTOM_DISPATCH } = await import("../tools/registry.js");
    const result = await CUSTOM_DISPATCH.metrics_grammar({});
    expect(JSON.stringify(result).length).toBeGreaterThan(0);
  });
});

// ── i18n (now spec-generated, no longer hand-written) ─────────────────────────

describe("generated i18n tools", () => {
  it("projects the i18n admin surface from the spec (tag chain + x-cli verb)", async () => {
    const { TOOLS } = await import("../tools/schema.js");
    const names = TOOLS.map((t) => t.name);
    for (const n of [
      "i18n_profiles_list",
      "i18n_profiles_create",
      "i18n_profiles_publish",
      "i18n_keys_list",
      "i18n_keys_push",
      "i18n_keys_update",
      "i18n_keys_set",
      "i18n_drafts_list",
    ]) {
      expect(names).toContain(n);
    }
    // The old hand-written names are gone (clean-break rename).
    for (const gone of ["i18n_create_profile", "i18n_create_key", "i18n_set", "i18n_publish_profile"]) {
      expect(names).not.toContain(gone);
    }
  });

  it("dispatches i18n_keys_set to POST /api/admin/i18n/set with the body", async () => {
    const { fn, calls } = captureFetch(() => ({ ok: true, profile: "en:prod", key: "home.cta" }));
    vi.stubGlobal("fetch", fn);
    const { GENERATED_DISPATCH } = await import("../tools/registry.js");
    const { getGeneratedClient } = await import("../tools/_gen-runtime.js");
    const handle = await getGeneratedClient();
    await GENERATED_DISPATCH.i18n_keys_set(handle!.client, { key: "home.cta", value: "Get started" });
    const post = calls.find((c) => c.url.includes("/api/admin/i18n/set") && c.method === "POST");
    expect((post!.body as { key: string }).key).toBe("home.cta");
    vi.unstubAllGlobals();
  });
});

