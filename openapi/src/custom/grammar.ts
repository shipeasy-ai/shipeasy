import type { CustomOp } from "./types.js";

/**
 * The Shipeasy metric query DSL grammar — printed by `shipeasy metrics grammar`
 * / the `metrics_grammar` MCP tool.
 *
 * This is the one-stop reference for both humans and AI agents that need to
 * author a `metrics create --query "..."` string. It is intentionally
 * self-contained: the formal grammar (precise, for machine parsing), a full
 * aggregation reference (semantics + value-label rules + experiment behaviour),
 * the selector/filter/group-by/ratio rules, hard constraints, and glossed
 * examples.
 *
 * Source of truth for semantics is the RUNTIME parser + IR that the server
 * actually runs: the main repo's `packages/query-dsl` (`parse.ts` / `ir.ts`).
 * The vendored `cli/src/query-dsl` copy is a lagging subset (no `ratio` yet) and
 * is NOT on the create path — the CLI forwards the raw `--query` string to the
 * server, which parses it. Keep this text in sync with `packages/query-dsl`.
 */
export const METRIC_GRAMMAR = `SHIPEASY METRIC QUERY DSL
=========================

A metric is an aggregation over an event stream. Almost always that is ONE
aggregation over ONE event; the single exception is the binary \`ratio(...)\`
form, which divides one count-style arm by another (each arm its own event and
filters) in one pass. This DSL is the string you pass to
\`metrics create --query "..."\` (equivalently the typed \`query_ir\`). There is
no general arithmetic, no free-form formulas, and no subqueries — \`ratio\` is
the only division / two-event form.


GRAMMAR (BNF)
-------------
  Query         := Agg | Ratio
  Agg           := AggFunc "(" Selector ("," Identifier)? ")" GroupBy?
  Ratio         := "ratio" "(" RatioArm "," RatioArm ")"
  RatioArm      := ("count_users" | "count") "(" Selector ")"
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
  ratio(a, b)     forbidden     a ÷ b (see RATIO below)         proportion **

  * Display-only aggregations. The experiment t-test needs a per-user mean and
    variance, so min/max/unique/quantile are computed exactly on dashboards but
    collapse to a per-user \`avg\` when used as an experiment metric. If you need
    an exact experiment metric, pick count_users / count / sum / avg / retention.

  ** In an experiment a ratio collapses to a per-user 0/1 outcome (a proportion),
    not a ratio-of-sums — see RATIO.

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
  ignored — a per-user reducer is applied across the whole arm instead. Group-by
  is NOT allowed on a \`ratio\` query.


RATIO  (success rate, conversion, failure %, …)
-----------------------------------------------
  \`ratio(numerator, denominator)\` divides one count-style arm by another. Each
  arm is an independent selector with its OWN event and filters, so the two arms
  can be different events:

    ratio(count(checkout_completed), count(checkout_started))
    ratio(count_users(paid), count_users(signed_up))
    ratio(count(payment{ok="1"}), count(payment))     one event, filtered arm

  Rules:
  - Arms are limited to \`count\` and \`count_users\` — no sum/avg/quantile arm.
  - \`count\` arms divide event counts; \`count_users\` arms divide distinct-user
    counts. Pick one shape and use it on both arms unless you mean to mix them.
  - A zero denominator yields 0, not an error.
  - No \`by (...)\` / \`without (...)\`, and no retention arm, on a ratio.
  - It is a COHORT RATE over the window — numerator events ÷ denominator events —
    NOT a per-id join. It never matches an individual attempt to its outcome by a
    correlation id; it counts each side over the window and divides. If you need a
    matched pair, resolve the outcome in your own code and emit ONE event carrying
    the result (e.g. an \`ok\` label), then use \`ratio(count(e{ok="1"}), count(e))\`
    or \`avg(e, ok)\`.
  - In an experiment a per-user ratio is a 0/1 outcome — did the numerator happen,
    among denominator-eligible users — i.e. a proportion, not a ratio-of-sums.
  - When creating with \`--event-name\`, pass the NUMERATOR's event name.


NOT SUPPORTED (will fail to parse)
----------------------------------
  - general arithmetic / free-form formulas: \`count(a) + count(b)\`, \`2 * sum(x)\`,
    \`avg(a) / avg(b)\` — the ONLY division form is the fixed binary
    \`ratio(arm, arm)\` with count-style arms (see RATIO)
  - a ratio arm that isn't \`count\` / \`count_users\`: \`ratio(sum(a, v), count(b))\`
  - more than two events in one query
  - \`by (...)\` / \`without (...)\` on a ratio
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

  ratio(count(checkout_completed), count(checkout_started))
      checkout conversion rate — completions ÷ starts over the window.

  ratio(count(payment{ok="0"}), count(payment))
      payment failure rate from a single event's outcome label.
`;

export const grammarOp: CustomOp = {
  group: ["metrics"],
  name: "grammar",
  summary: "Print the metric query DSL grammar",
  description:
    "Print the full metric query DSL reference — grammar, aggregation semantics, " +
    "filter/group-by/ratio rules, and glossed examples — used to author `metrics create --query`.",
  params: [],
  examples: [{ run: "shipeasy metrics grammar" }],
  run: () => ({ grammar: METRIC_GRAMMAR }),
};
