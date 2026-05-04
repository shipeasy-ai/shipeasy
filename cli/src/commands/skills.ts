import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolveAsset, listDirs } from "../util/assets";
import { copyTree } from "../util/copy";

function skillsRoot(): string {
  return resolveAsset("skills");
}

function targetDir(scope: "user" | "project"): string {
  return scope === "user"
    ? join(homedir(), ".claude", "skills")
    : join(process.cwd(), ".claude", "skills");
}

function readDescription(skillDir: string): string {
  const skillFile = join(skillDir, "SKILL.md");
  if (!existsSync(skillFile)) return "";
  const head = readFileSync(skillFile, "utf8").slice(0, 800);
  const m = /^description:\s*(.+)$/m.exec(head);
  return m ? m[1]!.trim() : "";
}

export function skillsCommand(parent: Command): void {
  const skills = parent
    .command("skills")
    .description("Install or list bundled Shipeasy agent skills");

  skills
    .command("list")
    .description("List bundled skills available to install")
    .action(() => {
      const root = skillsRoot();
      const names = listDirs(root);
      if (names.length === 0) {
        console.log("No bundled skills found.");
        return;
      }
      for (const name of names) {
        const desc = readDescription(join(root, name));
        console.log(`  ${name.padEnd(24)} ${desc}`);
      }
    });

  skills
    .command("install [skill...]")
    .description(
      "Copy bundled skills into .claude/skills. With no args, installs all of them. " +
        "Skills are SKILL.md files the AI assistant can load on demand.",
    )
    .option("--scope <scope>", "user | project", "project")
    .option("--target <dir>", "Override the destination directory (advanced)")
    .option("--force", "Overwrite existing files")
    .action(
      (
        requested: string[],
        opts: { scope?: "user" | "project"; target?: string; force?: boolean },
      ) => {
        const root = skillsRoot();
        const available = listDirs(root);
        if (available.length === 0) {
          console.error(`No skills bundled with the CLI (looked in ${root}).`);
          process.exit(1);
        }
        const toInstall = requested.length > 0 ? requested : available;
        const unknown = toInstall.filter((s) => !available.includes(s));
        if (unknown.length > 0) {
          console.error(
            `Unknown skill(s): ${unknown.join(", ")}. Available: ${available.join(", ")}`,
          );
          process.exit(1);
        }

        const dest = opts.target
          ? resolve(opts.target)
          : targetDir(opts.scope === "user" ? "user" : "project");
        let copied = 0;
        let skipped = 0;
        let overwritten = 0;
        for (const name of toInstall) {
          const r = copyTree(join(root, name), join(dest, name), !!opts.force);
          copied += r.copied.length;
          skipped += r.skipped.length;
          overwritten += r.overwritten.length;
          if (r.copied.length > 0 || r.overwritten.length > 0) {
            console.log(`✓ ${name} → ${join(dest, name)}`);
          } else if (r.skipped.length > 0) {
            console.log(`• ${name}: already installed (use --force to overwrite)`);
          }
        }
        console.log(`\nDone. ${copied} new, ${overwritten} overwritten, ${skipped} skipped.`);
        if (copied + overwritten > 0) {
          console.log("Restart your AI assistant or reload the skill index to pick them up.");
        }
      },
    );
}
