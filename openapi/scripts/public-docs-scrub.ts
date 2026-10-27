/**
 * Narrow generated reference markdown to what docs.shipeasy.ai publishes.
 *
 * The operation registry describes the whole admin surface, including products
 * that are not marketed: experiments (A/B tests, holdouts, SRM and
 * sequential-testing guards, ship/hold verdicts), universes and i18n. The CLI
 * and the MCP server must keep every one of those operations and parameters —
 * they are real, tested and in use — so the scrub runs on the OUTPUT of the doc
 * generators (the `.mdx` for the public site), never on the registry.
 *
 * `gen-cli-docs.ts` and `gen-mcp-docs.ts` both call {@link scrubPublicDocs}
 * for their docs-site target. The docs repo has a sibling filter for the OpenAPI
 * reference (`src/lib/public-spec.ts` there); keep the vocabulary in step.
 *
 * Rules, in order:
 *   1. a table row for an option/parameter named after a hidden concept is
 *      dropped (`--stat-method`, `holdout_gate`, `--default-allocation-pct`);
 *   2. a gate `type` row is dropped (its only other value was `holdout`);
 *   3. phrases that name a hidden concept inside a longer sentence are rewritten;
 *   4. what is left in a description cell or a prose line is filtered sentence by
 *      sentence — a sentence that still talks about a hidden concept goes.
 *
 * Idempotent: scrubbing already-scrubbed text changes nothing.
 */

/** An option / parameter name that only means something to a hidden product. */
const HIDDEN_PARAM =
  /experiment|holdout|universe|allocation|cuped|msprt|^srm|\bsrm\b|srm[-_]|GROUPS_WEIGHT_SUM|sequential|significance|sig[-_]?threshold|stat[-_]?method|auto[-_]?rollback|min[-_]?sample|min[-_]?runtime|default[-_]?power|ci[-_]?confidence|default[-_]?mei|min[-_]?effect|verdict|peek/i;

/** A sentence that still names a hidden concept after the rewrites. */
const HIDDEN_TEXT =
  /experiment|a\/b|holdout|\bsrm\b|sequential test|universe|significance|ship\/hold/i;

const REWRITES: [RegExp, string][] = [
  [/\s*\(e\.g\. sequential testing[^)]*\)/g, ""],
  [/maximum experiments, metrics, or configs/g, "maximum metrics or configs"],
  [/\(universe, metric, gate, event\)/g, "(metric, gate, event)"],
  [/\bgates\/experiments\b/g, "gates"],
  [/\bgate\/experiment\b/g, "gate"],
  [/in an experiment or alert rule/g, "in an alert rule"],
  [/to attach as an experiment's success metric/g, "to reference from an alert rule"],
  [/once no running experiment depends on it/g, "once nothing uses it any more"],
  [/,\s*experiment-analysis knobs \([^)]*\),/g, ","],
  // list members
  [/ \\\| "experiment"/g, ""],
  [/flag, experiment, metrics/g, "flag, metrics"],
  [/\bexperiments:(?:read|write),? ?/g, ""],
  [/,? ?experiments:(?:read|write)/g, ""],
  // "feature delivery — flags, kill switches, dynamic configs, A/B experiments, and the universes…"
  [/, A\/B experiments, and the universes they bucket in/g, ""],
  [/, A\/B\/n experiments, and the universes that bucket\s+them/g, ""],
  [/ and experiment success \/ guardrail measurement/g, ""],
  [/, experiment SRM\/peek guards,/g, ","],
  [/ \(statistical method, significance threshold[^)]*\)/g, ""],
  [/, alert rules, and experiments all share/g, " and alert rules all share"],
  [/, and experiments\b/g, ""],
  [/, experiments\b,?/g, ","],
  [/\bflag\/config\/killswitch\/metric\/alert rule\/experiment\b/g, "flag/config/killswitch/metric/alert rule"],
  [/, `alert_rule`, or `experiment`/g, " or `alert_rule`"],
  [/ \+ experiments\b/g, ""],
  [/\bflags \+ experimentation platform\b/g, "flags platform"],
  [/ the whole flags \+ experimentation platform/g, " the flags platform"],
];

function rewrite(text: string): string {
  let out = text;
  for (const [re, rep] of REWRITES) out = out.replace(re, rep);
  // A list that lost its last member must not keep the comma before `)`.
  return out.replace(/,(\s*\))/g, "$1");
}

/** Drop every sentence that still names a hidden concept. */
function dropSentences(text: string): string {
  if (!HIDDEN_TEXT.test(text)) return text;
  const parts = text.split(/(?<=[.!?])(?<!e\.g\.|i\.e\.)\s+/).filter((s) => !HIDDEN_TEXT.test(s));
  return parts.join(" ");
}

function scrubText(text: string): string {
  return dropSentences(rewrite(text)).trim();
}

/** Cells of a markdown table row. Pipes escaped as `\|` stay inside a cell. */
function cellsOf(row: string): string[] {
  return row.split(/(?<!\\)\|/).slice(1, -1);
}

function firstCellName(cell: string): string {
  return cell.replace(/[`\\]/g, "").replace(/^--/, "").trim();
}

function scrubRow(raw: string): string | null {
  // Phrase rewrites reach every cell (an enum type cell lists `"experiment"`);
  // only the description is filtered sentence by sentence.
  const row = rewrite(raw);
  const cells = cellsOf(row);
  if (cells.length < 2) return row;
  const name = firstCellName(cells[0]);
  if (HIDDEN_PARAM.test(name)) return null;
  // A gate's `type` once chose between `targeting` and `holdout`.
  if (/^(?:type|--type)\b/.test(name) && /holdout/i.test(row)) return null;

  const last = cells.length - 1;
  const desc = cells[last].trim();
  const cleaned = scrubText(desc);
  if (cleaned === desc) return row;
  const next = [...cells];
  next[last] = ` ${cleaned || "—"} `;
  return `|${next.join("|")}|`;
}

export function scrubPublicDocs(markdown: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    // Code blocks are command examples, not prose: rewrite phrases but never
    // drop a line out of the middle of an example.
    if (inFence) {
      out.push(rewrite(line));
      continue;
    }
    if (line.startsWith("|")) {
      // Header and separator rows have no hidden vocabulary and no description.
      const scrubbed = /^\|\s*[-:| ]+\|?\s*$/.test(line) ? line : scrubRow(line);
      if (scrubbed !== null) out.push(scrubbed);
      continue;
    }
    if (!HIDDEN_TEXT.test(line) && !line.includes("experiment")) {
      out.push(line);
      continue;
    }
    const indent = /^\s*/.exec(line)?.[0] ?? "";
    const cleaned = scrubText(line);
    // A bullet or paragraph that was only about a hidden concept disappears; a
    // heading never does (the section structure is generated, not authored).
    if (cleaned === "" && !line.startsWith("#")) continue;
    out.push(cleaned === "" ? line : indent + cleaned);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
