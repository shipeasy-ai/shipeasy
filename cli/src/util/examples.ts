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
