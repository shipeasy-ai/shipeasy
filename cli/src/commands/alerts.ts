import { Command } from "commander";
import { ApiError, getApiClient } from "../api/client";
import { printJson, printTable } from "../util/output";
import { withExamples } from "../util/examples";

// Active alerts are raised by the platform (UI killswitch handlers + the
// worker analysis consumer and alerts cron), never filed by hand — so the CLI
// exposes read-only `list` / `get`, mirroring `ops.errors`. The metric-rule
// *rules* that produce some of these alerts are managed in the dashboard
// Settings → Alerts UI (no CLI surface, by design).

const ALERT_STATUSES = ["active", "resolved", "dismissed", "all"] as const;
const ENDPOINT = "/api/admin/alerts";
const SEVERITY_RANK: Record<string, number> = { danger: 0, warn: 1, info: 2 };

interface AlertItem {
  id: string;
  source: string;
  ruleId: string | null;
  severity: "danger" | "warn" | "info";
  title: string;
  detail: string;
  href: string | null;
  observedValue: number | null;
  status: string;
  createdAt: string;
  [key: string]: unknown;
}

function handleError(e: unknown): never {
  if (e instanceof ApiError) console.error(`Error (${e.status}): ${e.message}`);
  else console.error(String(e));
  process.exit(1);
}

export function alertsCommand(parent: Command): void {
  const alerts = parent.command("alerts").description("Active alerts (read-only)");

  const listAlerts = alerts
    .command("list")
    .description("List alerts (danger first, then most-recent). Defaults to active.")
    .option("--status <status>", `Filter by status: ${ALERT_STATUSES.join("|")}`, "active")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts: { status: string; json?: boolean; project?: string }) => {
      try {
        if (!ALERT_STATUSES.includes(opts.status as (typeof ALERT_STATUSES)[number]))
          throw new ApiError(`Invalid status: ${opts.status}`, 400);
        const client = getApiClient(opts.project);
        const query = `?status=${encodeURIComponent(opts.status)}`;
        const items = await client.request<AlertItem[]>("GET", `${ENDPOINT}${query}`);
        const rows = [...items].sort(
          (a, b) =>
            (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
            b.createdAt.localeCompare(a.createdAt),
        );
        if (opts.json) return printJson(rows);
        if (!rows.length) return void console.log("No alerts found.");
        printTable(
          ["ID", "Severity", "Source", "Title", "Status", "Created"],
          rows.map((a) => [
            a.id.slice(0, 8),
            a.severity,
            a.source,
            a.title.length > 50 ? `${a.title.slice(0, 47)}…` : a.title,
            a.status,
            a.createdAt.slice(0, 19),
          ]),
        );
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(listAlerts, [
    { run: "shipeasy alerts list" },
    { note: "Include resolved + dismissed", run: "shipeasy alerts list --status all" },
  ]);

  const getAlert = alerts
    .command("get <id>")
    .description("Show one alert by id (or id prefix)")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (id: string, opts: { json?: boolean; project?: string }) => {
      try {
        const client = getApiClient(opts.project);
        const items = await client.request<AlertItem[]>("GET", `${ENDPOINT}?status=all`);
        const match = items.find((i) => i.id === id || i.id.startsWith(id));
        if (!match) throw new ApiError(`Alert not found: ${id}`, 404);
        if (opts.json) return printJson(match);
        console.log(JSON.stringify(match, null, 2));
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(getAlert, [{ note: "id or unique id-prefix", run: "shipeasy alerts get a1b2c3d4" }]);
}
