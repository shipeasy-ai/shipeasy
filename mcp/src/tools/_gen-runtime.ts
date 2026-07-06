import { createClient, createClientConfig, type Client } from "@shipeasy/openapi/client";
import { readConfig, type ShipeasyConfig } from "../auth/config.js";
import { getBoundProjectIdSync } from "../util/project-config.js";

/**
 * Runtime the generated tool tree (`src/generated/tools.gen.ts`) is wired
 * against — the MCP twin of the CLI's `src/commands/_gen-runtime.ts`. The
 * generated file is pure projection from the spec; all behaviour (client
 * construction, unwrapping the hey-api result, the binding guard) lives here so
 * it is hand-written and testable.
 *
 * The admin API authenticates the CLI/MCP token via the `X-SDK-Key` header (not
 * bearer) and scopes every request with `X-Project-Id`, exactly like the CLI.
 */

/** Uniform admin-API error thrown by `unwrap` and the custom ops. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** hey-api's result envelope (`response` is absent on a network failure). */
export type SdkResult = { data?: unknown; error?: unknown; response?: Response };

/** Throw `ApiError` on a non-2xx / network failure; otherwise return `data`. */
export function unwrap(result: SdkResult): unknown {
  const { data, error, response } = result;
  if (error || !response || !response.ok) {
    const body = error as { error?: string; code?: string } | undefined;
    const status = response?.status ?? 0;
    throw new ApiError(body?.error ?? `HTTP ${status}`, status, body?.code);
  }
  return data;
}

/**
 * Drop undefined keys (so omitted args don't send `undefined`) and erase the
 * static type: the body/query is assembled from runtime tool arguments, which
 * can't be statically reconciled with the strict generated request types — the
 * server (and the generated zod) validate it. Returns `never` so it satisfies
 * any sdk-fn body/query parameter.
 */
export function clean(obj: Record<string, unknown>): never {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as unknown as never;
}

/** Minimal view of a JSON Schema node — only what `reviveArg` inspects. */
type JsonSchemaNode = { type?: unknown; enum?: unknown };

const isStructuredType = (t: unknown): boolean =>
  t === "object" || t === "array" || (Array.isArray(t) && (t.includes("object") || t.includes("array")));

/**
 * Revive one argument an MCP host may have over-stringified. If the property
 * schema is structured (`object`/`array`), a JSON string is parsed back. If the
 * schema is freeform (no `type`, no `enum` — e.g. a config draft `value`), only
 * strings that unambiguously look like a JSON object/array literal are parsed,
 * so a plain scalar string (`"true"`, `"42"`, `"hello"`) is never coerced.
 */
function reviveArg(schema: JsonSchemaNode | undefined, v: string): unknown {
  const t = schema?.type;
  const structured = isStructuredType(t);
  const freeform = t === undefined && schema?.enum === undefined;
  if (!structured && !freeform) return v;
  const s = v.trim();
  if (!structured && !(s.startsWith("{") || s.startsWith("["))) return v;
  try {
    const parsed = JSON.parse(v);
    // A freeform value that parses to a scalar (e.g. the string "42") stays a
    // string — only a real container is a marshalling artefact worth reviving.
    if (!structured && (parsed === null || typeof parsed !== "object")) return v;
    return parsed;
  } catch {
    return v;
  }
}

/**
 * Undo the "known marshalling bug": some MCP hosts serialise a structured
 * (object/array) tool argument to a JSON string when the tool's JSON Schema
 * doesn't pin the property to `type: "object"`/`"array"`. The admin API then
 * rejects it (e.g. `saveConfigDraft` → "Config value must be a JSON object").
 * Walk the tool's declared properties and parse any such string back before it
 * reaches the wire. Returns the same object reference when nothing changed.
 */
export function reviveStructuredArgs(
  args: Record<string, unknown>,
  inputSchema: { properties?: Record<string, unknown> } | undefined,
): Record<string, unknown> {
  const props = inputSchema?.properties;
  if (!props) return args;
  let out: Record<string, unknown> | null = null;
  for (const [k, v] of Object.entries(args)) {
    if (typeof v !== "string") continue;
    const revived = reviveArg(props[k] as JsonSchemaNode | undefined, v);
    if (revived !== v) {
      out ??= { ...args };
      out[k] = revived;
    }
  }
  return out ?? args;
}

export interface ClientHandle {
  client: Client;
  cfg: ShipeasyConfig;
  /** Effective project_id used for `X-Project-Id` (binding-resolved). */
  projectId: string;
  /** True if a `.shipeasy` file in cwd (or an ancestor) supplied project_id. */
  bound: boolean;
}

/**
 * Resolve credentials + project scope and return a configured generated client
 * (`@shipeasy/openapi/client`). Returns `null` when not authenticated; the
 * server then returns `notAuthenticated()`. Mutating tools additionally require
 * a `.shipeasy` binding — the server enforces that with `GENERATED_MUTATES`.
 */
export async function getGeneratedClient(): Promise<ClientHandle | null> {
  const cfg = await readConfig();
  if (!cfg) return null;
  const bound = getBoundProjectIdSync(process.cwd());
  const projectId = bound ?? cfg.project_id;
  const client = createClient(
    createClientConfig({
      baseUrl: cfg.app_base_url.replace(/\/$/, ""),
      headers: { "X-SDK-Key": cfg.cli_token, "X-Project-Id": projectId },
    }),
  );
  return { client, cfg, projectId, bound: !!bound };
}
