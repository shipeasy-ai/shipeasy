---
name: shipeasy-bugs
description: File and manage in-app bug reports and feature requests captured by Shipeasy devtools. Trigger on "bug report", "feature request", "feedback", "user-reported issue", "report a bug".
user-invocable: true
---

# Shipeasy bugs & feature requests

The `feedback` module captures user-submitted bug reports and feature
requests through the in-browser devtools overlay (`?se=1` /
`?se_devtools=1` on any page that loads `getBootstrapHtml()`). The CLI
mirrors the same admin API so reports can also be filed and triaged from
a terminal or a CI script.

## Enabling on a project

```bash
shipeasy modules enable feedback
shipeasy modules list           # confirm `feedback` shows ✓
```

The toggle is per-project: same `.shipeasy` binding the rest of the CLI
uses. Devtools picks it up on the next load — no rebuild required.

## Filing from the CLI

```bash
shipeasy feedback bugs create "Checkout button is unresponsive on mobile" \
  --description "Tapping 'Pay' on iOS Safari does nothing on slow 3G." \
  --page-url "https://acme.com/checkout"

shipeasy feedback features create "Bulk-archive in dashboard" \
  --description "Lets ops clear stale gates without opening each row."
```

## Listing & triage

```bash
shipeasy feedback bugs list
shipeasy feedback bugs delete <id-or-prefix>

shipeasy feedback features list
shipeasy feedback features delete <id-or-prefix>
```

`list` returns the most-recent rows; pipe through `--json` for scripts.

## Reading from the SDK

There is no public SDK surface for bugs/features yet — the devtools
overlay is the only customer-facing producer, and the CLI/admin API are
the consumer surface. Skip ahead to the experiments or flags skill if
you need a programmatic read path.

## When to use this skill

- User says "the customer reported a bug" / "log a feature request" /
  "show me open feedback".
- A devtools-captured report needs triaging from a script or CI job.
- Onboarding asks how to expose the in-page report button — the answer is
  `shipeasy modules enable feedback`.

## Errors → action

| Error                     | Action                                            |
| ------------------------- | ------------------------------------------------- |
| `403 module not enabled`  | Run `shipeasy modules enable feedback` and retry. |
| `401`                     | Re-run `shipeasy login`.                          |
| `404 not found` on delete | Check the ID with `shipeasy feedback bugs list`.  |
