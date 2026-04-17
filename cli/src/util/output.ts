import Table from "cli-table3";

export function printTable(headers: string[], rows: (string | number)[][]): void {
  const t = new Table({ head: headers, style: { head: ["cyan"] } });
  for (const row of rows) t.push(row.map(String));
  console.log(t.toString());
}

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === "running") return `\x1b[32m${status}\x1b[0m`; // green
  if (s === "stopped" || s === "revoked") return `\x1b[33m${status}\x1b[0m`; // yellow
  if (s === "archived" || s === "draft") return `\x1b[90m${status}\x1b[0m`; // gray
  return status;
}
