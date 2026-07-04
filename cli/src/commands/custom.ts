import type { Command } from "commander";
import { customOperations, customGroups, CustomOpError, type CustomOp } from "@shipeasy/openapi/custom";
import { defineGroup, num, bool, str } from "./_gen-runtime";
import { printJson } from "../util/output";
import { getBoundSdk } from "../util/project-config";
import { installSkill } from "../setup/sdk-docs";

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

export function customCommands(program: Command): void {
  // Group-level help keyed by path (e.g. `docs`) so a custom group reads as
  // richly as a spec-backed one instead of the bare `"<name> commands"`.
  const groupMeta = new Map(customGroups.map((g) => [g.group.join("\0"), g]));
  for (const op of customOperations) {
    // resolve / create the group chain (reuses generated-command grouping)
    let node = program;
    for (let i = 0; i < op.group.length; i++) {
      const meta = groupMeta.get(op.group.slice(0, i + 1).join("\0"));
      node = defineGroup(
        node,
        op.group[i],
        meta
          ? { summary: meta.summary, help: meta.description, aliases: meta.aliases }
          : { summary: `${op.group[i]} commands` },
      );
    }

    const cmd = node.command(op.name).description(op.summary);
    if (op.description) cmd.addHelpText("after", `\n${op.description}\n`);
    const positionals = op.params.filter((p) => p.positional);
    for (const p of positionals) cmd.argument(`<${p.name}>`, p.description ?? "");
    for (const p of op.params.filter((p) => !p.positional)) {
      const flag = `--${p.name.replace(/_/g, "-")}`;
      // Booleans are presence flags (`--install`); everything else takes a value.
      cmd.option(p.type === "boolean" ? flag : `${flag} <value>`, p.description ?? "");
    }
    // `docs skill --install` delegates placement to the `skills` CLI, which
    // auto-detects coding agents and offers a pick. These tune that:
    if (op.name === "skill") {
      cmd.option("--agent <name>", "Install into one agent (skips the picker, e.g. claude-code, codex)");
      cmd.option("--global", "Install into the user-global skills dir");
      cmd.option("--dir <path>", "Write this exact skills dir instead of delegating to the skills CLI");
    }

    cmd.action(async (...argv: unknown[]) => {
      const opts = (argv[positionals.length] ?? {}) as Record<string, unknown>;
      const pos = argv.slice(0, positionals.length).map(String);
      try {
        const args = coerce(op, pos, opts);
        // `docs` defaults its `--sdk` to the `sdk` recorded in the nearest
        // `.shipeasy`, so callers inside a bound project can omit it.
        if (op.group[0] === "docs" && !args.sdk) {
          const sdk = getBoundSdk(process.cwd());
          if (sdk) args.sdk = sdk;
        }
        const result = await op.run(args);
        // `docs skill --install` installs the fetched skill (delegating agent
        // detection + placement to the `skills` CLI).
        if (op.name === "skill" && (opts.install === true || String(opts.install) === "true")) {
          const r = result as { content: string; sdk: string };
          const res = await installSkill(r.content, r.sdk, {
            dir: opts.dir ? String(opts.dir) : undefined,
            global: opts.global === true,
            agent: opts.agent ? String(opts.agent) : undefined,
          });
          console.log(
            res.action === "wrote"
              ? `Installed skill → ${res.detail}`
              : `Installed skill shipeasy-${r.sdk} (${res.detail}).`,
          );
          return;
        }
        // `metrics grammar` is a human/agent-facing reference document — print it
        // as raw text, not a JSON-escaped `{ "grammar": "...\n..." }` blob.
        if (op.group[0] === "metrics" && op.name === "grammar") {
          console.log((result as { grammar: string }).grammar);
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
