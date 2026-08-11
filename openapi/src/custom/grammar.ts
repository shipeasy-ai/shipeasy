import type { CustomOp } from "./types.js";
import {
  AGGREGATES_BLOCK,
  AGGREGATIONS_BLOCK,
  REFUSALS_BLOCK,
} from "./grammar.generated.js";

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
 * actually runs: the main repo's `packages/query-dsl` (`parse-expr.ts` /
 * `expr.ts`). The CLI forwards the raw `--query` string to the server, which
 * parses it — there is no second parser here to keep in step, only this text,
 * which has to stay in sync with `packages/query-dsl`.
 */
export const METRIC_GRAMMAR = `SHIPEASY METRIC QUERY DSL
=========================

A metric is an EXPRESSION over an event stream. An aggregation over one event
is a leaf; leaves compose with \`+ - * /\`, parentheses group, and a metric may
end with \`by (...)\` or \`without (...)\` to split it into one series per label
combination. This DSL is the string you pass to \`metrics create --query "..."\`
(equivalently the typed \`query_ir\`).

So \`count(a) / count(b)\` is a rate, \`count(a) / count(b) * 100\` is a
percentage, and \`(count(a) - count(b)) / count(c)\` is as ordinary as it looks.
\`ratio(a, b)\` still parses and means exactly \`a / b\`.


GRAMMAR (BNF)
-------------
  Query         := Expression GroupBy?
  Expression    := Term (("+" | "-") Term)*
  Term          := Factor (("*" | "/") Factor)*
  Factor        := "-"? Primary
  Primary       := Number | "(" Expression ")" | Aggregate | Function
  Selector      := Identifier ("{" Predicate ((","|"and"|"or") Predicate)* ","? "}")?
  Predicate     := "not"? ( Identifier ("=" | "=~") StringLiteral
                          | Identifier (">" | ">=" | "<" | "<=") Number
                          | Identifier "not"? "in" "(" StringLiteral ("," ...)* ")"
                          | Identifier ":" "*"
                          | "(" Predicate ")" )
  GroupBy       := ("by" | "without") "(" Identifier ("," Identifier)* ","? ")"
  StringLiteral := double-quoted; \\" is a literal quote, \\\\ is a backslash
  Identifier    := [A-Za-z_][A-Za-z0-9_]*                     (case-sensitive)

  There is ONE negation and it goes in front of a predicate: \`not status="ok"\`.
  \`!=\` and \`!~\` are refused by name.

  The trailing Identifier after the selector — "(" Selector "," Identifier ")" —
  is the VALUE LABEL: the numeric event label the aggregation reduces. Whether it
  is allowed, and whether it is needed, is per aggregation (see below).

${AGGREGATES_BLOCK}


AGGREGATIONS
------------
${AGGREGATIONS_BLOCK}

  A value label is optional wherever it is allowed: omitted, the aggregation
  reduces the event's own default numeric value. \`count\` takes the event alone.

  \`count\` is one per matching ROW, so a user who fired the event twice counts
  twice.

  In an experiment, \`min\`, \`max\` and \`p\` collapse to a per-user \`avg\`: the
  t-test needs a per-user mean and variance, and those three have neither. They
  are exact on a dashboard. For an exact experiment metric pick count / sum /
  avg, or a rate — a rate collapses to a per-user 0/1 outcome (a proportion),
  not a ratio-of-sums.


SELECTOR & FILTERS
------------------
  The selector is the event name plus an optional \`{ ... }\` filter set that
  narrows which events count. Each filter compares an event LABEL to a quoted
  string:

    =   equal                    =~  glob match
    >  >=  <  <=  order, NUMERIC labels only, value written BARE
    in ("a", "b")  a value set     label:*  the label is set at all
    not <predicate>  negation, in FRONT of the predicate

  There is no \`!=\` and no \`!~\`. One negation, one place it goes:
  \`{not tier="free"}\`. Predicates join with \`and\` / \`or\` (a comma is another
  \`and\`) and parenthesise.

  - \`=~\` takes a GLOB, NOT a regex. Two wildcards, and a glob matches the
    WHOLE value — there are no anchors because there is nothing to anchor:

      *  any sequence of characters       ?  exactly one character

      route=~"/api*"          starts with /api
      route=~"*checkout"      ends with checkout
      route=~"*admin*"        contains admin
      route=~"/v?/users"      /v1/users, /v2/users …
      route=~"/health"        EXACTLY /health — same as \`route="/health"\`

    Every other character is a LITERAL, dots included, so \`host=~"*.acme.com"\`
    works as written. Regex syntax — \`^\` \`$\` \`.*\` \`|\` \`[]\` \`()\` \`+\` \`{}\` \`\\\\\` — is
    REJECTED at save time rather than reinterpreted: \`^/api\` would be a glob for
    a value that literally starts with a caret, and \`/api/.*\` would match
    \`/api/.x\` but not \`/api/x\`. Write \`/api*\` instead.
  - Values are ALWAYS double-quoted strings, even for numeric labels — they are
    coerced on the server (\`status="200"\`) — EXCEPT the order comparisons,
    whose value is written bare (\`ms > 500\`). A glob on a numeric or boolean
    label is a validation error.
  - Multiple predicates are AND-ed: \`{country="US", not tier="free"}\`.
  - Every filter label AND the value label must be a label DECLARED on the source
    event. Undeclared labels are a validation error, not a silent no-match.


GROUP-BY
--------
  Splits the result into one series per label combination.
    by (a, b)       one series per distinct (a, b) — keep only these labels
    without (a, b)  group by all declared labels EXCEPT a, b

  NOTE: group-by is a DASHBOARD-only feature. In an experiment the group-by is
  ignored — a per-user reducer is applied across the whole arm instead.


RATES  (success rate, conversion, failure %, …)
----------------------------------------------
  Division is ordinary: \`a / b\`. Each side is its own expression with its own
  event and filters, so the two sides can be different events. \`ratio(a, b)\` is
  the same thing spelled as a function.

    count(checkout_completed) / count(checkout_started)
    count(paid) / count(signed_up)
    count(payment{ok="1"}) / count(payment)           one event, filtered side
    count(errors) / count(requests) * 100             as a percentage

  Rules:
  - A zero denominator yields 0, not an error.
  - \`by (...)\` / \`without (...)\` applies to the whole rate, and works.
  - AS AN EXPERIMENT METRIC both sides must be \`count\`. That is the one real
    restriction, and it is about the per-user collapse rather than the query:
    a rate becomes "did the numerator happen, among the users eligible for the
    denominator", which is a 0/1 outcome per user. \`sum(a, v) / count(b)\`
    charts fine and is refused when attached to an experiment.
  - It is a COHORT RATE over the window — numerator events ÷ denominator events —
    NOT a per-id join. It never matches an individual attempt to its outcome by a
    correlation id; it counts each side over the window and divides. If you need a
    matched pair, resolve the outcome in your own code and emit ONE event carrying
    the result (e.g. an \`ok\` label), then use \`ratio(count(e{ok="1"}), count(e))\`
    or \`avg(e, ok)\`.
  - In an experiment a per-user ratio is a 0/1 outcome — did the numerator happen,
    among denominator-eligible users — i.e. a proportion, not a ratio-of-sums.
  - When creating with \`--event-name\`, pass the NUMERATOR's event name.


REFUSED BY NAME
---------------
  Each of these is recognised in order to be refused, with a message saying what
  to write instead. They are not gaps.

${REFUSALS_BLOCK}

  Also refused: \`!=\` and \`!~\` (write \`not label="v"\`), a regex inside \`=~\`
  (globs only), an order comparison on a text label, a quoted comparison value
  (\`ms > "500"\`), and trailing tokens after the query.


EXAMPLES  (query  —  what it measures)
--------------------------------------
  count(checkout_completed)
      number of completed checkouts.

  count(add_to_cart{country="US"})
      number of US add-to-cart events (a user can count many times).

  sum(purchase{country="US"}, amount)
      total purchase amount from US purchase events.

  avg(req_dur{not tier="free"}, ms) without (region)
      mean request duration for non-free tiers, one series per region-excluded
      label combination.

  p99(req_dur{route=~"/api*"}, ms) by (route, status)
      99th-percentile latency of /api requests, split by route and status.

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
