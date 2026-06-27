// IR → canonical text. Used for the read-only DSL preview shown next to the form editor.

import type { Query, Filter, AggKind } from "./ir";

const QUANTILE_NAME: Record<string, string> = {
  "0.5": "p50",
  "0.75": "p75",
  "0.9": "p90",
  "0.95": "p95",
  "0.99": "p99",
  "0.999": "p999",
};

export function render(q: Query): string {
  const agg = renderAgg(q.agg);
  const inside = renderInside(q);
  const groupBy =
    q.groupBy && q.groupBy.labels.length ? ` ${q.groupBy.op} (${q.groupBy.labels.join(", ")})` : "";
  return `${agg}(${inside})${groupBy}`;
}

function renderAgg(a: AggKind): string {
  switch (a.kind) {
    case "count_users":
      return "count_users";
    case "count_events":
      return "count";
    case "sum":
      return "sum";
    case "avg":
      return "avg";
    case "min":
      return "min";
    case "max":
      return "max";
    case "unique":
      return "unique";
    case "quantile":
      return QUANTILE_NAME[String(a.p)] ?? `quantile(${a.p})`;
    case "retention_Nd":
      return `retention_${a.n}d`;
  }
}

function renderInside(q: Query): string {
  const filters = q.filters.length ? `{${q.filters.map(renderFilter).join(", ")}}` : "";
  const value = q.valueLabel ? `, ${q.valueLabel}` : "";
  return `${q.metric}${filters}${value}`;
}

function renderFilter(f: Filter): string {
  return `${f.label}${f.op}${quoteString(f.value)}`;
}

function quoteString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
