// IR — typed source of truth for an event aggregation.
// Stored on metrics.query_ir as JSON. UI form and the read-only text preview
// are two views over the same IR.

export type AggKind =
  | { kind: "count_users" }
  | { kind: "count_events" }
  | { kind: "sum" }
  | { kind: "avg" }
  | { kind: "min" }
  | { kind: "max" }
  | { kind: "unique" }
  | { kind: "quantile"; p: 0.5 | 0.75 | 0.9 | 0.95 | 0.99 | 0.999 }
  | { kind: "retention_Nd"; n: number };

export type MatchOp = "=" | "!=" | "=~" | "!~";

export type Filter = { label: string; op: MatchOp; value: string };

export type GroupBy = { op: "by" | "without"; labels: string[] };

export type Query = {
  agg: AggKind;
  metric: string;
  valueLabel?: string;
  filters: Filter[];
  groupBy?: GroupBy;
};

export type Envelope = {
  bucket: number;
  timeRange: { from: number; to: number };
};

export const QUANTILE_VALUES = [0.5, 0.75, 0.9, 0.95, 0.99, 0.999] as const;

export const AGG_KINDS = [
  "count_users",
  "count_events",
  "sum",
  "avg",
  "min",
  "max",
  "unique",
  "quantile",
  "retention_Nd",
] as const;

export type AggKindName = (typeof AGG_KINDS)[number];

export function aggNeedsValue(a: AggKind): boolean {
  return (
    a.kind === "sum" ||
    a.kind === "avg" ||
    a.kind === "min" ||
    a.kind === "max" ||
    a.kind === "unique" ||
    a.kind === "quantile"
  );
}

export function aggExperimentReducer(
  a: AggKind,
): "count_users" | "count_events" | "sum" | "avg" | "retention_Nd" {
  switch (a.kind) {
    case "count_users":
    case "count_events":
    case "sum":
    case "avg":
    case "retention_Nd":
      return a.kind;
    case "min":
    case "max":
    case "unique":
    case "quantile":
      // Experiment t-test needs mean/variance per user.
      // These ops are display-only; map to closest reducer.
      return "avg";
  }
}
