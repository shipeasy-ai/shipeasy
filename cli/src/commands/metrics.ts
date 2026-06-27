import type { Command } from "commander";
import { metricOperations, opId, type Operation, type OpInput } from "@shipeasy/openapi";
import { render, type Query } from "../query-dsl";
import { printTable } from "../util/output";
import { mountResource } from "./_registry";

/**
 * The `metrics` module — metric definitions + the event catalog. Subcommands are
 * generated from the shared operation registry (`mountResource`), so the metric
 * surface lives once and the CLI, MCP server, and docs never drift. This file
 * owns only the CLI-presentation concerns: the per-op tables and the query-DSL
 * render used to display a metric's query (the registry op passes `query`
 * straight through; the server validates it).
 */

type MetricRow = {
  id: string;
  name: string;
  folder: string | null;
  eventName: string;
  aggregation: string;
  queryIr?: unknown;
};

function renderQuery(ir: unknown): string {
  try {
    return ir ? render(ir as Query) : "—";
  } catch {
    return "—";
  }
}

function printResult(op: Operation, data: unknown, input: OpInput): void {
  switch (opId(op)) {
    case "metrics.grammar":
      return void process.stdout.write((data as { grammar: string }).grammar);
    case "metrics.list": {
      const rows = data as MetricRow[];
      if (!rows.length) return void console.log("No metrics found.");
      return printTable(
        ["ID", "Name", "Folder", "Event", "Agg", "Query"],
        rows.map((m) => [
          m.id.slice(0, 8),
          m.name,
          m.folder ?? "—",
          m.eventName,
          m.aggregation,
          renderQuery(m.queryIr),
        ]),
      );
    }
    case "metrics.show": {
      const m = data as MetricRow;
      console.log(`Name:    ${m.name}`);
      console.log(`Folder:  ${m.folder ?? "—"}`);
      console.log(`Event:   ${m.eventName}`);
      console.log(`Agg:     ${m.aggregation}`);
      if (m.queryIr) console.log(`Query:   ${renderQuery(m.queryIr)}`);
      return;
    }
    case "metrics.create":
      return void console.log(`Created metric: ${input.name}`);
    case "metrics.archive":
      return void console.log(`Archived metric: ${input.metric}`);
    default:
      return void console.log(JSON.stringify(data, null, 2));
  }
}

export function metricsCommand(program: Command): Command {
  const metrics = program.command("metrics").description("Event metrics + event catalog");
  mountResource(metrics, metricOperations, printResult);
  return metrics;
}
