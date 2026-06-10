---
name: see
description: >
  Expert guidance on required exception handling and error reporting in code
  that uses @shipeasy/sdk. Relevant for try/catch blocks, error handling,
  migrating console.error to see(), writing consequences, and the errors
  primitive. If your task involves exceptions, errors, error logging, or the
  see framework (see(), causes_the, Violation, ControlFlowException), this
  Skill provides best practices and implementation support.
user-invocable: false
---

# see: Shipeasy's Structured Error Reporter

`see` (shipeasy error) is the required error reporting API in code instrumented
with `@shipeasy/sdk` — server and client, vanilla JS, one import:

```ts
import { see } from "@shipeasy/sdk/client"; // or "@shipeasy/sdk/server"

see(problem).causes_the(subject).to(outcome).extras({ ...debugging });
```

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

Option: include a message to provide more context:

```ts
see.Violation("large query")
  .message(`got ${rows.length} rows`)
  .causes_the("foo results")
  .to("be trimmed");
```

**The violation name is a stable identifier** — it participates in the issue
fingerprint. Never interpolate variable data into the name; put it in
`.message()` or `.extras()`.

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
```

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
4. **Reporting before rethrowing** — creates double-counted issues

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

### 1. NEVER see() Before Throwing

```ts
// WRONG: see() before throw is NOT handling the exception — the error will be
// captured AGAIN by the uncaught handler or an outer boundary (double count).
if (homeOwner == null) {
  see.Violation("unsupported null owner type")
    .causes_the("avatar background image")
    .to("be greyed out");
  throw new Error("Home owner is null"); // exception still thrown!
}

// CORRECT: Either handle the problem OR throw it, never both
if (homeOwner == null) {
  throw new Error("Home owner is null");
}
```

### 2. Don't Report Before Rethrowing

```ts
// WRONG: creates redundant, double-counted issues
try {
  await service.getData();
} catch (e) {
  see(e).causes_the("service").to("fail"); // bad consequence too
  throw e; // not actually handling!
}

// CORRECT: remove the catch block entirely
await service.getData();
```

This rule only applies to error reporting. Teams can still `flags.track()`
their own metrics in catch blocks before rethrowing.

### 3. Don't Use Violation for a Caught Exception

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

### 1: Friend Request Processing

```ts
try {
  await friendService.sendRequest(userId);
} catch (e) {
  see(e)
    .causes_the("friend request")
    .to("not be sent")
    .extras({ recipient_user_id: String(userId) });
}
```

### 2: Astonishing Limit Applied

The applied limit is astonishing. Inform the developer that the query loaded
too many results. The consequence is that the results are trimmed.

```ts
if (results.length > RESULT_LIMIT) {
  see.Violation("large query").causes_the("foo results").to("be trimmed");
  return results.slice(0, RESULT_LIMIT);
}
```

### 3: File Upload Processing

```ts
for (const file of files) {
  try {
    await processFile(file);
  } catch (e) {
    see(e)
      .causes_the("uploaded file")
      .to("be skipped")
      .extras({ filename: file.name, file_size: file.size, file_type: file.type });
    continue;
  }
}
```

### 4: Wrapping Exceptions

When rethrowing as a different type, preserve the original exception — and do
NOT see() (the outer handler owns the consequence):

```ts
try {
  await handleUpload(file);
} catch (e) {
  throw new ApiException(ApiErrorCode.SERVICE_UNAVAILABLE, { cause: e });
}
```

### 5: Mixed Logging

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

### 6: Control Flow Exceptions (Critical Decision Point)

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

Exceptions as control flow are discouraged but sometimes necessary.
**The reason string must start with "because"**:

```ts
try {
  // blob could be either the Foo structure or the Bar structure, and the
  // only way to tell is to try decoding it. This throws when not Foo.
  return decodeFoo(blob);
} catch (e) {
  // e is not a problem — it was expected. Marking it also tells the SDK's
  // uncaught-error auto-capture to skip it if it escapes later.
  see.ControlFlowException(e, "because it wasn't an encoded Foo");
  return decodeBar(blob);
}
```

## Auto-Capture

The client SDK automatically reports uncaught exceptions, unhandled promise
rejections, and network failures (fetch network errors + 5xx) into the same
errors primitive (`autoCollect.errors`, on by default). This is the outer
safety net — it does NOT replace see() in catch blocks, where you know the
consequence and auto-capture cannot.

## Fingerprinting (What Makes Two Errors the Same Issue)

Issues are grouped by `sha256(error_type + normalized message + top stack
frame + subject|outcome)`. Digits, UUIDs, and hex runs in messages are
normalized away, so `order 123 failed` and `order 999 failed` fold into one
issue. The consequence participates on purpose: the same TypeError harming two
different product surfaces is two distinct issues. Implication: renaming a
consequence re-fingerprints the issue (the old row stops growing).

---

**Remember**: If you don't know the consequence of an exception, you probably
shouldn't be catching it. Let code that understands the impact handle it
properly. Focus on what users or product people would see as the consequence,
not technical implementation details.

This approach ensures all exception handling follows see best practices,
eliminates silent failures, and provides structured error reporting that
integrates with Shipeasy's Errors dashboard, ops queue (`/shipeasy:ops:work`),
and near-real-time error timeseries.
