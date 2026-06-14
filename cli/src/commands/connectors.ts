import { Command } from "commander";
import { getApiClient, ApiError } from "../api/client";
import { printJson, printTable } from "../util/output";
import { handleError } from "./feedback";
import { withExamples } from "../util/examples";

interface Connector {
  id: string;
  provider: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
}

const CONNECTOR_EVENTS = ["bug.created", "feature_request.created"] as const;

function parseEvents(csv: string | undefined): string[] {
  if (csv === undefined) return [];
  const events = csv
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  for (const e of events) {
    if (!CONNECTOR_EVENTS.includes(e as (typeof CONNECTOR_EVENTS)[number])) {
      throw new ApiError(`Invalid event: ${e} (one of ${CONNECTOR_EVENTS.join(", ")})`, 400);
    }
  }
  return events;
}

export function connectorsCommand(parent: Command): void {
  const group = parent
    .command("connectors")
    .description("Manage feedback connectors (Google Sheets, GitHub, Claude triggers)");

  // ── create-trigger ─────────────────────────────────────────────────────
  const createTrigger = group
    .command("create-trigger")
    .description(
      "Register a Claude trigger connector for a Claude Code routine. The routine " +
        "bearer token is encrypted at rest server-side and never logged.",
    )
    .requiredOption("--routine-id <id>", "Claude Code routine id to fire")
    .requiredOption("--token <token>", "Routine bearer token (used to fire the routine)")
    .option("--text <prompt>", "Default prompt sent when the routine is fired without one")
    .option("--name <name>", "Connector display name", "Claude trigger")
    .option(
      "--events <list>",
      `Comma-separated auto-fire events (${CONNECTOR_EVENTS.join(", ")}); default none`,
    )
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        const routineId = String(opts.routineId).trim();
        if (!routineId) throw new ApiError("Missing --routine-id", 400);
        const events = parseEvents(opts.events);
        const client = getApiClient(opts.project, { requireBinding: true });
        const created = await client.request<{ id: string }>("POST", "/api/admin/connectors", {
          provider: "claude_trigger",
          name: opts.name,
          events,
          config: {
            routineId,
            ...(opts.text ? { fireText: String(opts.text) } : {}),
          },
          token: String(opts.token),
          enabled: true,
        });
        if (opts.json) return printJson(created);
        console.log(
          `Registered Claude trigger connector: routine ${routineId} (${created.id.slice(0, 8)})`,
        );
        if (events.length === 0) {
          console.log(
            "Auto-fire is off — enable events in the Feedback → Connectors panel or fire on demand.",
          );
        }
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(createTrigger, [
    {
      note: "Register a routine, auto-fire on new bugs",
      run:
        "shipeasy connectors create-trigger --routine-id rt_abc123 --token se_rt_xxx \\\n" +
        "  --events bug.created,feature_request.created",
    },
    {
      note: "On-demand only, with a default prompt",
      run:
        'shipeasy connectors create-trigger --routine-id rt_abc123 --token se_rt_xxx \\\n' +
        '  --name "Nightly fixer" --text "Fix the top open bug"',
    },
  ]);

  // ── fire ───────────────────────────────────────────────────────────────
  const fire = group
    .command("fire <id>")
    .description("Fire a Claude trigger connector's routine now")
    .option("--text <prompt>", "Prompt to send for this run (overrides the connector default)")
    .option("--project <id>", "Project ID override")
    .action(async (id: string, opts) => {
      try {
        const client = getApiClient(opts.project, { requireBinding: true });
        const list = await client.request<Connector[]>("GET", "/api/admin/connectors");
        const match = list.find((c) => c.id === id || c.id.startsWith(id));
        if (!match) throw new ApiError(`Connector not found: ${id}`, 404);
        const res = await client.request<{ ok: boolean; error?: string }>(
          "POST",
          `/api/admin/connectors/${match.id}/fire`,
          opts.text ? { text: String(opts.text) } : undefined,
        );
        if (!res.ok) throw new ApiError(res.error ?? "Fire failed", 500);
        console.log(`Fired ${match.name} (${match.id.slice(0, 8)}). The run will start shortly.`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(fire, [
    { note: "Fire a connector by id prefix", run: "shipeasy connectors fire a1b2c3d4" },
    {
      note: "Fire with a one-off prompt",
      run: 'shipeasy connectors fire a1b2c3d4 --text "Fix bug #42"',
    },
  ]);

  // ── list ───────────────────────────────────────────────────────────────
  const listConnectors = group
    .command("list")
    .description("List feedback connectors")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        const client = getApiClient(opts.project);
        const list = await client.request<Connector[]>("GET", "/api/admin/connectors");
        if (opts.json) return printJson(list);
        if (!list.length) return void console.log("No connectors found.");
        printTable(
          ["ID", "Provider", "Name", "Enabled", "Target"],
          list.map((c) => {
            const cfg = c.config ?? {};
            const target =
              typeof cfg.routineId === "string"
                ? `routine ${cfg.routineId}`
                : typeof cfg.owner === "string" && typeof cfg.repo === "string"
                  ? `${cfg.owner}/${cfg.repo}`
                  : typeof cfg.spreadsheetName === "string"
                    ? String(cfg.spreadsheetName)
                    : "—";
            return [c.id.slice(0, 8), c.provider, c.name, c.enabled ? "yes" : "no", target];
          }),
        );
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(listConnectors, [{ run: "shipeasy connectors list" }]);
}
