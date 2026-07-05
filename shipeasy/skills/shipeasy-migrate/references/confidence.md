# Confidence → Shipeasy

Source-specific half of a **Spotify Confidence** migration. Pair with
<conventions.md>. Confidence publishes an MCP server (flags + docs); a
management REST API exists for full-fidelity reads.

## Prerequisites (Confidence side)

**Confidence flags MCP.** Test `listClients`. If unavailable:

```
claude mcp add confidence --transport http --url https://mcp.confidence.dev/mcp/flags
```

(OAuth in browser.) Tools used: `listClients`, `listFlags` / `getFlag`,
`getContextSchema`, `resolveFlag`.

**Management REST (optional, full-fidelity).** For constructs the MCP read
doesn't fully expose (partial allocation, reusable segments, exclusivity,
holdbacks), the REST API at `https://flags.confidence.dev/v1` gives the raw flag
definition. Get a short-lived token via client-credentials
(`Admin → API Clients` → exchange at `https://iam.confidence.dev/v1/oauth/token`
for `Authorization: Bearer $CONFIDENCE_TOKEN`). Store only as a session env var;
never write the token/secret to the plan.

## The Confidence model (source)

- **Client** — the app that resolves flags → maps to the Shipeasy **project**
  (already bound; nothing to choose).
- **Flag** — a name, a set of named **variants** (each with a struct/typed
  value or a boolean), and an **ordered list of targeting rules**. Confidence
  has **no server-side default** — an unmatched caller gets the value the call
  site passed. Each rule carries `variantAllocations` (a map variant → percent
  summing to 100) + a `criteria`/`expression` targeting payload.
- **Targeting** — `criteria` (named refs, each an `attribute` + a rule like
  `eqRule`/`setRule`/`rangeRule`/`startsWithRule`/`endsWithRule`/`anyRule`) and
  an `expression` tree (`and`/`or`/`not`/`ref`).
- **Context schema / entity** — Confidence's typed context fields; the
  randomization `entity` maps to the Shipeasy **unit**.
- **Segment** — a reusable targeting definition.

## Type mapping (Confidence → Shipeasy)

| Confidence flag | Shipeasy resource |
|---|---|
| Boolean flag (single boolean variant, on/off + targeting) | **gate**. Ordered rules → an ordered `stack`; each rule's enabled-variant allocation % → the entry's `rolloutPct`. |
| Struct flag, one variant served by deterministic targeting | **config** (value = that variant's struct); alternate variants by audience → config + gate(s) (conventions.md → "Targeted configs") |
| Struct flag with **weighted** variant allocations (an A/B/n test) | **experiment**: variants → groups, allocation % → group `weight` (basis points, sum 10000); partial rollout → `allocation_percent`; targeting → `targeting_gate`; variant struct values → group `params` |
| Flag referencing a **holdback** / global control | universe `holdout_range` (conventions.md → holdouts) |
| **Segment** (reusable) | migrate once as a Shipeasy gate, reference via `gate_pass`; or inline its criteria into each flag |

**Ordered rules → gate stack.** Confidence tries rules in order, first match
assigns the variant — the same first-match-wins waterfall as the gate `stack`.
One `stack` entry per Confidence rule, in order; fold the rule's
`variantAllocations` (the pass share of the on-variant) into `rolloutPct`. A
rule with an omitted/empty targeting payload (catch-all) → a bottom `rollout`
entry.

## Operator mapping (Confidence criteria → Shipeasy)

Each Confidence criterion is `{ attribute: { attributeName, <rule> } }`;
translate the `<rule>` and combine with the `expression` tree.

| Confidence criterion rule | Shipeasy `op` |
|---|---|
| `eqRule` (string/number/bool) | `eq` |
| `eqRule` with `versionValue` | `eq` (on the version string) |
| `setRule { values }` | `in` |
| `rangeRule.startInclusive` (number/timestamp) | `gte` |
| `rangeRule.startExclusive` | `gt` |
| `rangeRule.endInclusive` | `lte` |
| `rangeRule.endExclusive` | `lt` |
| `rangeRule` with `versionValue` bounds | `semver_gte` / `semver_gt` / `semver_lte` / `semver_lt` |
| `startsWithRule { value }` | `regex` `^value` |
| `endsWithRule { value }` | `regex` `value$` |
| `anyRule` / `allRule` (list attribute) | `contains` |
| ruleless attribute (presence check) | note for review (no null op) — or `neq`/`eq` vs sentinel |

Expression combinators:
- `ref` (single) → one flat rule.
- `and` of refs → flat `rules` (all ANDed).
- `or` of refs on the same attribute → one `in`; across attributes → a `stack`
  `condition` with `pass: "any"`.
- `not` wrapping a ref → the negated `op` (`eq`→`neq`, `in`→`not_in`,
  `startsWith`→`regex` negative construction / note).

`attributeName` → Shipeasy `attr` verbatim; map recognizable built-ins
(`country`, `browser`, `os`, `device`) to the canonical names in
conventions.md. Because Shipeasy has native `contains`/`regex`/`not_in`, most
Confidence criteria translate directly — the criteria/expression proto collapses
into the flat `{ attr, op, value }` list plus a `stack` for cross-attribute OR
and the rule waterfall.

## Confidence-specific execute notes

- **No server-side default** on either side conceptually, but Shipeasy gates
  return their default at the call site too — recreate a Confidence catch-all
  rule as the bottom `stack` entry (config: the catch-all value; experiment: the
  control group).
- **Partial variant allocation** (allocations that don't sum to a full rollout)
  → `allocation_percent` on an experiment, or the entry `rolloutPct` on a gate.
- **Reusable segments** → prefer one migrated gate + `gate_pass` to preserve
  dedup; inline only small one-offs.
- Read the raw flag via the **REST** endpoint when the MCP `getFlag` view omits
  allocation/holdback detail you need for fidelity.
