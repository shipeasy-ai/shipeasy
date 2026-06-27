import type { Command } from "commander";
import { eventOperations, opId, type Operation, type OpInput } from "@shipeasy/openapi";
import { printTable } from "../util/output";
import { mountResource } from "./_registry";

/**
 * The event catalog (`metrics events …`) — names + typed properties that metric
 * queries reference. Generated from the shared registry (`eventOperations`).
 * Properties are passed as a JSON array (`--props`) instead of the old
 * repeatable `--prop name:type`, so the one op works on the CLI and MCP alike.
 */

interface EventRow {
  id: string;
  name: string;
  folder: string | null;
  properties?: unknown[];
  pending: number;
}

function printResult(op: Operation, data: unknown, input: OpInput): void {
  switch (opId(op)) {
    case "events.list": {
      const rows = data as EventRow[];
      if (!rows.length) return void console.log("No events found.");
      return printTable(
        ["ID", "Name", "Folder", "Props", "Pending"],
        rows.map((e) => [
          e.id.slice(0, 8),
          e.name,
          e.folder ?? "—",
          String(e.properties?.length ?? 0),
          e.pending === 1 ? "yes" : "no",
        ]),
      );
    }
    case "events.get":
      return void console.log(JSON.stringify(data, null, 2));
    case "events.create":
      return void console.log(`Created event: ${input.name}`);
    case "events.update":
      return void console.log(`Updated event: ${input.event}`);
    case "events.approve":
      return void console.log(`Approved event: ${input.event}`);
    case "events.archive":
      return void console.log(`Archived event: ${input.event}`);
    default:
      return void console.log(JSON.stringify(data, null, 2));
  }
}

export function eventsCommand(parent: Command): Command {
  const events = parent
    .command("events")
    .description("Manage the event catalog (names + properties metrics query against)");
  mountResource(events, eventOperations, printResult);
  return events;
}
