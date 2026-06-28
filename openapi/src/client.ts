/**
 * `@shipeasy/openapi/client` — the generated, typed admin SDK.
 *
 * Re-exports every per-operation function (`createGate`, `listExperiments`, …),
 * the bundled fetch `client`, and `createClient`/`createConfig` for callers that
 * want an isolated client instance. Plus `configure()`, the one-call helper that
 * points the default client at a base URL and injects admin auth.
 *
 * This is generated from the hand-authored `spec/` tree — never hand-edit
 * `src/generated`. Regenerate with `pnpm gen`.
 */
export * from "./generated/sdk.gen.js";
export { client, type CreateClientConfig } from "./generated/client.gen.js";
export {
  createClient,
  // Aliased: the bare `createConfig` name belongs to the `createConfig`
  // operation (POST /configs) re-exported above via `sdk.gen`. This is hey-api's
  // client-config builder.
  createConfig as createClientConfig,
  type Client,
  type Config,
  type Options,
  type RequestResult,
} from "./generated/client/index.js";

import { client } from "./generated/client.gen.js";

export interface ConfigureOptions {
  /** Admin SDK key — sent as `Authorization: Bearer <apiKey>`. */
  apiKey: string;
  /** Project to scope every request to — sent as the `X-Project-Id` header. */
  projectId?: string;
  /** Override the API origin (defaults to `https://shipeasy.ai`). */
  baseUrl?: string;
}

/**
 * Point the default `client` at an environment and attach admin auth. Call once
 * at startup; every generated SDK function then carries the bearer key and the
 * `X-Project-Id` scope. Pass a per-call `{ client }` to talk to a different
 * project without re-configuring the global.
 */
export function configure({ apiKey, projectId, baseUrl }: ConfigureOptions): void {
  client.setConfig({
    ...(baseUrl ? { baseUrl } : {}),
    auth: () => apiKey,
    headers: projectId ? { "X-Project-Id": projectId } : {},
  });
}
