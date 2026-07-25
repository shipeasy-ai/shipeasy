import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The CLI reads shipeasy's own module-rollout gates through @shipeasy/sdk's
// client entrypoint (the one that takes a public client key). These lock the
// properties that matter: the bound project goes out as `project_id` so a
// `project_id in [...]` gate rule whitelists the same projects the dashboard
// does; it must fail CLOSED (a blip can only hide a module, never offer an
// unreleased one); and it must only evaluate once per process.

const identify = vi.fn(async (_user: Record<string, unknown>) => {});
const getFlag = vi.fn((_name: string, dflt = false) => dflt);
const configureShipeasy = vi.fn((_opts: Record<string, unknown>) => ({ identify, getFlag }));

vi.mock("@shipeasy/sdk/client", () => ({
  configureShipeasy: (opts: Record<string, unknown>) => configureShipeasy(opts),
}));

const {
  fetchPlatformModuleGates,
  getPlatformModuleGates,
  platformClientKey,
  resetPlatformModuleGatesCache,
} = await import("../util/platform-gates");

describe("platform module gates", () => {
  beforeEach(() => {
    resetPlatformModuleGatesCache();
    identify.mockClear();
    getFlag.mockClear();
    configureShipeasy.mockClear();
    identify.mockImplementation(async () => {});
    getFlag.mockImplementation((_name: string, dflt = false) => dflt);
    process.env.SHIPEASY_PLATFORM_CLIENT_KEY = "sdk_client_test";
  });

  afterEach(() => {
    delete process.env.SHIPEASY_PLATFORM_CLIENT_KEY;
    resetPlatformModuleGatesCache();
  });

  it("evaluates translation_module for the bound project", async () => {
    getFlag.mockImplementation((name: string) => name === "translation_module");

    await expect(fetchPlatformModuleGates("proj-1")).resolves.toEqual({ translations: true });

    expect(configureShipeasy).toHaveBeenCalledWith(
      expect.objectContaining({ sdkKey: "sdk_client_test", baseUrl: "https://api.shipeasy.ai" }),
    );
    expect(identify).toHaveBeenCalledWith({ project_id: "proj-1" });
    expect(getFlag).toHaveBeenCalledWith("translation_module", false);
  });

  it("gate off → not rolled out", async () => {
    await expect(fetchPlatformModuleGates("proj-1")).resolves.toEqual({ translations: false });
  });

  it("fails closed when the evaluation throws", async () => {
    identify.mockImplementation(async () => {
      throw new Error("offline");
    });
    getFlag.mockImplementation(() => true);
    await expect(fetchPlatformModuleGates("proj-1")).resolves.toEqual({ translations: false });
  });

  it("no client key → not rolled out, and the SDK is never configured", async () => {
    // Empty (not deleted): `??` only falls back on null/undefined, so an empty
    // override is how a keyless build behaves.
    process.env.SHIPEASY_PLATFORM_CLIENT_KEY = "";

    expect(platformClientKey()).toBe("");
    await expect(fetchPlatformModuleGates("proj-1")).resolves.toEqual({ translations: false });
    expect(configureShipeasy).not.toHaveBeenCalled();
  });

  it("ships a baked-in platform client key", () => {
    // Without it every gated module reads as not-rolled-out for every user, and
    // the gate silently stops being consultable — blanking it must fail loudly.
    delete process.env.SHIPEASY_PLATFORM_CLIENT_KEY;
    expect(platformClientKey()).toMatch(/^sdk_client_/);
  });

  it("memoizes: many callers, one evaluation", async () => {
    getFlag.mockImplementation((name: string) => name === "translation_module");

    const all = await Promise.all([
      getPlatformModuleGates("proj-1"),
      getPlatformModuleGates("proj-1"),
      getPlatformModuleGates("proj-1"),
    ]);
    expect(all.every((g) => g.translations)).toBe(true);
    expect(identify).toHaveBeenCalledTimes(1);
  });
});
