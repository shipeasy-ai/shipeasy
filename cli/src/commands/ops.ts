import type { Command } from "commander";
import { opsOperations, opId, type Operation, type OpInput } from "@shipeasy/openapi";
import { printTable } from "../util/output";
import { withTreeHelp } from "../util/examples";
import { mountResource } from "./_registry";

/**
 * The `ops` module — the unified operational queue (bugs + feature requests +
 * auto-filed error/alert tickets) AND alert rules (`ops alerts …`). Every
 * subcommand is generated from the shared registry (`opsOperations`), so the
 * deleted hand-written `feedback`/`alert-rules` CLI modules and the MCP filing
 * tools all collapse to one definition.
 *
 * The CLI additionally mounts a per-type alias subtree (`ops bug …`,
 * `ops feature …`) — consumer-side only (it pre-binds the `--type` param), no
 * registry change. MCP stays flat with one `ops_*` set + a `type` arg.
 */

// ── human-readable output per op (the --json path is handled by the adapter) ──

interface QueueRow {
  id: string;
  number: number | null;
  type: string;
  title: string;
  status: string;
  priority: string | null;
  createdAt: string;
}

interface AlertRow {
  id: string;
  name: string;
  metricName?: string | null;
  metricId: string;
  comparator: string;
  threshold: number;
  windowHours: number;
  severity: string;
  enabled: boolean;
  updatedAt: string;
}

function printResult(op: Operation, data: unknown, input: OpInput): void {
  switch (opId(op)) {
    case "ops.list": {
      const items = data as QueueRow[];
      if (!items.length) return void console.log("Queue is clear.");
      return printTable(
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
    }
    case "ops.get":
      return void console.log(JSON.stringify(data, null, 2));
    case "ops.create": {
      const r = data as { id: string; number?: number | null };
      return void console.log(`Filed ${input.type}: ${input.title} (${r.number != null ? `#${r.number}` : r.id})`);
    }
    case "ops.update":
      return void console.log(`Updated ${input.handle}.`);
    case "ops.link-pr":
      return void console.log(input.remove ? `Unlinked PR from ${input.handle}.` : `Linked PR to ${input.handle}.`);
    case "ops.notify": {
      const r = data as { dedupeKey: string; dispatched: boolean };
      return void console.log(
        r.dispatched ? `Raised notification: ${input.title}` : `Already raised (deduped on ${r.dedupeKey}).`,
      );
    }
    case "ops.alerts.list": {
      const rows = data as AlertRow[];
      if (!rows.length) return void console.log("No alert rules found.");
      return printTable(
        ["ID", "Name", "Metric", "Condition", "Window", "Severity", "On"],
        rows.map((r) => [
          r.id.slice(0, 8),
          r.name,
          r.metricName ?? r.metricId.slice(0, 8),
          `${r.comparator} ${r.threshold}`,
          `${r.windowHours}h`,
          r.severity,
          r.enabled ? "yes" : "no",
        ]),
      );
    }
    case "ops.alerts.channels": {
      const res = data as { connected: boolean; channels: { id: string; name: string; isPrivate?: boolean }[] };
      if (!res.connected)
        return void console.log("No Slack connector — connect Slack in Settings → Notifications.");
      if (!res.channels.length) return void console.log("No channels visible to the bot.");
      return printTable(
        ["ID", "Name", "Visibility"],
        res.channels.map((c) => [c.id, `#${c.name}`, c.isPrivate ? "private" : "public"]),
      );
    }
    case "ops.alerts.create":
      return void console.log(`Created alert rule: ${input.name}`);
    case "ops.alerts.update":
      return void console.log(`Updated alert rule: ${input.rule}`);
    case "ops.alerts.archive":
      return void console.log(`Archived alert rule: ${input.rule}`);
    default:
      return void console.log(JSON.stringify(data, null, 2));
  }
}

const queueOps = opsOperations.filter((o) => o.group.length === 1);
const alertOps = opsOperations.filter((o) => o.group.join(" ") === "ops alerts");

/**
 * Clone the queue ops for an alias subtree: strip the `type` param and inject a
 * fixed value, so `ops bug list` ≡ `ops list --type bug` with no registry
 * change. Only the verbs that take/accept a type are aliased.
 */
function aliasOps(boundType: string): Operation[] {
  return queueOps
    .filter((o) => ["list", "get", "create", "update", "link-pr"].includes(o.name))
    .map((op) => ({
      ...op,
      params: op.params.filter((p) => p.name !== "type"),
      run: (client: Parameters<Operation["run"]>[0], input: OpInput) =>
        op.run(client, { ...input, type: boundType }),
    }));
}

export function opsCommand(parent: Command): Command {
  const ops = parent.command("ops").description("Operational queue, tickets & alert rules");

  // Unified queue (list/get/create/update/link-pr/notify) over /api/admin/feedback.
  mountResource(ops, queueOps, printResult);

  // Alert RULES live under `ops alerts` (alias `ar`).
  const alerts = ops
    .command("alerts")
    .alias("ar")
    .description("Create & manage metric-threshold alert rules the analysis cron evaluates");
  mountResource(alerts, alertOps, printResult);

  // Per-type alias subtrees — consumer-side convenience (pre-bound --type).
  mountResource(ops.command("bug").description("Bug tickets (alias for `ops … --type bug`)"), aliasOps("bug"), printResult);
  mountResource(
    ops.command("feature").description("Feature requests (alias for `ops … --type feature_request`)"),
    aliasOps("feature_request"),
    printResult,
  );

  withTreeHelp(ops);
  return ops;
}
