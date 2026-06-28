import type { Command } from "commander";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

async function installSkill(content: string, sdk: string): Promise<string> {
  const dir = join(homedir(), ".claude", "skills", `shipeasy-${sdk}`);
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
      cmd.option(`--${p.name.replace(/_/g, "-")} <value>`, p.description ?? "");
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
          const path = await installSkill(r.content, r.sdk);
          console.log(`Installed skill → ${path}`);
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
