import { Command } from "commander";
import { getApiClient, ApiError } from "../api/client";
import { printTable, printJson } from "../util/output";
import {
  defineFeedbackResource,
  handleError,
  BUGS_SPEC,
  FEATURES_SPEC,
} from "./feedback";

// ── ops: a flat alias namespace ──────────────────────────────────────────────
//
// `ops` groups the operational read/triage surfaces behind a single, discover-
// able prefix. Unlike the nested `feedback bugs …` tree these are registered as
// *flat dotted* commands — `shipeasy ops.bugs`, `shipeasy ops.features`,
// `shipeasy ops.errors` — so each sub-CLI is referenced explicitly. Bare
// `shipeasy ops` is not itself runnable; it prints the index below.

interface ErrorItem {
  id: string;
  fingerprint: string;
  message: string;
  errorType: string | null;
  source: string | null;
  status: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  [key: string]: unknown;
}

const ERROR_STATUSES = ["open", "resolved", "ignored"] as const;
const ERRORS_ENDPOINT = "/api/admin/errors";

function findByIdOrPrefix(items: ErrorItem[], id: string): ErrorItem | undefined {
  return items.find((i) => i.id === id || i.id.startsWith(id));
}

/**
 * `ops.errors` — read-only view over auto-tracked production errors. Errors are
 * folded in by the ingestion path, never filed by hand, so only `list`/`get`
 * exist (no create/update/delete).
 */
function defineErrorsResource(parent: Command): void {
  const group = parent.command("ops.errors").description("Tracked production errors (read-only)");

  group
    .command("list")
    .description("List tracked errors (most-recently-seen first)")
    .option("--status <status>", `Filter by status: ${ERROR_STATUSES.join("|")}`)
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        const client = getApiClient(opts.project);
        let items = await client.request<ErrorItem[]>("GET", ERRORS_ENDPOINT);
        if (opts.status) {
          if (!ERROR_STATUSES.includes(opts.status))
            throw new ApiError(`Invalid status: ${opts.status}`, 400);
          items = items.filter((i) => i.status === opts.status);
        }
        if (opts.json) return printJson(items);
        if (!items.length) return void console.log("No errors found.");
        printTable(
          ["ID", "Type", "Message", "Source", "Count", "Status", "Last seen"],
          items.map((i) => [
            i.id.slice(0, 8),
            i.errorType ?? "—",
            i.message.length > 60 ? `${i.message.slice(0, 57)}…` : i.message,
            i.source ?? "—",
            String(i.count),
            i.status,
            i.lastSeenAt,
          ]),
        );
      } catch (e) {
        handleError(e);
      }
    });

  group
    .command("get <id>")
    .description("Show one tracked error by id (or id prefix)")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (id: string, opts) => {
      try {
        const client = getApiClient(opts.project);
        const items = await client.request<ErrorItem[]>("GET", ERRORS_ENDPOINT);
        const match = findByIdOrPrefix(items, id);
        if (!match) throw new ApiError(`Error not found: ${id}`, 404);
        const full = await client.request<Record<string, unknown>>(
          "GET",
          `${ERRORS_ENDPOINT}/${match.id}`,
        );
        if (opts.json) return printJson(full);
        console.log(JSON.stringify(full, null, 2));
      } catch (e) {
        handleError(e);
      }
    });
}

export function opsCommand(parent: Command): void {
  // Bare `ops` is an index, not a runnable command. Commander still needs it
  // registered so `shipeasy ops` resolves here instead of erroring out.
  parent
    .command("ops")
    .description("Operational CLIs — reference a sub-CLI explicitly (see `shipeasy ops`)")
    .action(() => {
      console.log("ops — operational CLIs. Reference a sub-CLI explicitly:");
      console.log("");
      console.log("  shipeasy ops.bugs <command>      Bug reports (mirrors `feedback bugs`)");
      console.log(
        "  shipeasy ops.features <command>  Feature requests (mirrors `feedback features`)",
      );
      console.log("  shipeasy ops.errors <command>    Tracked production errors (list, get)");
      console.log("");
      console.log("Run `shipeasy ops.<name> --help` to see a sub-CLI's commands.");
    });

  // bugs/features mirror the existing feedback CLIs, registered flat as
  // `ops.bugs` / `ops.features`.
  defineFeedbackResource(parent, { ...BUGS_SPEC, command: "ops.bugs" });
  defineFeedbackResource(parent, { ...FEATURES_SPEC, command: "ops.features" });
  defineErrorsResource(parent);
}
