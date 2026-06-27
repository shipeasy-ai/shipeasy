import type { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { docsOperations, opId, type Operation, type OpInput } from "@shipeasy/openapi";
import { mountResource } from "./_registry";

/**
 * The `docs` module — SDK documentation fetched from each SDK repo's published
 * GitHub Pages `/docs/` folder (replaces the old static `get_sdk_snippet`). The
 * registry op does the fetch; the CLI owns only display and the `skill --install`
 * fs write (a consumer side-effect layered on the returned bytes).
 */

/** Where `docs skill --install` drops the skill (mirrors the agent skills dir). */
function installSkill(sdk: string, content: string): string {
  const dir = join(homedir(), ".claude", "skills", `shipeasy-${sdk}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, content, "utf8");
  return path;
}

function printResult(op: Operation, data: unknown, input: OpInput): void {
  switch (opId(op)) {
    case "docs.list": {
      const d = data as { sdk: string; fallback: boolean; pages: string[]; snippets: Record<string, string[]>; skill: boolean };
      console.log(`SDK: ${d.sdk}${d.fallback ? " (no published docs yet — built-in defaults)" : ""}`);
      console.log(`Pages:    ${d.pages.join(", ") || "—"}`);
      for (const [group, leaves] of Object.entries(d.snippets)) {
        console.log(`Snippets: ${group}/${leaves.join(`, ${group}/`)}`);
      }
      console.log(`Skill:    ${d.skill ? "yes" : "no"}`);
      return;
    }
    case "docs.get":
      return void process.stdout.write((data as { content: string }).content + "\n");
    case "docs.skill": {
      const d = data as { sdk: string; content: string };
      if (input.install) {
        const path = installSkill(d.sdk, d.content);
        return void console.log(`Installed ${d.sdk} skill → ${path}`);
      }
      return void process.stdout.write(d.content + "\n");
    }
    default:
      return void console.log(JSON.stringify(data, null, 2));
  }
}

export function docsCommand(program: Command): Command {
  const docs = program.command("docs").description("Fetch SDK documentation (pages, snippets, skills)");
  mountResource(docs, docsOperations, printResult);
  return docs;
}
