import type { Command } from "commander";

export interface CliExample {
  /** The exact command line to run. */
  run: string;
  /** Optional one-line explanation, shown as a comment above the command. */
  note?: string;
}

// Keyed by the Command instance so we don't pollute Commander's own shape.
// Same module instance backs both the CLI and the docs generator (which imports
// `buildProgram`), so the registry is shared.
const REGISTRY = new WeakMap<Command, CliExample[]>();

/**
 * Attach usage examples to a command — the single source of truth for them.
 * They render in `shipeasy <cmd> --help` (via `addHelpText`) AND are read back
 * by `scripts/gen-cli-docs.ts` to emit an Examples code block in the docs, so
 * the two can never drift. Returns the command for chaining.
 */
export function withExamples(cmd: Command, examples: CliExample[]): Command {
  REGISTRY.set(cmd, examples);
  cmd.addHelpText("after", () => {
    const body = examples
      .map((e) => (e.note ? `  # ${e.note}\n  ${e.run}` : `  ${e.run}`))
      .join("\n\n");
    return `\nExamples:\n${body}`;
  });
  return cmd;
}

/** Examples attached to a command via `withExamples`, or `[]` if none. */
export function getExamples(cmd: Command): CliExample[] {
  return REGISTRY.get(cmd) ?? [];
}

/**
 * Render the full subtree of `root` as an indented list — every descendant
 * command down to the leaves, each with its one-line description and (when
 * present) a representative example. This is what makes `shipeasy <module>
 * --help` self-documenting: an agent runs it once and sees everything the
 * module can do without drilling into each subcommand.
 */
function renderTree(root: Command): string {
  const lines: string[] = ["", "Command tree:"];
  const walk = (cmd: Command, depth: number): void => {
    for (const sub of cmd.commands) {
      // Skip commander's implicit `help` subcommand.
      if (sub.name() === "help") continue;
      const indent = "  ".repeat(depth + 1);
      const aliases = sub.aliases?.() ?? [];
      const name = aliases.length ? `${sub.name()}|${aliases.join("|")}` : sub.name();
      const args = sub.registeredArguments
        ?.map((a) => (a.required ? `<${a.name()}>` : `[${a.name()}]`))
        .join(" ");
      const sig = args ? `${name} ${args}` : name;
      const desc = sub.description();
      lines.push(`${indent}${sig}${desc ? `  — ${desc}` : ""}`);
      const ex = getExamples(sub)[0];
      // Show only the first line of the example (multi-line examples use
      // backslash continuations that read poorly in a dense tree) — and drop
      // the trailing `\` so it doesn't look like a broken command.
      if (ex) {
        const firstLine = ex.run.split("\n")[0].replace(/\s*\\$/, "").trim();
        lines.push(`${indent}    e.g. ${firstLine}`);
      }
      walk(sub, depth + 1);
    }
  };
  walk(root, 0);
  return lines.join("\n");
}

/**
 * Turn `cmd` into a self-documenting module command: bare `shipeasy <cmd>`
 * prints its help, and `--help` appends the full descendant tree (see
 * `renderTree`). Use on the four module roots (`flags`, `metrics`, `ops`,
 * `i18n`) — the recursion covers everything nested beneath them. Returns the
 * command for chaining.
 */
export function withTreeHelp(cmd: Command): Command {
  cmd.addHelpText("after", () => renderTree(cmd));
  // No-arg invocation (`shipeasy flags`) shows the tree instead of erroring on
  // a missing subcommand. outputHelp() includes the `after` text above and does
  // not throw under exitOverride.
  cmd.action(() => cmd.outputHelp());
  return cmd;
}

export interface CliOutput {
  /**
   * A representative result value — what the command prints with `--json`.
   * Rendered as a pretty-printed JSON block in the docs "Returns" section.
   * Illustrative, not a strict contract.
   */
  json: unknown;
  /** Short qualifier shown beside the heading, e.g. "with --json". */
  note?: string;
}

const OUTPUTS = new WeakMap<Command, CliOutput>();

/**
 * Attach a representative return shape to a command. Read back by the docs
 * generator to render a "Returns" JSON block. Docs-only (unlike `withExamples`,
 * this does NOT touch `--help` — a JSON blob there is noise). Returns the
 * command for chaining.
 */
export function withOutput(cmd: Command, output: CliOutput): Command {
  OUTPUTS.set(cmd, output);
  return cmd;
}

/** Return shape attached via `withOutput`, or `null` if none. */
export function getOutput(cmd: Command): CliOutput | null {
  return OUTPUTS.get(cmd) ?? null;
}

const DETAILS = new WeakMap<Command, string>();

/**
 * Attach extra explanatory prose (markdown, may include links) rendered under
 * the one-line description in the generated docs. Docs-only — keeps `--help`
 * terse. Use it to explain a concept or point at a deeper docs page. Returns
 * the command for chaining.
 */
export function withDetails(cmd: Command, markdown: string): Command {
  DETAILS.set(cmd, markdown);
  return cmd;
}

/** Extra prose attached via `withDetails`, or `null` if none. */
export function getDetails(cmd: Command): string | null {
  return DETAILS.get(cmd) ?? null;
}
