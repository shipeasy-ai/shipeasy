import type { Command } from "commander";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { customOperations, CustomOpError, type CustomOp } from "@shipeasy/openapi/custom";
import { defineGroup, num, bool, str } from "./_gen-runtime";
import { printJson } from "../util/output";

/**
 * CLI adapter for the shared custom-operations registry (`@shipeasy/openapi/custom`)
 * — the sugar commands that aren't admin API endpoints: `metrics grammar` and
 * `docs list/get/skill`. The registry is consumer-agnostic; this projects it
 * onto commander (the MCP server will project the same registry onto tools).
 *
 * The one consumer-side extra: `docs skill --install` writes the fetched skill
 * to the local agent skills dir — an fs side-effect layered on the worker-safe op.
 */
function coerce(op: CustomOp, positionals: string[], opts: Record<string, unknown>): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  let pi = 0;
  for (const p of op.params) {
    const raw = p.positional ? positionals[pi++] : opts[camel(p.name)];
    if (raw === undefined) continue;
    args[p.name] = p.type === "number" ? num(raw) : p.type === "boolean" ? bool(raw) : str(raw);
  }
  return args;
}
const camel = (s: string) => s.replace(/[-_]([a-z0-9])/g, (_, c) => c.toUpperCase());

/**
 * Write the fetched SDK skill to a skills dir. Skill discovery is per-agent —
 * Claude Code reads `.claude/skills/` (project) and `~/.claude/skills/`
 * (global); OpenCode auto-discovers `.claude/skills/`. Other agents (Codex,
 * Cursor, …) keep skills elsewhere, so `--dir` targets that agent's skills dir
 * explicitly. Default is project `.claude/skills/`; `--global` writes home.
 */
function installSkill(
  content: string,
  sdk: string,
  opts: { dir?: unknown; global?: unknown },
): string {
  const base = opts.dir
    ? resolve(String(opts.dir))
    : opts.global
      ? join(homedir(), ".claude", "skills")
      : join(process.cwd(), ".claude", "skills");
  const dir = join(base, `shipeasy-${sdk}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, content, "utf8");
  return path;
}

export function customCommands(program: Command): void {
  for (const op of customOperations) {
    // resolve / create the group chain (reuses generated-command grouping)
    let node = program;
    for (const seg of op.group) node = defineGroup(node, seg, { summary: `${seg} commands` });

    const cmd = node.command(op.name).description(op.summary);
    if (op.description) cmd.addHelpText("after", `\n${op.description}\n`);
    const positionals = op.params.filter((p) => p.positional);
    for (const p of positionals) cmd.argument(`<${p.name}>`, p.description ?? "");
    for (const p of op.params.filter((p) => !p.positional)) {
      const flag = `--${p.name.replace(/_/g, "-")}`;
      // Booleans are presence flags (`--install`); everything else takes a value.
      cmd.option(p.type === "boolean" ? flag : `${flag} <value>`, p.description ?? "");
    }
    // `docs skill --install` is host-aware: --dir targets a specific agent's
    // skills dir, --global writes to ~/.claude/skills (default is project).
    if (op.name === "skill") {
      cmd.option("--dir <path>", "Skills dir to install into (for non-Claude agents)");
      cmd.option("--global", "Install into ~/.claude/skills instead of ./.claude/skills");
    }

    cmd.action(async (...argv: unknown[]) => {
      const opts = (argv[positionals.length] ?? {}) as Record<string, unknown>;
      const pos = argv.slice(0, positionals.length).map(String);
      try {
        const args = coerce(op, pos, opts);
        const result = await op.run(args);
        // `docs skill --install` writes the fetched skill locally (fs side-effect).
        if (op.name === "skill" && (opts.install === true || String(opts.install) === "true")) {
          const r = result as { content: string; sdk: string };
          const path = installSkill(r.content, r.sdk, { dir: opts.dir, global: opts.global });
          console.log(`Installed skill → ${path}`);
          if (!opts.dir) {
            console.log(
              "Read by Claude Code & OpenCode. For Codex/other agents, re-run with --dir <that agent's skills dir>.",
            );
          }
          return;
        }
        printJson(result);
      } catch (e) {
        if (e instanceof CustomOpError) console.error(`Error (${e.status}): ${e.message}`);
        else console.error(String(e));
        process.exit(1);
      }
    });
  }
}
