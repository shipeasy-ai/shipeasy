import { Command } from "commander";
import { getApiClient, ApiError } from "../api/client";
import { printTable, printJson } from "../util/output";
import { defineFeedbackResource, handleError, BUGS_SPEC, FEATURES_SPEC } from "./feedback";

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

// ── Unified feedback queue (bugs + features + auto-filed error/alert tickets) ──
//
// `ops.list`/`get`/`update`/`link-pr` are the commands `/shipeasy:ops:work`
// drives end-to-end. They hit the single `/api/admin/feedback` surface so the
// loop never has to curl, and they cover the `error`/`alert` ticket types that
// `ops.bugs`/`ops.features` (the per-type CLIs) don't.

const FEEDBACK_ENDPOINT = "/api/admin/feedback";
const FEEDBACK_TYPES = ["bug", "feature_request", "error", "alert"] as const;
const FEEDBACK_STATUSES = [
  "open",
  "triaged",
  "in_progress",
  "ready_for_qa",
  "resolved",
  "wont_fix",
] as const;
const FEEDBACK_PRIORITIES = ["nice_to_have", "medium", "high", "critical"] as const;
// Descending urgency rank for queue sorting (highest first; null/none last).
const PRIORITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, nice_to_have: 1 };

interface FeedbackQueueItem {
  id: string;
  number: number | null;
  type: string;
  title: string;
  status: string;
  priority: string | null;
  sourceRef?: string | null;
  createdAt: string;
  [key: string]: unknown;
}

/** Handle the user passes to get/update/link-pr — the per-project number or the
 *  full id. The admin API resolves either (resolveByHandle byNumber), so pass it
 *  straight through rather than fetching + prefix-matching. */
function feedbackPath(handle: string): string {
  return `${FEEDBACK_ENDPOINT}/${encodeURIComponent(handle)}`;
}

function defineUnifiedQueue(parent: Command): void {
  parent
    .command("ops.list")
    .description("List the unified operational queue (bugs + features + error/alert tickets)")
    .option("--type <type>", `Filter by type: ${FEEDBACK_TYPES.join("|")}|all`, "all")
    .option("--status <status>", `Filter by status: ${FEEDBACK_STATUSES.join("|")}|all`, "open")
    .option("--priority <priority>", `Filter by priority: ${FEEDBACK_PRIORITIES.join("|")}`)
    .option("--limit <n>", "Max rows", "200")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        if (opts.type !== "all" && !FEEDBACK_TYPES.includes(opts.type))
          throw new ApiError(`Invalid type: ${opts.type}`, 400);
        if (opts.priority && !FEEDBACK_PRIORITIES.includes(opts.priority))
          throw new ApiError(`Invalid priority: ${opts.priority}`, 400);
        const client = getApiClient(opts.project);
        const qs = new URLSearchParams({
          type: opts.type,
          status: opts.status,
          limit: String(opts.limit),
        });
        let items = await client.request<FeedbackQueueItem[]>(
          "GET",
          `${FEEDBACK_ENDPOINT}?${qs.toString()}`,
        );
        if (opts.priority) items = items.filter((i) => i.priority === opts.priority);
        // Queue order: priority desc, then oldest-first.
        items.sort(
          (a, b) =>
            (PRIORITY_RANK[b.priority ?? ""] ?? 0) - (PRIORITY_RANK[a.priority ?? ""] ?? 0) ||
            a.createdAt.localeCompare(b.createdAt),
        );
        if (opts.json) return printJson(items);
        if (!items.length) return void console.log("Queue is clear.");
        printTable(
          ["#", "Type", "Priority", "Status", "Title", "Created"],
          items.map((i) => [
            i.number != null ? `#${i.number}` : i.id.slice(0, 8),
            i.type,
            i.priority ?? "—",
            i.status,
            i.title.length > 56 ? `${i.title.slice(0, 53)}…` : i.title,
            i.createdAt,
          ]),
        );
      } catch (e) {
        handleError(e);
      }
    });

  parent
    .command("ops.get <handle>")
    .description("Show one queue item by number (#7 → 7) or id — any type")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (handle: string, opts) => {
      try {
        const client = getApiClient(opts.project);
        const full = await client.request<Record<string, unknown>>("GET", feedbackPath(handle));
        if (opts.json) return printJson(full);
        console.log(JSON.stringify(full, null, 2));
      } catch (e) {
        handleError(e);
      }
    });

  parent
    .command("ops.update <handle>")
    .description("Flip a queue item's status (any type) — and optionally its priority")
    .option("--status <status>", `New status: ${FEEDBACK_STATUSES.join("|")}`)
    .option("--priority <priority>", `New priority: ${FEEDBACK_PRIORITIES.join("|")}`)
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (handle: string, opts) => {
      try {
        const patch: Record<string, unknown> = {};
        if (opts.status) {
          if (!FEEDBACK_STATUSES.includes(opts.status))
            throw new ApiError(`Invalid status: ${opts.status}`, 400);
          patch.status = opts.status;
        }
        if (opts.priority) {
          if (!FEEDBACK_PRIORITIES.includes(opts.priority))
            throw new ApiError(`Invalid priority: ${opts.priority}`, 400);
          patch.priority = opts.priority;
        }
        if (Object.keys(patch).length === 0)
          throw new ApiError("Nothing to update — pass --status and/or --priority", 400);
        const client = getApiClient(opts.project, { requireBinding: true });
        const updated = await client.request<{ id: string }>("PATCH", feedbackPath(handle), patch);
        if (opts.json) return printJson(updated);
        const changed = Object.entries(patch)
          .map(([k, v]) => `${k} → ${v}`)
          .join(", ");
        console.log(`Updated ${handle}: ${changed}`);
      } catch (e) {
        handleError(e);
      }
    });

  parent
    .command("ops.link-pr <handle> <pr-number>")
    .description(
      "Link the PR that fixed a queue item (any type). Records connector_data.github.pr; ops-key safe.",
    )
    .option("--url <url>", "Explicit PR URL (recommended — required for error/alert tickets)")
    .option("--remove", "Unlink the PR instead of setting one")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (handle: string, prNumberArg: string, opts) => {
      try {
        const client = getApiClient(opts.project, { requireBinding: true });
        if (opts.remove) {
          const res = await client.request("POST", `${feedbackPath(handle)}/link-pr`, {
            prNumber: null,
          });
          if (opts.json) return printJson(res);
          return void console.log(`Unlinked PR from ${handle}.`);
        }
        const prNumber = Number(prNumberArg);
        if (!Number.isInteger(prNumber) || prNumber <= 0)
          throw new ApiError(`Invalid PR number: ${prNumberArg}`, 400);
        const body: Record<string, unknown> = { prNumber };
        if (opts.url) body.prUrl = opts.url;
        const res = await client.request("POST", `${feedbackPath(handle)}/link-pr`, body);
        if (opts.json) return printJson(res);
        console.log(`Linked PR #${prNumber} to ${handle}.`);
      } catch (e) {
        handleError(e);
      }
    });
}

// ── ops.notify — agent escalation to the bell ────────────────────────────────
//
// `/shipeasy:ops:work` fires this when an item can't be fixed in code and needs
// a human. It raises an `ops.attention` bell notification carrying a step-by-
// step guide (POST /api/admin/notifications, ops-key allow-listed, create-only).

const NOTIFY_ENDPOINT = "/api/admin/notifications";

/** Commander collector for a repeatable option (`--step a --step b`). */
function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

function defineNotify(parent: Command): void {
  parent
    .command("ops.notify")
    .description("Raise a 'needs your attention' bell notification (agent escalation, create-only)")
    .requiredOption("--title <text>", "One-line headline of what's blocked")
    .requiredOption("--summary <text>", "One sentence: why it can't be fixed in code")
    .option("--step <text>", "A step the human should take (repeatable, ordered)", collect, [])
    .option("--href <path>", "Dashboard-relative deep link to the related item")
    .option("--item <number>", "Queue item this is about — sets a stable dedupe key (feedback:<n>)")
    .option("--key <dedupe>", "Explicit dedupe key (overrides --item); re-runs collapse to one row")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        const dedupeKey =
          opts.key ?? (opts.item ? `feedback:${String(opts.item).replace(/^#/, "")}` : undefined);
        const payload: Record<string, unknown> = {
          title: opts.title,
          summary: opts.summary,
          steps: opts.step ?? [],
        };
        if (opts.href) payload.href = opts.href;
        if (dedupeKey) payload.dedupeKey = dedupeKey;
        const client = getApiClient(opts.project, { requireBinding: true });
        const res = await client.request<{ dedupeKey: string; dispatched: boolean }>(
          "POST",
          NOTIFY_ENDPOINT,
          payload,
        );
        if (opts.json) return printJson(res);
        console.log(
          res.dispatched
            ? `Raised notification: ${opts.title}`
            : `Already raised (deduped on ${res.dedupeKey}) — no new row.`,
        );
      } catch (e) {
        handleError(e);
      }
    });
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

  // The one write errors support: status (open/resolved/ignored). A resolved
  // error reopens automatically if it recurs, so flipping it after a fix lands
  // is safe pre-deploy. Ops-key allow-listed.
  group
    .command("update <id>")
    .description(`Set a tracked error's status: ${ERROR_STATUSES.join("|")}`)
    .requiredOption("--status <status>", `New status: ${ERROR_STATUSES.join("|")}`)
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (id: string, opts) => {
      try {
        if (!ERROR_STATUSES.includes(opts.status))
          throw new ApiError(`Invalid status: ${opts.status}`, 400);
        const client = getApiClient(opts.project, { requireBinding: true });
        const items = await client.request<ErrorItem[]>("GET", ERRORS_ENDPOINT);
        const match = findByIdOrPrefix(items, id);
        if (!match) throw new ApiError(`Error not found: ${id}`, 404);
        const updated = await client.request<Record<string, unknown>>(
          "PATCH",
          `${ERRORS_ENDPOINT}/${match.id}`,
          { status: opts.status },
        );
        if (opts.json) return printJson(updated);
        console.log(`Updated ${match.id.slice(0, 8)}: status → ${opts.status}`);
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
      console.log("ops — operational CLIs. Reference a command explicitly:");
      console.log("");
      console.log("  shipeasy ops.list                The unified queue (bugs+features+tickets)");
      console.log("  shipeasy ops.get <handle>        Show one queue item (#number or id)");
      console.log("  shipeasy ops.update <handle>     Flip an item's status/priority (any type)");
      console.log("  shipeasy ops.link-pr <h> <n>     Link the PR that fixed an item");
      console.log("  shipeasy ops.notify              Raise a bell notification (escalation)");
      console.log("  shipeasy ops.bugs <command>      Bug reports (mirrors `feedback bugs`)");
      console.log(
        "  shipeasy ops.features <command>  Feature requests (mirrors `feedback features`)",
      );
      console.log(
        "  shipeasy ops.errors <command>    Tracked production errors (list, get, update)",
      );
      console.log("");
      console.log("Run `shipeasy ops.<name> --help` to see a sub-CLI's commands.");
    });

  // The unified queue (`ops.list`/`get`/`update`/`link-pr`) over /api/admin/feedback.
  defineUnifiedQueue(parent);
  // ops.notify — raise a bell notification when a fix isn't in code.
  defineNotify(parent);
  // bugs/features mirror the existing feedback CLIs, registered flat as
  // `ops.bugs` / `ops.features`.
  defineFeedbackResource(parent, { ...BUGS_SPEC, command: "ops.bugs" });
  defineFeedbackResource(parent, { ...FEATURES_SPEC, command: "ops.features" });
  defineErrorsResource(parent);
}
