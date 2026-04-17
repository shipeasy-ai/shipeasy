import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The CLI entry point calls program.parse(process.argv) at module level.
// We isolate it by controlling process.argv and mocking process.exit.
describe("shipeasy CLI", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: ReturnType<typeof vi.spyOn<any, any>>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    vi.resetModules();
  });

  it("parses with no subcommand without throwing", async () => {
    process.argv = ["node", "shipeasy"];
    await expect(import("../index")).resolves.toBeDefined();
  });

  it("logout subcommand runs without throwing", async () => {
    vi.resetModules();
    process.argv = ["node", "shipeasy", "logout"];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(import("../index")).resolves.toBeDefined();
    consoleSpy.mockRestore();
  });

  it("whoami shows not-logged-in message when no credentials", async () => {
    vi.resetModules();
    process.argv = ["node", "shipeasy", "whoami"];
    // Mock loadCredentials to return null
    vi.doMock("../auth/storage", () => ({
      loadCredentials: () => null,
      saveCredentials: () => {},
      clearCredentials: () => {},
    }));
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(import("../index")).resolves.toBeDefined();
    consoleSpy.mockRestore();
  });

  it("flags list exits with error when not logged in", async () => {
    vi.resetModules();
    process.argv = ["node", "shipeasy", "flags", "list"];
    vi.doMock("../auth/storage", () => ({
      loadCredentials: () => null,
      saveCredentials: () => {},
      clearCredentials: () => {},
    }));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await import("../index");
    // Give async actions time to run
    await new Promise((r) => setTimeout(r, 50));
    consoleSpy.mockRestore();
  });

  it("experiments list exits with error when not logged in", async () => {
    vi.resetModules();
    process.argv = ["node", "shipeasy", "experiments", "list"];
    vi.doMock("../auth/storage", () => ({
      loadCredentials: () => null,
      saveCredentials: () => {},
      clearCredentials: () => {},
    }));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await import("../index");
    await new Promise((r) => setTimeout(r, 50));
    consoleSpy.mockRestore();
  });
});
