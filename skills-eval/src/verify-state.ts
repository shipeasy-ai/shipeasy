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
  | "events" | "metrics" | "experiments" | "flags" | "killswitches" | "alerts" | "ops";

/** admin API list endpoint per resource type (flags are "gates" internally). */
const ENDPOINT: Record<StateType, string> = {
  events: "events",
  metrics: "metrics",
  experiments: "experiments",
  flags: "gates",
  killswitches: "killswitches",
  alerts: "alert-rules",
  ops: "ops",
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
    .map((x) => {
      // Most resources have `name`; ops items (bugs/features) use title/summary.
      const o = x as { name?: unknown; title?: unknown; summary?: unknown };
      return String(o?.name ?? o?.title ?? o?.summary ?? "");
    })
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
export async function snapshotState(cfg: EnvConfig, ...expects: ExpectState[]): Promise<StateSnapshot> {
  const types = new Set<StateType>();
  for (const e of expects) for (const t of Object.keys(e) as StateType[]) types.add(t);
  const out: StateSnapshot = {};
  for (const type of types) out[type] = await fetchNames(cfg, type).catch(() => []);
  return out;
}

/** Minimal create bodies for the resource types `setup` can pre-create. */
const SETUP_BODY: Partial<Record<StateType, (name: string) => unknown>> = {
  flags: (name) => ({ name, enabled: true }),
  events: (name) => ({ name }),
};

/** Pre-create resources so a dedup case has something existing to (not) duplicate. */
export async function setupState(cfg: EnvConfig, setup: ExpectState): Promise<void> {
  for (const type of Object.keys(setup) as StateType[]) {
    const makeBody = SETUP_BODY[type];
    if (!makeBody) continue; // only flags/events are pre-creatable
    const existing = new Set(await fetchNames(cfg, type).catch(() => []));
    for (const name of setup[type] ?? []) {
      if (existing.has(name)) continue; // already there — leave it
      const url = `${cfg.baseUrl.replace(/\/$/, "")}/api/admin/${ENDPOINT[type]}`;
      await withRetry(() =>
        fetch(url, {
          method: "POST",
          headers: {
            "X-SDK-Key": cfg.token,
            "X-Project-Id": cfg.projectId,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(makeBody(name)),
        }),
      ).catch(() => undefined);
    }
  }
}

const countMatches = (names: string[], needle: string): number =>
  names.filter((n) => n.toLowerCase().includes(needle.toLowerCase())).length;

/** Verify no duplicate was created: match-count after ≤ before, and it exists. */
export async function verifyNoDuplicate(
  cfg: EnvConfig,
  expect: ExpectState,
  before: StateSnapshot,
): Promise<StateResult> {
  const parts: string[] = [];
  let pass = true;
  for (const type of Object.keys(expect) as StateType[]) {
    const now = await fetchNames(cfg, type).catch(() => []);
    for (const needle of expect[type] ?? []) {
      const b = countMatches(before[type] ?? [], needle);
      const a = countMatches(now, needle);
      if (a === 0) {
        pass = false;
        parts.push(`${type}:"${needle}" GONE`);
      } else if (a > b) {
        pass = false;
        parts.push(`${type}:"${needle}" DUPLICATED (${b}→${a})`);
      } else {
        parts.push(`${type}:"${needle}" not duplicated (${a})`);
      }
    }
  }
  return { pass, detail: parts.join(", ") };
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
    // Poll the admin read: a just-created resource can lag the list endpoint
    // (D1 write → KV rebuild → CDN purge propagation), so a single read right
    // after the run yields a FALSE "MISSING". Re-read a few times until every
    // expected needle appears, or the budget runs out.
    let now: string[] = [];
    let fetchErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        now = await fetchNames(cfg, type);
        fetchErr = undefined;
      } catch (err) {
        fetchErr = err;
      }
      const allFound =
        !fetchErr &&
        needles.every((nd) => now.some((n) => n.toLowerCase().includes(nd.toLowerCase())));
      if (allFound || attempt === 4) break;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
    if (fetchErr) {
      pass = false;
      parts.push(`${type}: fetch failed (${String(fetchErr).slice(0, 60)})`);
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
