---
description: Print the Shipeasy metric query DSL grammar
---

```bash
shipeasy metrics grammar
```

Quick reference:

```
name(event[{label op value, ...}][, value_label]) [by (l1, l2)] [without (l1)]
```

Aggregations: `count_users`, `count`, `sum`, `avg`, `min`, `max`,
`unique`, `p50`/`p75`/`p90`/`p95`/`p99`/`p999`, `retention_<N>d`.

Match ops: `=`, `!=`, `=~`, `!~`. Strings quoted.

Examples:

```
count_users(checkout_completed)
sum(purchase{country="US"}, amount)
p99(req_dur{route=~"/api/.*"}, ms) by (route, status)
retention_7d(session_start)
avg(req_dur{tier!="free"}, ms) without (region)
```

Labels referenced in filters / value position / `by` / `without` must
be declared as properties on the source event.
