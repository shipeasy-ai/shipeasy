import type { Command } from "commander";
import { ApiError } from "../api/client";
import { getGeneratedClient } from "../api/client";
import { printJson } from "../util/output";

/**
 * Runtime the generated command tree (`src/generated/commands.gen.ts`) is wired
 * against. The generated file is pure projection — all behaviour (group
 * creation, the binding guard, calling the generated sdk fn, unwrapping the
 * hey-api result, printing, error handling) lives here so it's hand-written and
 * testable. Custom commands in src/commands/ reuse the same helpers.
 */

/** hey-api's result envelope (response is absent on a network failure). */
type SdkResult = { data?: unknown; error?: unknown; response?: Response };

export interface GenCtx {
  run(opts: {
    /** Mutating commands require a bound project (or --project). */
    mutates: boolean;
    /** Calls a generated sdk fn with the configured client; returns its result. */
    invoke: (client: ReturnType<typeof getGeneratedClient>) => Promise<unknown>;
    /** Optional custom printer; defaults to JSON. */
    print?: (data: unknown) => void;
  }): Promise<void>;
}

/** The single ctx the generated tree + custom commands share. */
export const genCtx: GenCtx = {
  async run({ mutates, invoke, print }) {
    const client = getGeneratedClient({ requireBinding: mutates });
    try {
      const { data, error, response } = (await invoke(client)) as SdkResult;
      if (error || !response || !response.ok) {
        const body = error as { error?: string; code?: string } | undefined;
        const status = response?.status ?? 0;
        throw new ApiError(body?.error ?? `HTTP ${status}`, status, body?.code);
      }
      (print ?? printJson)(data);
    } catch (e) {
      if (e instanceof ApiError) console.error(`Error (${e.status}): ${e.message}`);
      else console.error(String(e));
      process.exit(1);
    }
  },
};

/** Create-or-get a nested command group, with the tag description as help. */
export function defineGroup(
  parent: Command,
  name: string,
  meta: { summary: string; help?: string; aliases?: string[] },
): Command {
  const existing = parent.commands.find((c) => c.name() === name);
  if (existing) return existing;
  const cmd = parent.command(name).description(meta.summary);
  if (meta.aliases?.length) for (const a of meta.aliases) cmd.alias(a);
  if (meta.help) cmd.addHelpText("after", `\n${meta.help}\n`);
  return cmd;
}

// ── option coercion (string flag value → typed body/query field) ────────────
// Each returns `undefined` when the flag was not supplied, so `clean()` drops it.
export const str = (v: unknown): string | undefined => (v === undefined ? undefined : String(v));
export const num = (v: unknown): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (Number.isNaN(n)) throw new ApiError(`expected a number, got "${String(v)}"`, 400);
  return n;
};
export const bool = (v: unknown): boolean | undefined => {
  if (v === undefined) return undefined;
  const s = String(v).toLowerCase();
  if (["true", "1", "yes", "on"].includes(s)) return true;
  if (["false", "0", "no", "off"].includes(s)) return false;
  throw new ApiError(`expected true|false, got "${String(v)}"`, 400);
};
export const json = (v: unknown): unknown => {
  if (v === undefined) return undefined;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    throw new ApiError(`expected JSON, got "${v}"`, 400);
  }
};

/**
 * Drop undefined keys (so optional flags don't send `undefined`) and erase the
 * static type: the body/query is assembled from runtime-coerced CLI flags, which
 * can't be statically reconciled with the strict generated request types — the
 * server (and the generated zod) validate it. Returns `never` so it satisfies
 * any sdk-fn body/query parameter.
 */
export function clean(obj: Record<string, unknown>): never {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as unknown as never;
}
