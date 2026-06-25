import { Command } from "commander";
import { getApiClient, ApiError } from "../api/client";
import { printTable, printJson } from "../util/output";
import { handleError } from "./feedback";
import { alertRulesCommand } from "./alert-rules";
import { withExamples, withTreeHelp } from "../util/examples";

// ── ops: the operational module ──────────────────────────────────────────────
//
// `ops` groups the operational read/triage/fix surfaces under one parent. They
// are native nested subcommands (`shipeasy ops list`, `shipeasy ops update`,
// `shipeasy ops alerts`), so `shipeasy ops --help` prints the whole tree (via
// `withTreeHelp`) and an agent can discover them in one call. The unified queue
// (`ops list`/`get`/`update`) spans every ticket type — bugs, feature requests,
// and auto-filed error/alert tickets alike.

// ── Unified feedback queue (bugs + features + auto-filed error/alert tickets) ──
//
// `ops list`/`get`/`update`/`link-pr` are the commands `/shipeasy:ops:work`
// drives end-to-end. They hit the single `/api/admin/feedback` surface so the
// loop never has to curl, and they cover the `error`/`alert` ticket types that
// `ops bugs`/`ops features` (the per-type CLIs) don't.

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
  const opsList = parent
    .command("list")
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

  withExamples(opsList, [
    { note: "Open critical items only", run: "shipeasy ops list --priority critical" },
    { note: "Just error tickets", run: "shipeasy ops list --type error" },
  ]);

  const opsGet = parent
    .command("get <handle>")
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

  withExamples(opsGet, [
    { note: "By queue number", run: "shipeasy ops get 7" },
  ]);

  const opsUpdate = parent
    .command("update <handle>")
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

  withExamples(opsUpdate, [
    { note: "Resolve item #7", run: "shipeasy ops update 7 --status resolved" },
    { note: "Bump priority", run: "shipeasy ops update 7 --priority high" },
  ]);

  const opsLinkPr = parent
    .command("link-pr <handle> <pr-number>")
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

  withExamples(opsLinkPr, [
    {
      note: "Link the fixing PR (with URL)",
      run: "shipeasy ops link-pr 7 42 --url https://github.com/acme/app/pull/42",
    },
  ]);
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
  const opsNotify = parent
    .command("notify")
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

  withExamples(opsNotify, [
    {
      note: "Escalate a blocked item to the bell",
      run:
        'shipeasy ops notify --item 7 \\\n' +
        '  --title "Needs a DB migration" \\\n' +
        '  --summary "Fix requires a schema change I can\'t apply in code" \\\n' +
        '  --step "Add the column via wrangler d1 migrations" \\\n' +
        '  --step "Re-run the fixer"',
    },
  ]);
}

export function opsCommand(parent: Command): Command {
  const ops = parent.command("ops").description("Operational queue, tickets & alert rules");

  // The unified queue (`ops list`/`get`/`update`/`link-pr`) over /api/admin/feedback —
  // spans bugs, feature requests, and auto-filed error/alert tickets.
  defineUnifiedQueue(ops);
  // ops notify — raise a bell notification when a fix isn't in code.
  defineNotify(ops);
  // alert RULES (writable) live under ops as `ops alerts`.
  alertRulesCommand(ops);

  // `shipeasy ops --help` prints the full subtree; bare `shipeasy ops` shows it.
  withTreeHelp(ops);
  return ops;
}
