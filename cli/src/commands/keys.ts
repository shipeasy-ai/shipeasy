import { Command } from "commander";
import { getApiClient, ApiError } from "../api/client";
import { printTable, printJson } from "../util/output";
import { withExamples } from "../util/examples";

interface KeyRow {
  id: string;
  type: "server" | "client" | "admin" | "ops";
  created_at: string;
  revoked_at: string | null;
  expires_at: string | null;
}

interface KeyCreated {
  id: string;
  type: "server" | "client" | "admin" | "ops";
  key: string;
  expires_at: string | null;
}

const VALID_TYPES = ["server", "client", "admin", "ops"] as const;
type KeyType = (typeof VALID_TYPES)[number];

function isKeyType(s: string): s is KeyType {
  return (VALID_TYPES as readonly string[]).includes(s);
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
          ["ID", "Type", "Created", "Expires", "Revoked"],
          rows.map((r) => [
            r.id.slice(0, 8),
            r.type,
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
    { run: "shipeasy keys list" },
    { note: "Machine-readable output", run: "shipeasy keys list --json" },
  ]);

  const keysCreate = keys
    .command("create")
    .description("Create a new SDK key. The raw token is shown ONCE — store it now.")
    .requiredOption("--type <type>", "Key type: server | client | admin | ops")
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
        const client = getApiClient(opts.project, { requireBinding: true });
        const created = await client.request<KeyCreated>("POST", "/api/admin/keys", {
          type: opts.type,
        });
        if (opts.json) return printJson(created);
        console.log(`Created ${created.type} key (id ${created.id.slice(0, 8)}):`);
        console.log("");
        console.log(`  ${created.key}`);
        console.log("");
        console.log("Store this token now — it cannot be retrieved again.");
        if (created.expires_at) console.log(`Expires: ${created.expires_at}`);
        if (opts.type === "client") {
          console.log("");
          console.log(
            "Public key — safe for browser/loader.js. Scoped to /sdk/evaluate + /collect.",
          );
        } else if (opts.type === "server") {
          console.log("");
          console.log("Private key — server-only. Never ship in a browser bundle.");
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
    { note: "Server key (private, server-only)", run: "shipeasy keys create --type server" },
    { note: "Public client key for the browser", run: "shipeasy keys create --type client" },
    { note: "Restricted ops key for the trigger", run: "shipeasy keys create --type ops" },
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
    { note: "Revoke by full id", run: "shipeasy keys revoke 7f3a9c10-2b4d-4e6f-8a1b-0c2d3e4f5a6b" },
    { note: "Revoke by id prefix (first match)", run: "shipeasy keys revoke 7f3a9c10" },
  ]);
}

function handleError(e: unknown): void {
  if (e instanceof ApiError) {
    console.error(`Error (${e.status}): ${e.message}`);
  } else {
    console.error(String(e));
  }
  process.exit(1);
}
