import { Command } from "commander";
import { zCreateKeyRequest } from "@shipeasy/openapi/schemas";
import { getApiClient, ApiError, printApiError } from "../api/client";
import { printTable, printJson } from "../util/output";
import { withExamples } from "../util/examples";

interface KeyRow {
  id: string;
  type: "server" | "client" | "admin" | "ops";
  env?: string;
  created_at: string;
  revoked_at: string | null;
  expires_at: string | null;
}

interface KeyCreated {
  id: string;
  type: "server" | "client" | "admin" | "ops";
  env?: string;
  key: string;
  expires_at: string | null;
}

const VALID_TYPES = ["server", "client", "admin", "ops"] as const;
type KeyType = (typeof VALID_TYPES)[number];

function isKeyType(s: string): s is KeyType {
  return (VALID_TYPES as readonly string[]).includes(s);
}

const VALID_ENVS = ["dev", "staging", "prod"] as const;
type KeyEnv = (typeof VALID_ENVS)[number];

function isKeyEnv(s: string): s is KeyEnv {
  return (VALID_ENVS as readonly string[]).includes(s);
}

/**
 * Valid `--scopes` values, read straight from the OpenAPI `CreateKeyRequest`
 * schema (the single source of truth) so the CLI stays in lockstep with the
 * spec: add a scope to `spec/components/schemas/keys.yaml` and it shows up here
 * automatically. Falls back to `[]` (→ server-side validation only) if the
 * generated schema shape ever changes under us.
 */
function keyScopeOptions(): readonly string[] {
  try {
    const opts = zCreateKeyRequest.shape.scopes.unwrap().element.options;
    return Array.isArray(opts) ? (opts as string[]) : [];
  } catch {
    return [];
  }
}
const KEY_SCOPES = keyScopeOptions();

/** Parse + validate a `--scopes a,b,c` value against the spec's scope enum. */
function parseScopes(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const scopes = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!scopes.length) return undefined;
  if (KEY_SCOPES.length) {
    const unknown = scopes.filter((s) => !KEY_SCOPES.includes(s));
    if (unknown.length) {
      throw new ApiError(
        `Unknown scope(s): ${unknown.join(", ")}. Valid scopes: ${KEY_SCOPES.join(", ")}`,
        400,
      );
    }
  }
  return scopes;
}

/** GET /api/admin/keys returns a paginated `{ data: [...] }` envelope. */
function unwrapKeyRows(res: KeyRow[] | { data: KeyRow[] }): KeyRow[] {
  return Array.isArray(res) ? res : res.data;
}

export function keysCommand(parent: Command): void {
  const keys = parent
    .command("keys")
    .description("Manage SDK keys (server, client, admin, ops)");

  const keysList = keys
    .command("list")
    .description("List SDK keys for the current project")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        const client = getApiClient(opts.project);
        const rows = unwrapKeyRows(
          await client.request<KeyRow[] | { data: KeyRow[] }>("GET", "/api/admin/keys"),
        );
        if (opts.json) return printJson(rows);
        if (rows.length === 0) {
          console.log("No keys found.");
          return;
        }
        printTable(
          ["ID", "Type", "Env", "Created", "Expires", "Revoked"],
          rows.map((r) => [
            r.id.slice(0, 8),
            r.type,
            r.type === "server" || r.type === "client" ? (r.env ?? "—") : "—",
            r.created_at,
            r.expires_at ?? "—",
            r.revoked_at ?? "—",
          ]),
        );
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(keysList, [
    { run: "shipeasy sdk keys list" },
    { note: "Machine-readable output", run: "shipeasy sdk keys list --json" },
  ]);

  const keysCreate = keys
    .command("create")
    .description("Create a new SDK key. The raw token is shown ONCE — store it now.")
    .requiredOption("--type <type>", "Key type: server | client | admin | ops")
    .option(
      "--env <env>",
      "Environment the key is bound to: dev | staging | prod (required for server/client keys)",
    )
    .option("--name <name>", "Human label for the key (shown in the dashboard + audit logs)")
    .option(
      "--scopes <list>",
      KEY_SCOPES.length
        ? `Comma list of permission scopes: ${KEY_SCOPES.join(", ")}`
        : "Comma list of permission scopes",
    )
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        if (!isKeyType(opts.type)) {
          throw new ApiError(
            `Invalid --type '${opts.type}'. Must be one of: ${VALID_TYPES.join(", ")}`,
            400,
          );
        }
        // The read environment is derived from the key, so server/client keys
        // must declare which env they're bound to. admin/ops keys are
        // env-agnostic — the server pins them to prod — but the create endpoint
        // still REQUIRES an `env` field on every type, so we always send one
        // (defaulting the env-agnostic types to "prod").
        const needsEnv = opts.type === "server" || opts.type === "client";
        if (opts.env !== undefined && !isKeyEnv(opts.env)) {
          throw new ApiError(
            `Invalid --env '${opts.env}'. Must be one of: ${VALID_ENVS.join(", ")}`,
            400,
          );
        }
        if (needsEnv && !opts.env) {
          throw new ApiError(
            `--env is required for ${opts.type} keys (dev | staging | prod). ` +
              `The key reads only that environment.`,
            400,
          );
        }
        // admin/ops are pinned to prod server-side; still send `env` (required by
        // the endpoint) so the request validates.
        const env = opts.env ?? "prod";
        // `--scopes` is validated against the spec's scope enum; `--name` is a
        // free label. Both flow straight into the CreateKeyRequest body.
        const scopes = parseScopes(opts.scopes);
        const name = (opts.name as string | undefined)?.trim() || undefined;

        const client = getApiClient(opts.project, { requireBinding: true });
        const created = await client.request<KeyCreated>("POST", "/api/admin/keys", {
          type: opts.type,
          env,
          ...(name ? { name } : {}),
          ...(scopes ? { scopes } : {}),
        });
        if (opts.json) return printJson(created);
        console.log(`Created ${created.type} key (id ${created.id.slice(0, 8)}):`);
        console.log("");
        console.log(`  ${created.key}`);
        console.log("");
        console.log("Store this token now — it cannot be retrieved again.");
        if (name) console.log(`Name: ${name}`);
        if (created.env) console.log(`Environment: ${created.env}`);
        if (scopes?.length) console.log(`Scopes: ${scopes.join(", ")}`);
        if (created.expires_at) console.log(`Expires: ${created.expires_at}`);
        if (opts.type === "client") {
          console.log("");
          console.log(
            `Public key — safe for browser/loader.js. Scoped to /sdk/evaluate + /collect. ` +
              `Reads the '${created.env}' environment only (locked to this key).`,
          );
        } else if (opts.type === "server") {
          console.log("");
          console.log(
            `Private key — server-only. Never ship in a browser bundle. ` +
              `Reads the '${created.env}' environment (override per-request with ?env=).`,
          );
        } else if (opts.type === "ops") {
          console.log("");
          console.log(
            "Restricted ops key — read-only access to the bugs/features/errors/alerts " +
              "queue plus bug/feature status writes (no link-pr, no other admin). " +
              "Auto-extends its expiry on use; minted for the unattended Claude trigger.",
          );
        }
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(keysCreate, [
    {
      note: "Server key for production (private, server-only)",
      run: "shipeasy sdk keys create --type server --env prod",
    },
    {
      note: "Public client key for staging",
      run: "shipeasy sdk keys create --type client --env staging",
    },
    {
      note: "Named client key scoped to file public bug reports (CLI /cli/report)",
      run: 'shipeasy sdk keys create --type client --env prod --name "CLI main key" --scopes tickets:public_create',
    },
    { note: "Restricted ops key for the trigger", run: "shipeasy sdk keys create --type ops" },
  ]);

  const keysRevoke = keys
    .command("revoke <id>")
    .description("Revoke a key by id (or id prefix; first match wins)")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (idArg: string, opts) => {
      try {
        const client = getApiClient(opts.project, { requireBinding: true });
        const rows = unwrapKeyRows(
          await client.request<KeyRow[] | { data: KeyRow[] }>("GET", "/api/admin/keys"),
        );
        const match = rows.find((r) => r.id === idArg) ?? rows.find((r) => r.id.startsWith(idArg));
        if (!match) throw new ApiError(`No key found matching '${idArg}'`, 404);
        const result = await client.request<{ id: string; revoked: boolean }>(
          "POST",
          `/api/admin/keys/${match.id}/revoke`,
        );
        if (opts.json) return printJson(result);
        console.log(`Revoked ${match.type} key ${match.id.slice(0, 8)}.`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(keysRevoke, [
    { note: "Revoke by full id", run: "shipeasy sdk keys revoke 7f3a9c10-2b4d-4e6f-8a1b-0c2d3e4f5a6b" },
    { note: "Revoke by id prefix (first match)", run: "shipeasy sdk keys revoke 7f3a9c10" },
  ]);
}

function handleError(e: unknown): void {
  printApiError(e);
  process.exit(1);
}
