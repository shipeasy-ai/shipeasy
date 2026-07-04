---
name: shipeasy-see
description: >
  Load this skill FIRST — before locating or editing any code — whenever the
  task is to log, report, or handle an error/exception: it carries the required
  see() call form, so read it before writing the catch. Required guidance for
  exception handling and error reporting in code that uses the Shipeasy SDK (any
  language). Relevant for try/catch (or the language's equivalent) blocks, error
  handling, a terse "log this error" / "report this error" on a caught error or
  a swallowed catch, migrating a native error log (console.error, logger.error,
  print/puts on an exception) to see(), writing consequences, and the errors
  primitive. If your task involves
  exceptions, errors, logging or reporting a caught error, or the
  see framework (see(), causes_the, Violation, ControlFlowException), this
  Skill provides best practices and implementation support. It also covers
  reading back how often a reported error fires — "error frequency", "how many
  times does this error happen/fail", "how noisy is this", "in the last 24h" —
  via the dedicated tracked-error read tools.
user-invocable: false
---

# see: Shipeasy's Structured Error Reporter

**First-time / "from scratch" install → defer to `shipeasy setup`.** This skill
is for *using* `see()` in a project that already has `@shipeasy/sdk` wired in. If
the ask is to "set up error reporting from scratch" / "install shipeasy error
reporting" / the SDK isn't installed yet, that is an onboarding step the
`shipeasy setup` CLI owns (it installs the SDK, keys, the error module + devtools)
— recommend running `shipeasy setup` first, then come back here to instrument the
catches. Don't hand-roll the install by editing config yourself.

`see` (shipeasy error) is the required error reporting API in code instrumented
with `@shipeasy/sdk` — server and client, vanilla JS, one import:

```ts
import { see } from "@shipeasy/sdk/client"; // or "@shipeasy/sdk/server"

see(problem).causes_the(subject).to(outcome).extras({ ...debugging });
```

The exact, version-correct call form for this project's SDK language is below —
use it verbatim; it wins over the TypeScript grammar examples in the rest of
this skill on any conflict:

{{SDK_SNIPPET:ops/see}}

**Core Philosophy**: Every handled exception must document its impact. If you
don't know the consequence, don't catch the exception. If catching an exception
creates an astonishing consequence, don't catch it. Prefer to fail-closed with
few high-level error boundaries.

## Components

- **Problem**: a caught `Error` (`see(e)`) or `see.Violation(name)` for
  non-exception issues
- **Consequence**: impact using the `.causes_the(subject).to(outcome)` chain
- **Extras**: optional debugging metadata with `.extras({ key: value })`

**Example issue title**: "TimeoutError causes the checkout to use cached prices"

**Integration**: occurrences ship immediately to the errors primitive —
fingerprint-grouped issues with status (open/resolved/ignored) in the Errors
dashboard tab, plus a near-real-time occurrence timeseries. The chain
dispatches on the next microtask; no `.send()` call exists or is needed.

## Exceptions

Pass the caught exception object as the problem when handling it in a catch
block:

```ts
try {
  await friendService.sendRequest(userId);
} catch (e) {
  see(e).causes_the("friend request").to("not be sent").extras({ recipient_user_id: userId });
}
```

## Violations

Use `see.Violation(name)` for non-exception problems. Prefer caught exceptions
when available. Prefer throwing an exception when possible.

**Format**: `Violation: '<name>' causes the <subject> to <outcome>`

```ts
see.Violation("large query").causes_the("foo results").to("be trimmed");
```

A violation has **no `.message()`** — its name is its whole identity. Any
variable/context data goes in `.extras()`:

```ts
see.Violation("large query")
  .causes_the("foo results")
  .to("be trimmed")
  .extras({ rows: rows.length });
```

**The violation name is a stable identifier** — it participates in the issue
fingerprint. Never interpolate variable data into the name; put it in
`.extras()`.

## Writing Effective Consequences

### Consequence Syntax and Philosophy

```ts
.causes_the(subject).to(outcome)
```

- **Subject**: the feature/object/process most affected by the problem
- **Outcome**: how that thing was impacted after handling the exception

Consequences become the title of grouped issues:
"{problem} causes the {subject} to {outcome}". Focus on the feature impact,
not the technical failure.

### Good Consequence Examples

```ts
// Clear subject and outcome — focus on user/product impact
.causes_the("user dashboard").to("show cached data")
.causes_the("notification").to("not be sent")
.causes_the("search results").to("be incomplete")
.causes_the("photo upload").to("be rejected")
.causes_the("payment").to("use backup processor")
.causes_the("friend list").to("be empty")
.causes_the("video").to("play from the beginning")
```

### Bad Consequence Examples (Avoid These)

**IMPORTANT: The examples in this section are ANTI-PATTERNS. These are
incorrect approaches that should NEVER be recommended or used in code. They
demonstrate what NOT to do.**

```ts
// WRONG: Redundant — doesn't add information
.causes_the("exception").to("be caught")
// WRONG: Redundant — doesn't add information
.causes_the("exception").to("be thrown")

// WRONG: Vague — doesn't specify impact
.causes_the("function").to("fail")
// WRONG: Vague — doesn't specify impact
.causes_the("service").to("fail")

// WRONG: References the problem instead of the consequence
.causes_the("database error").to("occur")

// WRONG: Too technical / implementation-focused
.causes_the("API response").to("be unavailable")
// WRONG: Too technical / implementation-focused
.causes_the("service data").to("be unavailable")

// WRONG: Too verbose
.causes_the("user's friend list ordered by age").to("be empty, making it look like the user has no friends")

// WRONG: HARD-BANNED — subject starts with an article; the title template
// already supplies "the", so this renders "causes the a network request"
.causes_the("a network request").to("fail without a response")

// WRONG: HARD-BANNED — variable data interpolated into the outcome; mints a
// separate issue per status code (500, 502, 503, …) and still names no feature
.causes_the("a network request").to(`fail with HTTP ${res.status}`)

// WRONG: HARD-BANNED — transport-level subject; names the mechanism, not the
// impact. "The network request failed" explains nothing and cannot be triaged.
.causes_the("network request").to("fail")
```

### Hard Bans

These shapes are banned outright. Never write them; flag them when reviewing
existing code:

1. **No leading article in the subject.** Issue titles render as
   `{problem} causes the {subject} to {outcome}` — the template supplies
   "the", so `causes_the("a network request")` produces the broken title
   "… causes the **a** network request …". The subject is a bare noun
   phrase: `causes_the("checkout")`, never `causes_the("a checkout")` or
   `causes_the("the checkout")`.
2. **No variable data in the subject or outcome.** Unlike `.extras()`, the
   consequence is **not** normalized before fingerprinting — digits and ids
   survive — so `` .to(`fail with HTTP ${res.status}`) `` mints one issue per
   status code. Write the class of failure (`to("fail with a server error")`)
   and put the value in `.extras()`.
3. **No transport-level subjects** — "network request", "HTTP request",
   "request", "fetch", "API call", "response". These describe the plumbing,
   not what broke for the user, so the resulting issue is impossible to act
   on. Name the feature the failed call was serving:
   `causes_the("flag snapshot").to("fall back to cached values")`, not
   `causes_the("network request").to("fail")`. If you genuinely cannot name
   the affected feature at the catch site, the catch is at the wrong
   altitude — let the error propagate to a handler that knows the impact
   (see Core Philosophy).

**Title read-aloud check (required):** before committing a consequence,
render the full title `{problem} causes the {subject} to {outcome}` and read
it as an English sentence. If it has doubled articles, embedded values, or
doesn't tell a product person what broke, rewrite it.

### Consequence Best Practices

1. **Focus on the user/product impact, not the technical failure**
2. **Use specific, actionable language that any person can understand**
3. **Don't reference the exception — it's already captured**
4. **Keep it concise but informative**
5. **Think about what issue title this would create**
6. **Ask: what would a user or product person see as the consequence?**

## Structured Debugging with .extras()

Include local variables in the report for later debugging:

```ts
see(e)
  .causes_the("photo upload")
  .to("be rejected")
  .extras({
    photo_id: photo.id,
    file_size: photo.size,
    is_premium_user: user.isPremium,
  });
```

Extras accept `string | number | boolean | null | undefined` values. `null` /
`undefined` are dropped automatically. Values are truncated to 200 chars; at
most 20 keys are kept. `.extras()` can be chained more than once — keys merge,
later wins.

**Exclude from extras**: exception details (already captured), the page URL,
user agent, user/anonymous ids, SDK version, environment (all attached
automatically), high-cardinality blobs, secrets/PII, static strings, and
context about the location of the see() call.

## Identifying Misuse

Look for broken grammar in consequences and these anti-patterns near catch
blocks:

1. **Empty catch blocks** — silent failures without reporting
2. **Unused exception objects** — catching but not using `e`
3. **console.error-only handling** — logs locally, documents no impact, never
   reaches the errors primitive

## see is Only For Reporting Problems

see should only be used to report unexpected problems — not for control-flow
analysis or "caveman debugging". Use `console.debug` (or your logger) for ad
hoc tracing.

## see is not for Product Metrics

Use `flags.track(eventName, props)` to capture product events for analysis and
experiments. Never use see for this purpose. see is only for reporting
problems.

Sometimes product metrics include failed states. First report the problem with
see, then additionally `flags.track()` it if a metric needs it.

## Critical Anti-Patterns to Avoid

### see() and re-throw is allowed (it powers the caused_by chain)

It is **fine** to `see()` an exception and then re-throw it. There is no "never
report before rethrowing" rule. When the same error is reported again at an
outer boundary — or wrapped with `{ cause }` and reported there — the SDK links
the later occurrence to the earlier one as a **`caused_by` chain** instead of
double-counting them. So reporting the specific inner consequence and letting
the error propagate is encouraged where the inner site knows something the
outer one doesn't:

```ts
// FINE: report the specific inner consequence, then re-throw. The outer
// boundary that reports this same error links back to here as its caused_by.
try {
  await chargeCard(order);
} catch (e) {
  see(e).causes_the("checkout").to("retry on the backup processor").extras({ order_id: order.id });
  throw e; // propagates; the outer report becomes a chained occurrence, not a dupe
}
```

Only avoid reporting the **same** consequence at two altitudes that both name
the same generic surface — that adds noise without adding a distinct
consequence. Report a distinct, more-specific consequence, or don't report at
the outer site at all.

### 1. Don't Use Violation for a Caught Exception

```ts
// WRONG: drops the exception's stack and type
try {
  return await service.getData();
} catch {
  see.Violation("exception").causes_the("service data").to("be missing");
  return null;
}

// CORRECT: pass the exception — stack + type make the issue debuggable
try {
  return await service.getData();
} catch (e) {
  see(e).causes_the("service data").to("be missing");
  return null;
}
```

## Correct Examples

(The basic catch + `see(e)` and `see.Violation` shapes are already shown above
— these cover the cases with extra moving parts.)

### 1: Wrapping Exceptions

When rethrowing as a different type, preserve the original exception with
`{ cause }`. You may report the specific inner consequence here if you know it
— if the wrapped error is later reported at an outer boundary, the two link as
a `caused_by` chain (no double-count). If the inner site has nothing specific
to add, just wrap and let the outer handler own the consequence:

```ts
try {
  await handleUpload(file);
} catch (e) {
  throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, { cause: e });
}
```

### 2: Mixed Logging

It is ok to log/track with other tools in addition to see, but see is required:

```ts
try {
  data = await service.getData();
} catch (e) {
  see(e)
    .causes_the("ad recommendation")
    .to("use fallback content")
    .extras({ recommendation_type: recommendationType });
  flags.track("service_failure", { service: "recommendations" }); // metric, optional
  return null;
}
```

### 3: Control Flow Exceptions (Critical Decision Point)

**IMPORTANT**: Some exception handling is actually control flow, not a true
error. **Before adding see() reporting, assess whether the exception is part
of expected program logic.**

Control flow exceptions should use `see.ControlFlowException()` instead of
see() reporting. This is especially critical in:

- **Validation/assessment logic** where exceptions determine program flow
- **Entity existence checks** where non-existence is a valid outcome
- **Multiple decoding/parsing strategies** tried in sequence

Signs of control flow exceptions:

1. **Entity loading attempts** where non-existence is a valid state
2. **Multiple decode/parse strategies** tried in sequence
3. **Checking for existence** using try/catch instead of a dedicated method

Exceptions as control flow are discouraged but sometimes necessary. Say why
with `.because()` — **the reason must start with "because"** — and optionally
attach local debug context with `.extras()`:

```ts
try {
  // blob could be either the Foo structure or the Bar structure, and the
  // only way to tell is to try decoding it. This throws when not Foo.
  return decodeFoo(blob);
} catch (e) {
  // e is not a problem — it was expected. Marking it also tells the SDK's
  // auto-capture to skip it if it escapes later. Nothing is reported.
  see.ControlFlowException(e).because("because it wasn't an encoded Foo");
  return decodeBar(blob);
}

// Optional debug context (kept on the mark for local debugging; never sent):
// see.ControlFlowException(e).because("because it wasn't a Foo").extras({ tried: "Foo" });
```

## Auto-Capture

The client SDK automatically reports **network failures** (fetch network errors
+ 5xx) into the same errors primitive (`autoCollect.errors`, on by default) —
each names a specific endpoint and a specific outcome. It deliberately does
**not** blanket-report uncaught exceptions or unhandled promise rejections:
those carry no actionable consequence ("the page hit an error" names the
plumbing, not the feature) and would mint one unactionable, double-counted
issue for every unrelated failure. Code that knows the consequence reports it
explicitly with `see()` at the catch site — auto-capture cannot do that for
you.

## Fingerprinting (What Makes Two Errors the Same Issue)

Issues are grouped by `sha256(error_type + normalized message + top stack
frame + subject|outcome)`. Digits, UUIDs, and hex runs in messages are
normalized away, so `order 123 failed` and `order 999 failed` fold into one
issue. The consequence participates on purpose: the same TypeError harming two
different product surfaces is two distinct issues. Implication: renaming a
consequence re-fingerprints the issue (the old row stops growing).

## Reading How Often an Error Fires

Instrumenting is half the loop — you also read back how noisy a reported error
is. When asked "how many times does this error happen / fail", "how often does
this fire", "error frequency", or "how many times in the last 24h", read the
answer straight from the analytics. Every `see()` occurrence is folded into a
tracked-error row keyed by fingerprint, carrying a running `count` plus
`firstSeenAt` / `lastSeenAt`. Read it back with the dedicated tracked-error
tools — the errors primitive's own read surface (distinct from the ops queue):

- `errors_list` — list tracked errors (filter by `status`, free-text `q`); each
  row carries `count` and `lastSeenAt`. Match the row by its consequence /
  message / `errorType` and read `count` for the total occurrences.
- `errors_series { id, from, to, bucket }` — the occurrence timeseries for one
  error id, for a "last 24h, by hour" breakdown once you have the id from
  `errors_list`.

This is a pure read: `errors_list` / `errors_series` answer the frequency
question directly, so the tracked-error row stays as-is.

```
mcp tool: errors_list { "q": "checkout charge" }
```

---

**Remember**: If you don't know the consequence of an exception, you probably
shouldn't be catching it. Let code that understands the impact handle it
properly. Focus on what users or product people would see as the consequence,
not technical implementation details.

This approach ensures all exception handling follows see best practices,
eliminates silent failures, and provides structured error reporting that
integrates with Shipeasy's Errors dashboard, the ops queue (the auto-filed
error/alert tickets you can list with `shipeasy ops list` and burn down with
the `shipeasy-ops-work` agent loop), and the near-real-time error timeseries.
