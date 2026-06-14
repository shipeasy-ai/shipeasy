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
