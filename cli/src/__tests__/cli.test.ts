import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `run()` parses a synthetic argv and dispatches; `buildProgram()` just wires
// the tree. Neither auto-runs on import, so we drive them explicitly here.
const NULL_STORAGE = {
  loadCredentials: () => null,
  saveCredentials: () => {},
  clearCredentials: () => {},
  API_BASE_URL: "https://api.test",
  APP_BASE_URL: "https://app.test",
};

describe("shipeasy CLI", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: ReturnType<typeof vi.spyOn<any, any>>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.resetModules();
    vi.doUnmock("../auth/storage");
  });

  it("builds the program without throwing", async () => {
    const { buildProgram } = await import("../index");
    expect(() => buildProgram()).not.toThrow();
  });

  it("logout runs without throwing", async () => {
    const { run } = await import("../index");
    await expect(run(["node", "shipeasy", "logout"])).resolves.toBeUndefined();
  });

  // Auth-requiring commands must fail closed (never silently no-op) when there
  // is no session. Each should surface an error and request exit(1). `whoami`
  // is now the registry-generated alias of `projects current` (it resolves the
  // project from the auth header), so it fails closed like the rest.
  it.each([
    ["whoami"],
    ["release", "flags", "list"],
    ["release", "experiments", "list"],
    ["release", "configs", "list"],
    ["metrics", "list"],
    ["metrics", "events", "list"],
    ["sdk", "keys", "list"],
    ["ops", "list"],
    ["ops", "get", "7"],
    ["ops", "update", "7", "--status", "resolved"],
    ["ops", "link-pr", "7", "44", "--url", "https://github.com/a/b/pull/44"],
    ["ops", "alerts", "list"],
  ])("`%s` fails closed when not logged in", async (...argv: string[]) => {
    vi.resetModules();
    vi.doMock("../auth/storage", () => NULL_STORAGE);
    const { run } = await import("../index");
    await run(["node", "shipeasy", ...argv]);
    // gave up via process.exit(1) and/or printed an error
    const exited = exitSpy.mock.calls.some((c) => c[0] === 1);
    expect(exited || errSpy.mock.calls.length > 0).toBe(true);
  });
});
