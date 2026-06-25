import { Command } from "commander";
import { getApiClient, ApiError } from "../api/client";
import { printTable, printJson } from "../util/output";
import { withExamples } from "../util/examples";

// The event catalog (`/api/admin/events`) is the registry of event names — and
// the properties on them — that metric queries reference. `/collect`
// auto-discovers unknown names as `pending` rows; `events approve` is the
// review gate that promotes them to usable. Property types come from
// `eventPropertySchema` in @shipeasy/core/schemas/events.
const ENDPOINT = "/api/admin/events";
const PROP_TYPES = ["string", "number", "boolean"] as const;

interface EventProperty {
  name: string;
  type: (typeof PROP_TYPES)[number];
  required: boolean;
  description: string;
}

interface EventRow {
  id: string;
  name: string;
  folder: string | null;
  description: string | null;
  properties: EventProperty[];
  pending: number;
  createdAt: string;
  [key: string]: unknown;
}

/** Commander collector for a repeatable `--prop name:type[:required]` option. */
function collectProp(value: string, prev: EventProperty[]): EventProperty[] {
  const [name, type = "string", required] = value.split(":");
  if (!name) throw new ApiError(`Invalid --prop '${value}' (expected name:type)`, 400);
  if (!PROP_TYPES.includes(type as EventProperty["type"]))
    throw new ApiError(`Invalid property type '${type}' (one of ${PROP_TYPES.join("|")})`, 400);
  return [
    ...prev,
    { name, type: type as EventProperty["type"], required: required === "required", description: "" },
  ];
}

export function eventsCommand(parent: Command): Command {
  const events = parent
    .command("events")
    .description("Manage the event catalog (names + properties metrics query against)");

  const listEvents = events
    .command("list")
    .description("List catalogued events (including pending auto-discovered names)")
    .option("--pending", "Show only pending (unapproved) events")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        const api = getApiClient(opts.project);
        let rows = await api.request<EventRow[]>("GET", ENDPOINT);
        if (opts.pending) rows = rows.filter((e) => e.pending === 1);
        if (opts.json) return printJson(rows);
        if (!rows.length) return void console.log("No events found.");
        printTable(
          ["ID", "Name", "Folder", "Props", "Pending"],
          rows.map((e) => [
            e.id.slice(0, 8),
            e.name,
            e.folder ?? "—",
            String(e.properties?.length ?? 0),
            e.pending === 1 ? "yes" : "no",
          ]),
        );
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(listEvents, [
    { run: "shipeasy metrics events list" },
    { note: "Review the auto-discovered queue", run: "shipeasy metrics events list --pending" },
  ]);

  const getEvent = events
    .command("get <id>")
    .description("Show one catalogued event by id")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (id: string, opts) => {
      try {
        const api = getApiClient(opts.project);
        const detail = await api.request<EventRow>("GET", `${ENDPOINT}/${id}`);
        if (opts.json) return printJson(detail);
        console.log(JSON.stringify(detail, null, 2));
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(getEvent, [{ run: "shipeasy metrics events get 3f9a2c1b" }]);

  const createEvent = events
    .command("create <name>")
    .description("Register a new event name (and optionally its properties)")
    .option("--folder <folder>", "Folder")
    .option("--description <text>", "Human-readable description")
    .option("--prop <name:type>", `Property — type one of ${PROP_TYPES.join("|")} (repeatable)`, collectProp, [])
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getApiClient(opts.project, { requireBinding: true });
        const body = {
          name,
          folder: opts.folder ?? null,
          ...(opts.description ? { description: opts.description } : {}),
          properties: opts.prop ?? [],
        };
        const res = await api.request<{ id: string; name: string }>("POST", ENDPOINT, body);
        if (opts.json) return printJson(res);
        console.log(`Created event: ${res.name} (${res.id})`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(createEvent, [
    { run: "shipeasy metrics events create checkout_completed" },
    {
      note: "With a typed, required property",
      run: "shipeasy metrics events create purchase --prop amount:number:required --prop country:string",
    },
  ]);

  const updateEvent = events
    .command("update <id>")
    .description("Update an event's folder, description, or properties (replaces all props)")
    .option("--folder <folder>", "New folder")
    .option("--description <text>", "New description")
    .option("--prop <name:type>", "Replacement property (repeatable; replaces the full set)", collectProp, [])
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (id: string, opts) => {
      try {
        const patch: Record<string, unknown> = {};
        if (opts.folder !== undefined) patch.folder = opts.folder;
        if (opts.description !== undefined) patch.description = opts.description;
        if (opts.prop && opts.prop.length) patch.properties = opts.prop;
        if (Object.keys(patch).length === 0)
          throw new ApiError("Nothing to update — pass --folder, --description, and/or --prop", 400);
        const api = getApiClient(opts.project, { requireBinding: true });
        const res = await api.request<{ id: string }>("PATCH", `${ENDPOINT}/${id}`, patch);
        if (opts.json) return printJson(res);
        console.log(`Updated event: ${id}`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(updateEvent, [
    { run: "shipeasy metrics events update 3f9a2c1b --folder checkout" },
  ]);

  const approveEvent = events
    .command("approve <id>")
    .description("Approve a pending (auto-discovered) event so metrics can query it")
    .option("--folder <folder>", "Folder to file it under")
    .option("--description <text>", "Description")
    .option("--prop <name:type>", "Declare a property on approval (repeatable)", collectProp, [])
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (id: string, opts) => {
      try {
        const api = getApiClient(opts.project, { requireBinding: true });
        const body: Record<string, unknown> = {};
        if (opts.folder !== undefined) body.folder = opts.folder;
        if (opts.description !== undefined) body.description = opts.description;
        if (opts.prop && opts.prop.length) body.properties = opts.prop;
        const res = await api.request<{ id: string }>("POST", `${ENDPOINT}/${id}/approve`, body);
        if (opts.json) return printJson(res);
        console.log(`Approved event: ${id}`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(approveEvent, [
    { note: "Promote an auto-discovered event", run: "shipeasy metrics events approve 3f9a2c1b" },
  ]);

  const deleteEvent = events
    .command("delete <id>")
    .description("Delete an event from the catalog")
    .option("--project <id>", "Project ID override")
    .action(async (id: string, opts) => {
      try {
        const api = getApiClient(opts.project, { requireBinding: true });
        await api.request("DELETE", `${ENDPOINT}/${id}`);
        console.log(`Deleted event: ${id}`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(deleteEvent, [{ run: "shipeasy metrics events delete 3f9a2c1b" }]);

  return events;
}

function handleError(e: unknown): void {
  if (e instanceof ApiError) {
    console.error(`Error (${e.status}): ${e.message}`);
  } else {
    console.error(String(e));
  }
  process.exit(1);
}
