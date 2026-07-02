import type { CustomOp } from "./types.js";

/**
 * The Shipeasy metric query DSL grammar — printed by `shipeasy metrics grammar`
 * / the `metrics_grammar` MCP tool.
 *
 * This is the one-stop reference for both humans and AI agents that need to
 * author a `metrics create --query "..."` string. It is intentionally
 * self-contained: the formal grammar (precise, for machine parsing), a full
 * aggregation reference (semantics + value-label rules + experiment behaviour),
 * the selector/filter/group-by rules, hard constraints, and glossed examples.
 * Keep it in sync with the parser (`cli/src/query-dsl/parse.ts`) and the IR
 * (`cli/src/query-dsl/ir.ts`) — they are the source of truth for semantics.
 */
export const METRIC_GRAMMAR = `SHIPEASY METRIC QUERY DSL
=========================

A metric is ONE aggregation over ONE event stream. This DSL is the string you
pass to \`metrics create --query "..."\` (equivalently the typed \`query_ir\`).
There is no arithmetic, no formulas across events, no subqueries — one event
selector, one aggregation, an optional group-by.


GRAMMAR (BNF)
-------------
  Query         := AggFunc "(" Selector ("," Identifier)? ")" GroupBy?
  AggFunc       := "count_users" | "count" | "sum" | "avg" | "min" | "max"
                 | "unique" | "p50" | "p75" | "p90" | "p95" | "p99" | "p999"
                 | "retention_" <N> "d"                       (N = 1..90)
  Selector      := Identifier ("{" Filter ("," Filter)* ","? "}")?
  Filter        := Identifier MatchOp StringLiteral
  MatchOp       := "=" | "!=" | "=~" | "!~"
  GroupBy       := ("by" | "without") "(" Identifier ("," Identifier)* ","? ")"
  StringLiteral := double-quoted; \\" is a literal quote, \\\\ is a backslash
  Identifier    := [A-Za-z_][A-Za-z0-9_]*                     (case-sensitive)

  The trailing Identifier after the selector — "(" Selector "," Identifier ")" —
  is the VALUE LABEL: the numeric event label the aggregation reduces. Whether it
  is required, optional, or forbidden depends on the aggregation (see below).


AGGREGATIONS
------------
  Function        Value label   Meaning                         In experiments
  --------------  ------------  ------------------------------  ---------------
  count_users     forbidden     distinct users who fired it     exact
  count           forbidden     number of events (rows)         exact
  sum(e, v)       required      Σ of numeric label v            exact
  avg(e, v)       required      mean of label v                 exact
  retention_Nd(e) forbidden     % of users who returned         exact
                                within N days (N = 1..90)
  min(e, v)       required      minimum of label v              approx → avg *
  max(e, v)       required      maximum of label v              approx → avg *
  unique(e, v)    required      distinct values of label v      approx → avg *
  p50 … p999(e,v) required      quantile of v (50/75/90/        approx → avg *
                                95/99/99.9th percentile)

  * Display-only aggregations. The experiment t-test needs a per-user mean and
    variance, so min/max/unique/quantile are computed exactly on dashboards but
    collapse to a per-user \`avg\` when used as an experiment metric. If you need
    an exact experiment metric, pick count_users / count / sum / avg / retention.

  "count" is the DSL spelling of the internal count_events (one per matching
  row); "count_users" is unique-by-user. Getting these two confused is the most
  common mistake — count double-counts a user who fired the event twice.


SELECTOR & FILTERS
------------------
  The selector is the event name plus an optional \`{ ... }\` filter set that
  narrows which events count. Each filter compares an event LABEL to a quoted
  string:

    =   equal            !=   not equal
    =~  regex match      !~   regex NOT match

  - Values are ALWAYS double-quoted strings, even for numeric labels — they are
    coerced on the server (\`amount=~"^1[0-9]$"\`, \`status="200"\`).
  - Multiple filters are AND-ed: \`{country="US", tier!="free"}\`.
  - Every filter label AND the value label must be a label DECLARED on the source
    event. Undeclared labels are a validation error, not a silent no-match.


GROUP-BY
--------
  Splits the result into one series per label combination.
    by (a, b)       one series per distinct (a, b) — keep only these labels
    without (a, b)  group by all declared labels EXCEPT a, b

  NOTE: group-by is a DASHBOARD-only feature. In an experiment the group-by is
  ignored — a per-user reducer is applied across the whole arm instead.


NOT SUPPORTED (will fail to parse)
----------------------------------
  - arithmetic / ratios / formulas: \`count(a) / count(b)\`
  - more than one event per query
  - arbitrary quantiles (only the fixed p50/p75/p90/p95/p99/p999)
  - unquoted or numeric filter values: \`{status=200}\`  → must be \`"200"\`
  - trailing tokens after the query


EXAMPLES  (query  —  what it measures)
--------------------------------------
  count_users(checkout_completed)
      distinct users who completed checkout.

  count(add_to_cart{country="US"})
      number of US add-to-cart events (a user can count many times).

  sum(purchase{country="US"}, amount)
      total purchase amount from US purchase events.

  avg(req_dur{tier!="free"}, ms) without (region)
      mean request duration for non-free tiers, one series per region-excluded
      label combination.

  p99(req_dur{route=~"/api/.*"}, ms) by (route, status)
      99th-percentile latency of /api/* requests, split by route and status.

  unique(login{method="sso"}, device_id)
      distinct SSO devices seen (display-only; an experiment would use per-user avg).

  retention_7d(session_start)
      share of users who started a new session within 7 days.
`;

export const grammarOp: CustomOp = {
  group: ["metrics"],
  name: "grammar",
  summary: "Print the metric query DSL grammar",
  description:
    "Print the full metric query DSL reference — grammar, aggregation semantics, " +
    "filter/group-by rules, and glossed examples — used to author `metrics create --query`.",
  params: [],
  examples: [{ run: "shipeasy metrics grammar" }],
  run: () => ({ grammar: METRIC_GRAMMAR }),
};
