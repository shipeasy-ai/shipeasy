import type { CustomOp } from "./types.js";

/** The Shipeasy metric query DSL grammar — printed by `shipeasy metrics grammar`. */
export const METRIC_GRAMMAR = `Shipeasy metric query DSL
=========================

Query        := AggFunc "(" Selector ("," Identifier)? ")" GroupBy?
AggFunc      := count_users | count | sum | avg | min | max | unique |
                p50 | p75 | p90 | p95 | p99 | p999 |
                retention_<N>d            (N in 1..90)
Selector     := Identifier ("{" Filter ("," Filter)* ","? "}")?
Filter       := Identifier MatchOp StringLiteral
MatchOp      := "=" | "!=" | "=~" | "!~"
StringLiteral := double-quoted, supports \\" and \\\\
GroupBy      := ("by" | "without") "(" Identifier ("," Identifier)* ","? ")"

Examples
--------
  count_users(checkout_completed)
  sum(purchase{country="US"}, amount)
  p99(req_dur{route=~"/api/.*"}, ms) by (route, status)
  retention_7d(session_start)
  avg(req_dur{tier!="free"}, ms) without (region)

Notes
-----
- One event selector per query (no formulas).
- "count" maps to count_events (per-row count); "count_users" is uniq-by-user.
- For experiments, "by (label)" is ignored — per-user reducer is applied.
- Filter values must be quoted strings, even for numeric labels (they are coerced).
- Filter labels and value labels must be declared on the source event.
`;

export const grammarOp: CustomOp = {
  group: ["metrics"],
  name: "grammar",
  summary: "Print the metric query DSL grammar",
  description: "Print the grammar + examples for the metric query DSL used by `metrics create`.",
  params: [],
  examples: [{ run: "shipeasy metrics grammar" }],
  run: () => ({ grammar: METRIC_GRAMMAR }),
};
