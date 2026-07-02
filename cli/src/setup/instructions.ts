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

Feature flags, experiments, configs, kill switches, i18n, and feedback. Project bound via
\`.shipeasy\`; the \`@shipeasy/mcp\` server is registered for this agent (run
\`npx @shipeasy/cli login\` if a tool reports it's unauthenticated). Read flags/experiments
through the Shipeasy SDK (it caches — never re-fetch on the hot path) and report errors via
its error primitive. The exact calls are language-specific — get them from the installed
\`shipeasy-*\` skills or \`shipeasy docs get\`, never guess.`;
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
