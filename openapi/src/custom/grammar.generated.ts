// GENERATED — do not edit.
//
// Written by `pnpm --filter @shipeasy/query-dsl gen:grammar` in the shipeasy
// monorepo, from the parser's own tables. `grammar.ts` interpolates these
// blocks so the printed reference cannot describe a language the parser does
// not accept. A drift test in that repo fails when this file is stale.

export const AGGREGATES_BLOCK = `<aggregate> ::=
    {   count ( <selector> )
      | sum ( <selector> [ , <value-label> ] )
      | avg ( <selector> [ , <value-label> ] )
      | min ( <selector> [ , <value-label> ] )
      | max ( <selector> [ , <value-label> ] )
      | stddev ( <selector> [ , <value-label> ] )
      | p ( <percentile> , <selector> [ , <value-label> ] )
    }`;

export const AGGREGATIONS_BLOCK = `| Aggregation | Measures | Value label |
| --- | --- | --- |
| \`count\` | how many matching events happened | not allowed |
| \`sum\` | total of a numeric label | optional — defaults to the event's own value |
| \`avg\` | mean of a numeric label | optional — defaults to the event's own value |
| \`min\` | smallest value of a numeric label | optional — defaults to the event's own value |
| \`max\` | largest value of a numeric label | optional — defaults to the event's own value |
| \`stddev\` | spread of a numeric label around its mean | optional — defaults to the event's own value |
| \`p\` | a percentile of a numeric label — \`p(95, req, ms)\` | optional — defaults to the event's own value |`;

export const FUNCTIONS_BLOCK = `<value_function> ::=
    {   { abs | log | log2 | log10 } ( <argument> )
      | round ( <argument> , <digits> )
      | pow ( <argument> , <exponent> )
      | { clamp_min | clamp_max } ( <argument> , <bound> )
    }

<rate_function> ::=
    { per_second | per_minute | per_hour } ( <argument> )

<time_function> ::=
    {   timeshift ( <argument> , <seconds> )
      | { derivative | diff | monotonic_diff | cumsum | integral } ( <argument> )
      | rollup ( <argument> , { avg | sum | min | max } , <seconds> )
      | { hour_before | day_before | week_before } ( <argument> )
    }

<series_function> ::=
    {   fill ( <argument> , { zero | last | linear | null } )
      | { count_nonzero | count_not_null | exclude_null } ( <argument> )
      | default_zero ( <argument> )
    }

<smoothing_function> ::=
    {   { autosmooth | trend_line | robust_trend } ( <argument> )
      | { ewma_3 | ewma_5 | ewma_10 | ewma_20 } ( <argument> )
      | { median_3 | median_5 | median_7 | median_9 } ( <argument> )
    }

<rank_function> ::=
    {   { top | bottom } ( <argument> , <k> , { mean | max | min | sum | last } , { asc | desc } )
      | { top_offset | bottom_offset } ( <argument> , <k> , { mean | max | min | sum | last } , { asc | desc } , <offset> )
    }`;

export const PARAMS_BLOCK = `| Function | Parameter | Accepts |
| --- | --- | --- |
| \`round\` | \`digits\` | integer 0–15 |
| \`pow\` | \`exponent\` | number |
| \`clamp_min\` | \`bound\` | number |
| \`clamp_max\` | \`bound\` | number |
| \`timeshift\` | \`seconds\` | integer |
| \`rollup\` | \`method\` (1 of 2) | one of avg, sum, min, max |
| \`rollup\` | \`seconds\` (2 of 2) | integer >= 1 |
| \`fill\` | \`mode\` | one of zero, last, linear, null |
| \`top\` | \`k\` (1 of 3) | integer >= 1 |
| \`top\` | \`by\` (2 of 3) | one of mean, max, min, sum, last |
| \`top\` | \`order\` (3 of 3) | one of asc, desc |
| \`bottom\` | \`k\` (1 of 3) | integer >= 1 |
| \`bottom\` | \`by\` (2 of 3) | one of mean, max, min, sum, last |
| \`bottom\` | \`order\` (3 of 3) | one of asc, desc |
| \`top_offset\` | \`k\` (1 of 4) | integer >= 1 |
| \`top_offset\` | \`by\` (2 of 4) | one of mean, max, min, sum, last |
| \`top_offset\` | \`order\` (3 of 4) | one of asc, desc |
| \`top_offset\` | \`offset\` (4 of 4) | integer >= 0 |
| \`bottom_offset\` | \`k\` (1 of 4) | integer >= 1 |
| \`bottom_offset\` | \`by\` (2 of 4) | one of mean, max, min, sum, last |
| \`bottom_offset\` | \`order\` (3 of 4) | one of asc, desc |
| \`bottom_offset\` | \`offset\` (4 of 4) | integer >= 0 |`;

export const SUGAR_BLOCK = `| You write | It means |
| --- | --- |
| \`ratio(count(a), count(b))\` | \`count(a) / count(b)\` |
| \`p95(ttfb)\` | \`p(95, ttfb)\` |
| \`week_before(count(a))\` | \`timeshift(count(a), -604800)\` |
| \`day_before(count(a))\` | \`timeshift(count(a), -86400)\` |
| \`hour_before(count(a))\` | \`timeshift(count(a), -3600)\` |
| \`default_zero(count(a))\` | \`fill(count(a), zero)\` |
| \`top(count(a) by (r), 5, mean, desc)\` | \`top(count(a), 5, mean, desc) by (r)\` |`;

export const LIMITS_BLOCK = `| Limit | Value |
| --- | --- |
| Query string length | 4096 |
| Expression nesting depth | 32 |
| Filter nesting depth | 3 |
| Values in one \`in (...)\` | 50 |`;

export const REFUSALS_BLOCK = `| Spelling | Why it is refused |
| --- | --- |
| \`count_users(…)\` | removed — Analytics Engine samples rows and weights the survivors, and a distinct count cannot be reweighted (sampling reweights rows, not sets), so it under-reports by the sample interval. Use count() |
| \`unique(…)\` | removed from the language — count(DISTINCT …) takes no sample weight, has no conditional form and cannot merge across groups. Stored metrics using it still render; no new one can be authored. Use count() |
| \`retention_Nd(…)\` | has no time-series form; retention lives in the experiment analyzer |
| \`anomalies(…)\` | detection is a property of the alert rule now, not of the metric: create an alert with kind 'anomaly' and set its sigma. The metric stays what it measures, and the same seasonal baseline can be drawn on its chart by turning the band on |
| \`deviation(…)\` | detection is a property of the alert rule now, not of the metric: an alert with kind 'anomaly' compares this metric against its own seasonal baseline in sigmas, at a sigma and a direction you set on the rule — so one metric can back rules of different sensitivity |
| \`outliers(…)\` | detection is a property of the alert rule now, not of the metric: an alert with kind 'outliers' on a metric grouped by() compares each group against its peers in the same bucket, at a sigma you set on the rule |
| \`expected(…)\` | the seasonal band is a display property of the metric now, not a function: turn the band on and every chart of this metric draws it — at the same sigma an anomaly alert would fire at |
| \`forecast(…)\` | the projection is a display property of the metric now, not a function: set the metric's forecast method and horizon, and every chart of it projects forward without changing what the metric measures |`;
