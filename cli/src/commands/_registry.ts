import type { Command } from "commander";
import {
  mountOperations,
  opId,
  type Operation,
  type OpInput,
  type CliContext,
} from "@shipeasy/openapi";
import { ApiError, getAdminClient } from "../api/client";
import { printJson } from "../util/output";
import { withExamples } from "../util/examples";

/**
 * Shared plumbing for mounting a registry `Operation[]` onto a commander node.
 * Every full-surface module (metrics, events, ops, projects, docs, attributes)
 * reuses this so the binding guard, JSON output, and error handling live once.
 * `commands/release.ts` predates this and keeps its own richer variant.
 */

export function handleError(e: unknown): never {
  if (e instanceof ApiError) console.error(`Error (${e.status}): ${e.message}`);
  else console.error(String(e));
  process.exit(1);
}

export type PrintResult = (op: Operation, data: unknown, input: OpInput) => void;

export function makeCtx(printResult: PrintResult): CliContext {
  return {
    getClient: ({ mutates, projectOverride }) =>
      getAdminClient(projectOverride, { requireBinding: mutates }),
    printJson,
    printResult,
    onError: handleError,
  };
}

/**
 * Mount `ops` onto `node` from the registry, then re-attach each op's CLI-only
 * `--help` examples to the generated subcommand.
 */
export function mountResource(node: Command, ops: Operation[], printResult: PrintResult): void {
  mountOperations(node, ops, makeCtx(printResult));
  for (const op of ops) {
    const cmd = node.commands.find((c) => c.name() === op.name);
    if (cmd && op.examples?.length) withExamples(cmd, op.examples);
  }
}

export { opId };
