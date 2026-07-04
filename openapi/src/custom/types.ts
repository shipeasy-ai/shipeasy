/**
 * The custom-operations registry — hand-written operations that are NOT admin
 * API endpoints (so they can't be generated from the spec): the metric-DSL
 * grammar (pure) and the SDK-docs fetcher (outbound `fetch` to GitHub Pages).
 *
 * It mirrors the old operations registry in spirit, but is deliberately tiny and
 * framework-agnostic: each `CustomOp` carries its command path, params, and a
 * self-contained `run`. Both consumers project it with a thin adapter — the CLI
 * (`commands/custom.ts`) and, later, the MCP server — so the surface stays in
 * sync across them. `run` never touches the filesystem, so it's worker-safe.
 */
export type CustomParamType = "string" | "number" | "boolean";

export interface CustomParam {
  name: string;
  type: CustomParamType;
  description?: string;
  required?: boolean;
  /** Render as a positional CLI argument (vs a `--flag`). */
  positional?: boolean;
  enum?: string[];
}

export interface CustomOp {
  /** Command path, e.g. `["docs"]` → `shipeasy docs <name>`, `["metrics"]` → `metrics <name>`. */
  group: string[];
  /** Verb. */
  name: string;
  summary: string;
  description?: string;
  params: CustomParam[];
  examples?: { note?: string; run: string }[];
  /** Self-contained handler. `args` are the coerced param values. */
  run: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

/**
 * Group-level help for a custom-op command group (e.g. `docs`). Mirrors what an
 * OpenAPI tag carries for the generated tree — a short `summary` (shown in the
 * parent `--help` list) and a long `description` (shown on the group's own
 * `--help`). Consumers look this up by `group` path when creating the group so a
 * custom group reads as richly as a spec-backed one, instead of the bare
 * `"<name> commands"` fallback.
 */
export interface CustomGroup {
  /** Group path, e.g. `["docs"]`. */
  group: string[];
  summary: string;
  description?: string;
  aliases?: string[];
}

/** Thrown by a custom op for a user-facing error with an HTTP-ish status. */
export class CustomOpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "CustomOpError";
  }
}

export const opId = (op: CustomOp): string => [...op.group, op.name].join(".");
