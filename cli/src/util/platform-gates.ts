import { configureShipeasy } from "@shipeasy/sdk/client";
import { API_BASE_URL } from "../auth/storage";

/**
 * Module-rollout gates the CLI reads from **shipeasy's own** platform project.
 *
 * Some product modules ship behind a gate on the platform project (the same
 * switches the dashboard reads in `getModuleGates`), so a module can be held
 * back — or rolled out to named projects — without republishing the CLI.
 *
 * The CLI is not logged into that project, so it reads the gates the way any
 * customer app does: through `@shipeasy/sdk` with a **public client key**
 * (`sdk_client_…`) belonging to the platform project. Client keys are public by
 * design — the same key ships in the marketing landing's browser bundle. We use
 * the client entrypoint because that is the one that takes a client key; the
 * server entrypoint only ever accepts a server key, which must never be baked
 * into a published npm package.
 *
 * The bound project id is passed as the `project_id` attribute, exactly as the
 * dashboard passes the *viewed* project, so a gate rule like
 * `project_id in [...]` whitelists the same projects on both surfaces.
 *
 * DEFAULT-SAFE: no key, a failed evaluation, a timeout, or no network at all
 * resolves to "not rolled out". A blip can only ever hide an unreleased module,
 * never offer one — and the CLI never blocks on this for more than a few seconds.
 */

/**
 * The platform project's public client key, baked into the published binary.
 * Override with `SHIPEASY_PLATFORM_CLIENT_KEY` when pointing a dev build at a
 * different project. Empty ⇒ every gated module reads as not-rolled-out.
 */
const PLATFORM_CLIENT_KEY = "sdk_client_a3468e451b9a4a5db6f9b5ffdd47df05";

/** Gate names on the platform project. */
const TRANSLATION_MODULE_GATE = "translation_module";

/** How long we'll wait for the evaluation before falling back to hidden. */
const EVAL_TIMEOUT_MS = 4000;

export interface PlatformModuleGates {
  /** `translation_module` — whether the i18n module is offered at all. */
  translations: boolean;
}

const NOT_ROLLED_OUT: PlatformModuleGates = { translations: false };

/** Resolved key: env override first, then the baked-in constant. */
export function platformClientKey(): string {
  return (process.env.SHIPEASY_PLATFORM_CLIENT_KEY ?? PLATFORM_CLIENT_KEY).trim();
}

let cached: Promise<PlatformModuleGates> | null = null;

/** Read the module gates once per process (memoized). */
export function getPlatformModuleGates(projectId?: string): Promise<PlatformModuleGates> {
  cached ??= fetchPlatformModuleGates(projectId);
  return cached;
}

/** Uncached read — exported for tests; callers should use {@link getPlatformModuleGates}. */
export async function fetchPlatformModuleGates(projectId?: string): Promise<PlatformModuleGates> {
  const clientKey = platformClientKey();
  if (!clientKey) return NOT_ROLLED_OUT;
  try {
    const engine = configureShipeasy({
      sdkKey: clientKey,
      baseUrl: API_BASE_URL,
      // A CLI is not a page: no vitals/engagement collection, no exposure
      // events, no telemetry — just the one evaluation we asked for.
      autoGuardrails: false,
      disableAutoExposure: true,
      disableTelemetry: true,
    });
    // identify() performs the evaluation and resolves once the flags are in.
    await withTimeout(engine.identify(projectId ? { project_id: projectId } : {}));
    return { translations: engine.getFlag(TRANSLATION_MODULE_GATE, false) };
  } catch {
    return NOT_ROLLED_OUT;
  }
}

/** Reject once the budget is spent so a hung network can't stall the CLI. */
function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("gate evaluation timed out")), EVAL_TIMEOUT_MS).unref?.(),
    ),
  ]);
}

/** Reset the process memo (tests only). */
export function resetPlatformModuleGatesCache(): void {
  cached = null;
}
