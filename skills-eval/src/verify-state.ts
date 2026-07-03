import type { EnvConfig } from "./prepare-env.js";

/**
 * Outcome verification: after a run, query the admin API and confirm the
 * resources the flow was supposed to create actually exist. This is a stronger
 * signal than tool calls — the agent might reach the right end state via a
 * slightly different tool path, and conversely a tool call can be attempted but
 * fail server-side. "Did the experiment/metric/event actually get created?" is
 * what we ultimately care about.
 */
export type StateType =
  | "events" | "metrics" | "experiments" | "flags" | "killswitches" | "alerts";

/** admin API list endpoint per resource type (flags are "gates" internally). */
const ENDPOINT: Record<StateType, string> = {
  events: "events",
  metrics: "metrics",
  experiments: "experiments",
  flags: "gates",
  killswitches: "killswitches",
  alerts: "alert-rules",
};

/** Per type, name-substrings that must exist after the run (case-insensitive). */
export type ExpectState = Partial<Record<StateType, string[]>>;

/** type → the resource names currently on the server. */
export type StateSnapshot = Partial<Record<StateType, string[]>>;

export interface StateResult {
  pass: boolean;
  /** Human-readable per-needle outcome for the report. */
  detail: string;
}

async function fetchNames(cfg: EnvConfig, type: StateType): Promise<string[]> {
  const url = `${cfg.baseUrl.replace(/\/$/, "")}/api/admin/${ENDPOINT[type]}`;
  // Retry transient failures — a local Next.js dev server recompiling under the
  // load of a just-finished agent run drops the odd connection (TypeError:
  // fetch failed). A read this cheap should not fail the whole outcome check.
  const res = await withRetry(() =>
    fetch(url, { headers: { "X-SDK-Key": cfg.token, "X-Project-Id": cfg.projectId } }),
  );
  if (!res.ok) return [];
  const body: unknown = await res.json();
  const arr: unknown[] = Array.isArray(body)
    ? body
    : Array.isArray((body as { data?: unknown[] })?.data)
      ? (body as { data: unknown[] }).data
      : [];
  return arr
    .map((x) => String((x as { name?: unknown })?.name ?? ""))
    .filter(Boolean);
}

/** Retry a fetch a few times with short backoff on transient network errors. */
async function withRetry(fn: () => Promise<Response>, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Names present before a case runs — lets the report flag new vs pre-existing. */
export async function snapshotState(cfg: EnvConfig, expect: ExpectState): Promise<StateSnapshot> {
  const out: StateSnapshot = {};
  for (const type of Object.keys(expect) as StateType[]) {
    out[type] = await fetchNames(cfg, type).catch(() => []);
  }
  return out;
}

/** Check every expected resource exists now; annotate new vs pre-existing. */
export async function verifyState(
  cfg: EnvConfig,
  expect: ExpectState,
  before: StateSnapshot,
): Promise<StateResult> {
  const parts: string[] = [];
  let pass = true;
  for (const type of Object.keys(expect) as StateType[]) {
    const needles = expect[type] ?? [];
    let now: string[];
    try {
      now = await fetchNames(cfg, type);
    } catch (err) {
      pass = false;
      parts.push(`${type}: fetch failed (${String(err).slice(0, 60)})`);
      continue;
    }
    for (const needle of needles) {
      const match = now.find((n) => n.toLowerCase().includes(needle.toLowerCase()));
      if (!match) {
        pass = false;
        parts.push(`${type}:"${needle}" MISSING`);
      } else {
        const isNew = !(before[type] ?? []).includes(match);
        parts.push(`${type}:${match}${isNew ? " (new)" : " (existing)"}`);
      }
    }
  }
  return { pass, detail: parts.join(", ") };
}
