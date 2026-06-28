import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Command } from "commander";
import { buildProgram } from "../index";

/** Every command path in the tree, e.g. ["flags", "list"]. Excludes the
 *  implicit `help` command commander generates. */
function collectPaths(cmd: Command, prefix: string[] = []): string[][] {
  const paths: string[][] = [];
  for (const sub of cmd.commands) {
    if (sub.name() === "help") continue;
    const p = [...prefix, sub.name()];
    paths.push(p);
    paths.push(...collectPaths(sub, p));
  }
  return paths;
}

function allCommands(cmd: Command, prefix: string[] = []): { path: string[]; cmd: Command }[] {
  const out: { path: string[]; cmd: Command }[] = [];
  for (const sub of cmd.commands) {
    if (sub.name() === "help") continue;
    const p = [...prefix, sub.name()];
    out.push({ path: p, cmd: sub });
    out.push(...allCommands(sub, p));
  }
  return out;
}

const program = buildProgram();
const paths = collectPaths(program)
  .map((p) => p.join(" "))
  .sort();
const commandPaths = allCommands(program).map(({ path }) => path);

describe("command tree", () => {
  // This snapshot is the registry of every command the CLI ships. Adding,
  // removing, or renaming a command must be an intentional snapshot update —
  // that's the point: it tracks the full surface so nothing drifts silently.
  it("matches the registered command surface (snapshot)", () => {
    expect(paths).toMatchSnapshot();
  });

  it("registers the expected top-level commands", () => {
    const top = program.commands.map((c) => c.name()).filter((n) => n !== "help");
    for (const name of [
      "login",
      "logout",
      "whoami",
      "bind",
      "setup",
      "detect",
      "projects",
      "mcp",
      "release",
      "metrics",
      "ops",
      "i18n",
      "docs",
    ]) {
      expect(top).toContain(name);
    }
  });

  it("exposes exactly the core + four-module top level (no stray commands)", () => {
    const top = program.commands.map((c) => c.name()).filter((n) => n !== "help");
    // The full top-level surface — core commands plus the four module roots.
    // Anything else (promoted into a module or removed) must not appear here.
    expect([...top].sort()).toEqual(
      [
        "login",
        "logout",
        "whoami",
        "bind",
        "setup",
        "detect",
        "projects",
        "mcp",
        "release",
        "metrics",
        "ops",
        "i18n",
        "docs",
      ].sort(),
    );
    // Spot-check the commands that live nested inside a module (not top-level):
    // the release resources, attributes (now `release flags attributes`), the
    // ops/alerts split, and the i18n-nested fs commands.
    for (const gone of [
      "killswitch",
      "experiments",
      "configs",
      "universes",
      "attributes",
      "events",
      "feedback",
      "connectors",
      "alert-rules",
      "alerts",
      "keys",
      "codemod",
      "modules",
      "scan",
    ]) {
      expect(top).not.toContain(gone);
    }
  });

  it("every command has a non-empty description", () => {
    const missing = allCommands(program)
      .filter(({ cmd }) => !cmd.description() || cmd.description().trim().length === 0)
      .map(({ path }) => path.join(" "));
    expect(missing).toEqual([]);
  });

  it("has no duplicate sibling command names", () => {
    const check = (cmd: Command, prefix: string): void => {
      const names = cmd.commands.map((c) => c.name());
      const dupes = names.filter((n, i) => names.indexOf(n) !== i);
      expect(dupes, `duplicate under "${prefix || "<root>"}"`).toEqual([]);
      for (const sub of cmd.commands) check(sub, `${prefix} ${sub.name()}`.trim());
    };
    check(program, "");
  });
});

describe("every command renders --help", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let outSpy: ReturnType<typeof vi.spyOn<any, any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let errSpy: ReturnType<typeof vi.spyOn<any, any>>;

  beforeAll(() => {
    // --help writes the help text and (under exitOverride) throws
    // `commander.helpDisplayed`. Silence the output so the suite stays readable.
    outSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });
  afterAll(() => {
    outSpy.mockRestore();
    errSpy.mockRestore();
  });

  it.each(commandPaths.map((p) => [p.join(" "), p] as const))(
    "`shipeasy %s --help`",
    async (_label, path) => {
      const prog = buildProgram();
      let code: string | undefined;
      try {
        await prog.parseAsync(["node", "shipeasy", ...path, "--help"]);
      } catch (err) {
        code = (err as { code?: string }).code;
      }
      // A wired command short-circuits to help; anything else (bad option
      // definition, missing action wiring) would throw a different code.
      expect(code).toBe("commander.helpDisplayed");
    },
  );
});
