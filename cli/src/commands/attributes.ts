import type { Command } from "commander";
import { attributeOperations, opId, type Operation } from "@shipeasy/openapi";
import { printTable } from "../util/output";
import { mountResource } from "./_registry";

/**
 * The `attributes` module — read-only list of the auto-inferred user-attribute
 * schema available for gate/experiment targeting. One op, so the typed MCP
 * `attributes_list` tool can replace the `attributes` kind of the deleted
 * generic-read path (doc 21 §A4.3).
 */
function printResult(op: Operation, data: unknown): void {
  if (opId(op) === "attributes.list") {
    const rows = data as { name: string; type?: string }[];
    if (!rows.length) return void console.log("No attributes found.");
    return printTable(
      ["Name", "Type"],
      rows.map((a) => [a.name, a.type ?? "—"]),
    );
  }
  console.log(JSON.stringify(data, null, 2));
}

export function attributesCommand(program: Command): Command {
  const attributes = program.command("attributes").description("Inspect targeting attributes");
  mountResource(attributes, attributeOperations, printResult);
  return attributes;
}
