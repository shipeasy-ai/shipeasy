import { Command } from "commander";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolveAsset } from "../util/assets";
import { copyTree } from "../util/copy";

function pluginAssetRoot(): string {
  return resolveAsset("plugin");
}

function targetDir(scope: "user" | "project"): string {
  return scope === "user"
    ? join(homedir(), ".claude", "plugins", "shipeasy")
    : join(process.cwd(), ".claude", "plugins", "shipeasy");
}

export function pluginCommand(parent: Command): void {
  const plugin = parent.command("plugin").description("Install the Shipeasy Claude Code plugin");

  plugin
    .command("install")
    .description(
      "Install the Shipeasy plugin (slash commands + skills + codemods) into .claude/plugins/shipeasy",
    )
    .option("--scope <scope>", "user | project", "project")
    .option("--target <dir>", "Override the destination directory")
    .option("--force", "Overwrite existing files")
    .action((opts: { scope?: "user" | "project"; target?: string; force?: boolean }) => {
      const src = pluginAssetRoot();
      const dest = opts.target
        ? resolve(opts.target)
        : targetDir(opts.scope === "user" ? "user" : "project");
      const r = copyTree(src, dest, !!opts.force);
      console.log(
        `✓ ${r.copied.length} new, ${r.overwritten.length} overwritten, ${r.skipped.length} skipped → ${dest}`,
      );
      if (r.skipped.length > 0 && !opts.force) {
        console.log("Some files already existed. Re-run with --force to overwrite.");
      }
      console.log(
        "\nNext: restart Claude Code. Plugin contributes /shipeasy-* slash commands and skills.",
      );
    });

  plugin
    .command("uninstall")
    .description("Remove the installed Shipeasy plugin directory")
    .option("--scope <scope>", "user | project", "project")
    .action((opts: { scope?: "user" | "project" }) => {
      const dest = targetDir(opts.scope === "user" ? "user" : "project");
      // Don't recursively delete — print what to remove. Refuse to nuke files
      // we did not author.
      console.log(`Remove this directory by hand:\n  rm -rf ${dest}`);
    });
}
