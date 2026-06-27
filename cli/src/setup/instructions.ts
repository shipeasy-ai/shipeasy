import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { InstallCtx } from "./agents";

const START = "<!-- shipeasy:start -->";
const END = "<!-- shipeasy:end -->";

/**
 * The shared guidance every agent gets — what Shipeasy is, that the MCP server
 * is wired up, and the entry-point workflows. Kept framework-agnostic so the
 * same body works in AGENTS.md, Cursor rules, and Copilot instructions.
 */
export function instructionsBody(): string {
  return `## Shipeasy

This project uses [Shipeasy](https://shipeasy.ai) for feature flags, A/B experiments,
dynamic configs, kill switches, i18n, and in-app feedback + production-error tracking.
The project is bound via the committed \`.shipeasy\` file.

The Shipeasy MCP server (\`@shipeasy/mcp\`) is registered for this agent — use its tools
to create/list/update gates, experiments, configs, metrics, and to manage feedback. If a
tool reports it is not authenticated, run \`npx @shipeasy/cli login\` once in a terminal.

Workflows:
- Feature gates, dynamic configs, kill switches, experiments, event metrics — \`/shipeasy:flags:install\` (Claude) or the \`exp_*\` MCP tools.
- In-app bug reports, feature requests, production errors, alerts — \`/shipeasy:ops:install\`.
- Translations (i18n) — \`/shipeasy:i18n:install\`.

Read flags/experiments from the SDK (never re-fetch on the hot path — the SDK caches):

\`\`\`ts
import { gates, experiments } from "@shipeasy/sdk/server"; // or "@shipeasy/sdk/client"
if (await gates.check("checkout_v2", { user_id })) { /* new path */ }
\`\`\`

Error handling: wrap meaningful \`catch\` blocks with \`see()\` from \`@shipeasy/sdk\` so
failures are reported (see the \`shipeasy:see\` skill).`;
}

/** Insert or replace the marker-fenced Shipeasy block in shared markdown. */
export function upsertMarkedBlock(existing: string | null, body: string): string {
  const block = `${START}\n${body}\n${END}`;
  if (existing && existing.includes(START) && existing.includes(END)) {
    const re = new RegExp(`${escapeRe(START)}[\\s\\S]*?${escapeRe(END)}`);
    return existing.replace(re, block).replace(/\s*$/, "") + "\n";
  }
  const base = (existing ?? "").replace(/\s*$/, "");
  return (base ? `${base}\n\n${block}` : block) + "\n";
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface FileResult {
  action: "wrote" | "updated" | "skipped";
  path: string;
}

function upsertFile(path: string, body: string, ctx: InstallCtx): FileResult {
  const existed = existsSync(path);
  const current = existed ? readFileSync(path, "utf8") : null;
  const next = upsertMarkedBlock(current, body);
  if (current === next) return { action: "skipped", path };
  if (ctx.dryRun) return { action: existed ? "updated" : "wrote", path };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next, "utf8");
  return { action: existed ? "updated" : "wrote", path };
}

/** Universal `AGENTS.md` — read by Codex, Jules, Cursor, and others. */
export function writeAgentsMd(ctx: InstallCtx): FileResult {
  return upsertFile(join(ctx.cwd, "AGENTS.md"), instructionsBody(), ctx);
}

/** GitHub Copilot repo instructions. */
export function writeCopilotInstructions(ctx: InstallCtx): FileResult {
  return upsertFile(join(ctx.cwd, ".github", "copilot-instructions.md"), instructionsBody(), ctx);
}

/**
 * Cursor project rule. This is a dedicated file we own (`shipeasy.mdc`), so it
 * carries the standard `.mdc` frontmatter and is rewritten wholesale rather than
 * marker-merged.
 */
export function writeCursorRule(ctx: InstallCtx): FileResult {
  const path = join(ctx.cwd, ".cursor", "rules", "shipeasy.mdc");
  const content =
    `---\ndescription: How this project uses Shipeasy (flags, experiments, i18n, feedback) and its MCP server.\nalwaysApply: false\n---\n\n` +
    instructionsBody() +
    "\n";
  const existed = existsSync(path);
  const current = existed ? readFileSync(path, "utf8") : null;
  if (current === content) return { action: "skipped", path };
  if (ctx.dryRun) return { action: existed ? "updated" : "wrote", path };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return { action: existed ? "updated" : "wrote", path };
}
