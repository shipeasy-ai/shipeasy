import { Command } from "commander";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolveAsset } from "../util/assets";
import { copyTree, type CopyResult } from "../util/copy";

function pluginAssetRoot(): string {
  return resolveAsset("plugin");
}

function rootFor(scope: "user" | "project"): string {
  return scope === "user" ? join(homedir(), ".claude") : join(process.cwd(), ".claude");
}

export function pluginCommand(parent: Command): void {
  const plugin = parent.command("plugin").description("Install the Shipeasy Claude Code plugin");

  plugin
    .command("install")
    .description(
      "Install slash commands + skills into .claude/commands and .claude/skills " +
        "(picked up natively — no marketplace registration needed). Also drops a " +
        "plugin manifest at .claude/plugins/shipeasy for users who prefer that layout.",
    )
    .option("--scope <scope>", "user | project", "project")
    .option("--target <dir>", "Override the destination .claude root (advanced)")
    .option("--force", "Overwrite existing files")
    .action((opts: { scope?: "user" | "project"; target?: string; force?: boolean }) => {
      const src = pluginAssetRoot();
      const claudeRoot = opts.target
        ? resolve(opts.target)
        : rootFor(opts.scope === "user" ? "user" : "project");

      const summary: { label: string; dest: string; r: CopyResult }[] = [];

      // 1. Slash commands → .claude/commands/ (canonical pickup path).
      const commandsSrc = join(src, "commands");
      if (existsSync(commandsSrc)) {
        const dest = join(claudeRoot, "commands");
        summary.push({ label: "commands", dest, r: copyTree(commandsSrc, dest, !!opts.force) });
      }

      // 2. Skills → .claude/skills/ (canonical pickup path).
      const skillsSrc = join(src, "skills");
      if (existsSync(skillsSrc)) {
        const dest = join(claudeRoot, "skills");
        summary.push({ label: "skills", dest, r: copyTree(skillsSrc, dest, !!opts.force) });
      }

      // 3. Plugin manifest → .claude/plugins/shipeasy/ (for marketplace-style use).
      const dest = join(claudeRoot, "plugins", "shipeasy");
      summary.push({ label: "plugin manifest", dest, r: copyTree(src, dest, !!opts.force) });

      let totalCopied = 0;
      let totalOverwritten = 0;
      let totalSkipped = 0;
      for (const s of summary) {
        const { copied, overwritten, skipped } = s.r;
        totalCopied += copied.length;
        totalOverwritten += overwritten.length;
        totalSkipped += skipped.length;
        console.log(
          `  ${s.label.padEnd(16)} ${copied.length} new, ${overwritten.length} overwritten, ${skipped.length} skipped → ${s.dest}`,
        );
      }
      console.log(
        `\nDone. ${totalCopied} new, ${totalOverwritten} overwritten, ${totalSkipped} skipped.`,
      );
      if (totalSkipped > 0 && !opts.force) {
        console.log("Some files already existed. Re-run with --force to overwrite.");
      }
      console.log(
        "\nNext: restart Claude Code. Slash commands /shipeasy-* and skills load automatically from .claude/commands and .claude/skills.",
      );
    });

  plugin
    .command("uninstall")
    .description("Print the directories to remove (refuses to delete files automatically)")
    .option("--scope <scope>", "user | project", "project")
    .action((opts: { scope?: "user" | "project" }) => {
      const claudeRoot = rootFor(opts.scope === "user" ? "user" : "project");
      console.log("Remove these by hand (the CLI refuses to recursive-delete user files):");
      console.log(`  rm    ${join(claudeRoot, "commands", "shipeasy-*.md")}`);
      console.log(`  rm -r ${join(claudeRoot, "skills", "shipeasy-*")}`);
      console.log(`  rm -r ${join(claudeRoot, "plugins", "shipeasy")}`);
    });
}
