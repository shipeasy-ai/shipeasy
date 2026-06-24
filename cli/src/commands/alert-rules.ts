import { Command } from "commander";
import { ApiError, getAdminClient, getApiClient } from "../api/client";
import { printJson, printTable } from "../util/output";
import { withExamples } from "../util/examples";

// Alert *rules* are the user-defined metric-threshold definitions the cron
// evaluates to raise alerts. They're writable (unlike raised alerts, which are
// read-only — see `shipeasy alerts`). A rule's `metric` is fixed at create
// time (it also pins the aggregation), so `update` exposes no --metric flag;
// only the threshold / comparator / window / severity / name / enabled knobs
// are tunable. To repoint a rule at a different metric, delete + recreate.

const COMPARATORS = ["gt", "gte", "lt", "lte"] as const;
const SEVERITIES = ["danger", "warn", "info"] as const;

type MetricRow = { id: string; name: string };
type SlackChannel = { id: string; name: string; isPrivate?: boolean };
type ChannelsResponse = { connected: boolean; channels: SlackChannel[] };

function handleError(e: unknown): never {
  if (e instanceof ApiError) console.error(`Error (${e.status}): ${e.message}`);
  else console.error(String(e));
  process.exit(1);
}

function assertComparator(v: string): (typeof COMPARATORS)[number] {
  if ((COMPARATORS as readonly string[]).includes(v)) return v as (typeof COMPARATORS)[number];
  throw new ApiError(`Invalid --comparator '${v}'. One of: ${COMPARATORS.join(", ")}`, 400);
}

function assertSeverity(v: string): (typeof SEVERITIES)[number] {
  if ((SEVERITIES as readonly string[]).includes(v)) return v as (typeof SEVERITIES)[number];
  throw new ApiError(`Invalid --severity '${v}'. One of: ${SEVERITIES.join(", ")}`, 400);
}

function parseBool(v: string): boolean {
  const s = v.toLowerCase();
  if (s === "true" || s === "1" || s === "on" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "off" || s === "no") return false;
  throw new ApiError(`Expected true/false, got '${v}'`, 400);
}

function parseThreshold(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ApiError(`Invalid --threshold '${v}' (not a number)`, 400);
  return n;
}

function parseWindow(v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 720)
    throw new ApiError(`Invalid --window '${v}'. Whole hours, 1–720.`, 400);
  return n;
}

/** Resolve a metric by exact id, unique id-prefix, or exact (unique) name. */
async function resolveMetricId(project: string | undefined, idOrName: string): Promise<string> {
  const api = getApiClient(project, { requireBinding: true });
  const rows = await api.request<MetricRow[]>("GET", "/api/admin/metrics");
  const byId = rows.find((m) => m.id === idOrName);
  if (byId) return byId.id;
  const byPrefix = rows.filter((m) => m.id.startsWith(idOrName));
  if (byPrefix.length === 1) return byPrefix[0].id;
  if (byPrefix.length > 1) throw new ApiError(`Metric id prefix '${idOrName}' is ambiguous`, 400);
  const byName = rows.filter((m) => m.name === idOrName);
  if (byName.length === 1) return byName[0].id;
  if (byName.length > 1)
    throw new ApiError(`Metric name '${idOrName}' is ambiguous — pass a metric id`, 400);
  throw new ApiError(`Metric '${idOrName}' not found (run \`shipeasy metrics list\`)`, 404);
}

/** Resolve a Slack channel by exact id or exact (unique) name against the
 *  project's real channel list — never assume/invent a channel. */
async function resolveSlackChannel(
  project: string | undefined,
  idOrName: string,
): Promise<{ id: string; name: string }> {
  const api = getApiClient(project, { requireBinding: true });
  const res = await api.request<ChannelsResponse>("GET", "/api/admin/slack/channels");
  if (!res.connected)
    throw new ApiError("No Slack connector — connect Slack in Settings → Notifications first.", 400);
  const stripped = idOrName.replace(/^#/, "");
  const byId = res.channels.find((c) => c.id === idOrName);
  if (byId) return { id: byId.id, name: byId.name };
  const byName = res.channels.filter((c) => c.name === stripped);
  if (byName.length === 1) return { id: byName[0].id, name: byName[0].name };
  if (byName.length > 1)
    throw new ApiError(`Slack channel name '${stripped}' is ambiguous — pass a channel id`, 400);
  throw new ApiError(
    `Slack channel '${idOrName}' not found (run \`shipeasy alert-rules channels\`)`,
    404,
  );
}

export function alertRulesCommand(parent: Command): void {
  const ar = parent
    .command("alert-rules")
    .alias("ar")
    .description("Manage metric-threshold alert rules (writable; `shipeasy alerts` is read-only)");

  const listRules = ar
    .command("list")
    .description("List alert rules")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts: { json?: boolean; project?: string }) => {
      try {
        const api = getAdminClient(opts.project);
        const rows = await api.alertRules.list();
        if (opts.json) return printJson(rows);
        if (!rows.length) return void console.log("No alert rules found.");
        printTable(
          ["ID", "Name", "Metric", "Condition", "Window", "Severity", "On", "Updated"],
          rows.map((r) => [
            r.id.slice(0, 8),
            r.name,
            r.metricName ?? r.metricId.slice(0, 8),
            `${r.comparator} ${r.threshold}`,
            `${r.windowHours}h`,
            r.severity,
            r.enabled ? "yes" : "no",
            r.updatedAt.slice(0, 19),
          ]),
        );
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(listRules, [{ run: "shipeasy alert-rules list" }]);

  const channels = ar
    .command("channels")
    .description("List the project's Slack channels (for --slack-channel targets)")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts: { json?: boolean; project?: string }) => {
      try {
        const api = getApiClient(opts.project, { requireBinding: true });
        const res = await api.request<ChannelsResponse>("GET", "/api/admin/slack/channels");
        if (opts.json) return printJson(res);
        if (!res.connected)
          return void console.log("No Slack connector — connect Slack in Settings → Notifications.");
        if (!res.channels.length) return void console.log("No channels visible to the bot.");
        printTable(
          ["ID", "Name", "Visibility"],
          res.channels.map((c) => [c.id, `#${c.name}`, c.isPrivate ? "private" : "public"]),
        );
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(channels, [{ run: "shipeasy alert-rules channels" }]);

  const createRule = ar
    .command("create <name>")
    .description("Create an alert rule. The metric (and its aggregation) is fixed for the rule's life.")
    .requiredOption("--metric <id|name>", "Metric to evaluate (id or name)")
    .requiredOption("--comparator <op>", `Comparison: ${COMPARATORS.join(" | ")}`)
    .requiredOption("--threshold <number>", "Threshold the metric value is compared against")
    .option("--window <hours>", "Lookback window in whole hours (1–720)", "24")
    .option("--severity <level>", `Severity: ${SEVERITIES.join(" | ")}`, "warn")
    .option("--disabled", "Create the rule disabled (default: enabled)")
    .option(
      "--slack-channel <id|name>",
      "Slack channel to post this rule's alert to (run `alert-rules channels`)",
    )
    .option("--email <addr>", "Email address to notify for this rule")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const metricId = await resolveMetricId(opts.project, opts.metric);
        const notify =
          opts.slackChannel || opts.email
            ? {
                slackChannel: opts.slackChannel
                  ? await resolveSlackChannel(opts.project, opts.slackChannel)
                  : null,
                email: opts.email ?? null,
              }
            : undefined;
        const data = await api.alertRules.create({
          name,
          metricId,
          comparator: assertComparator(opts.comparator),
          threshold: parseThreshold(opts.threshold),
          windowHours: parseWindow(opts.window),
          severity: assertSeverity(opts.severity),
          enabled: !opts.disabled,
          ...(notify ? { notify } : {}),
        });
        if (opts.json) return printJson(data);
        console.log(`Created alert rule: ${name} (${data.id})`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(createRule, [
    {
      note: "Alert when error rate exceeds 50 / 24h",
      run: "shipeasy alert-rules create high-error-rate --metric api-errors \\\n  --comparator gt --threshold 50",
    },
    {
      note: "Danger if checkouts drop below 100 in 6h",
      run: "shipeasy alert-rules create low-checkouts --metric checkouts \\\n  --comparator lt --threshold 100 --window 6 --severity danger",
    },
    {
      note: "Post to a specific Slack channel + email on-call",
      run: "shipeasy alert-rules create high-error-rate --metric api-errors \\\n  --comparator gt --threshold 50 --slack-channel '#incidents' --email oncall@acme.com",
    },
  ]);

  const updateRule = ar
    .command("update <id>")
    .description("Update an alert rule's tunable knobs (id or id-prefix or unique name). Metric is immutable.")
    .option("--name <name>", "Human label for the rule")
    .option("--comparator <op>", `Comparison: ${COMPARATORS.join(" | ")}`)
    .option("--threshold <number>", "Threshold the metric value is compared against")
    .option("--window <hours>", "Lookback window in whole hours (1–720)")
    .option("--severity <level>", `Severity: ${SEVERITIES.join(" | ")}`)
    .option("--enabled <bool>", "Enable/disable the rule (true|false)")
    .option("--slack-channel <id|name>", "Set the Slack channel target (run `alert-rules channels`)")
    .option("--email <addr>", "Set the email target")
    .option("--clear-target", "Clear this rule's target back to the project default")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (id: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const rule = await api.alertRules.resolve(id);
        const patch: Parameters<typeof api.alertRules.update>[1] = {};
        if (opts.name !== undefined) patch.name = opts.name;
        if (opts.comparator !== undefined) patch.comparator = assertComparator(opts.comparator);
        if (opts.threshold !== undefined) patch.threshold = parseThreshold(opts.threshold);
        if (opts.window !== undefined) patch.windowHours = parseWindow(opts.window);
        if (opts.severity !== undefined) patch.severity = assertSeverity(opts.severity);
        if (opts.enabled !== undefined) patch.enabled = parseBool(opts.enabled);
        if (opts.clearTarget) {
          patch.notify = { slackChannel: null, email: null };
        } else if (opts.slackChannel || opts.email) {
          patch.notify = {
            slackChannel: opts.slackChannel
              ? await resolveSlackChannel(opts.project, opts.slackChannel)
              : (rule.notify?.slackChannel ?? null),
            email: opts.email ?? rule.notify?.email ?? null,
          };
        }
        if (Object.keys(patch).length === 0)
          throw new ApiError("Nothing to update — pass at least one field to change.", 400);
        const data = await api.alertRules.update(rule.id, patch);
        if (opts.json) return printJson(data);
        console.log(`Updated alert rule: ${rule.name} (${rule.id})`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(updateRule, [
    {
      note: "Raise the threshold",
      run: "shipeasy alert-rules update high-error-rate --threshold 100",
    },
    { note: "Disable a rule", run: "shipeasy alert-rules update high-error-rate --enabled false" },
  ]);

  const deleteRule = ar
    .command("delete <id>")
    .description("Delete an alert rule (id or id-prefix or unique name)")
    .option("--project <id>", "Project ID override")
    .action(async (id: string, opts: { project?: string }) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const rule = await api.alertRules.resolve(id);
        await api.alertRules.delete(rule.id);
        console.log(`Deleted alert rule: ${rule.name} (${rule.id})`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(deleteRule, [{ run: "shipeasy alert-rules delete high-error-rate" }]);
}
