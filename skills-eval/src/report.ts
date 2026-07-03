import type { CaseResult } from "./types.js";

/** Render the results as a matrix + a misses section. Returns the report text. */
export function renderReport(results: CaseResult[], threshold: number, k: number): string {
  const lines: string[] = [];
  lines.push(`\nSkill routing eval — ${results.length} cases × ${k} runs, threshold ${pct(threshold)}\n`);

  const idW = Math.max(4, ...results.map((r) => r.case.id.length));
  lines.push(
    `${"case".padEnd(idW)}  skill  tools  args   ask    state  clean  result`,
  );
  lines.push(`${"-".repeat(idW)}  -----  -----  -----  -----  -----  -----  ------`);
  for (const r of results) {
    lines.push(
      `${r.case.id.padEnd(idW)}  ${cell(r.skillHitRate)}  ${toolCell(r)}  ${optCell(r.argHitRate, (r.case.assert_args ?? []).length > 0)}  ${optCell(r.askHitRate, !!r.case.expect_ask)}  ${stateCell(r.statePass)}  ${cell(r.cleanRate)}  ${r.pass ? "PASS" : "FAIL"}`,
    );
  }

  const failed = results.filter((r) => !r.pass);
  if (failed.length) {
    lines.push(`\nMisses (${failed.length}):`);
    for (const r of failed) {
      lines.push(`  ✗ ${r.case.id}`);
      lines.push(`      prompt: ${r.case.prompt}`);
      for (const m of r.misses) lines.push(`      - ${m}`);
    }
  }

  const stateful = results.filter((r) => r.statePass !== null);
  if (stateful.length) {
    lines.push(`\nServer state after runs:`);
    for (const r of stateful)
      lines.push(`  ${r.statePass ? "✓" : "✗"} ${r.case.id}: ${r.stateDetail || "(nothing found)"}`);
  }

  const passed = results.filter((r) => r.pass).length;
  lines.push(`\n${passed}/${results.length} cases passed.\n`);
  return lines.join("\n");
}

function toolCell(r: CaseResult): string {
  if ((r.case.tools_match ?? (r.case.expect_tools.length ? "all" : "none")) === "none")
    return "  —  ";
  return cell(r.toolHitRate);
}

/** A rate cell that shows "—" when the dimension isn't asserted for this case. */
const optCell = (x: number, asserted: boolean) => (asserted ? cell(x) : "  —  ");

/** State is boolean (exists or not), not a rate. */
const stateCell = (s: boolean | null) => (s === null ? "  —  " : s ? " ok  " : "FAIL ");

const cell = (x: number) => `${Math.round(x * 100)}`.padStart(3) + "% ";
const pct = (x: number) => `${Math.round(x * 100)}%`;
