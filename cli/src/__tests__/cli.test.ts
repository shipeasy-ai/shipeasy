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

  it("does not throw when the login subcommand is invoked", async () => {
    vi.resetModules();
    process.argv = ["node", "shipeasy", "login"];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(import("../index")).resolves.toBeDefined();
    consoleSpy.mockRestore();
  });
});
