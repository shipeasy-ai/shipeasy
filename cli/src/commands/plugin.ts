import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { copyTree } from "../util/copy";

const MARKETPLACE_REPO = "https://github.com/shipeasy-ai/shipeasy.git";
const KNOWN_PLUGINS = ["base", "experiments-metrics", "configs-gates", "polylang", "bugs"] as const;
type PluginName = (typeof KNOWN_PLUGINS)[number];

function rootFor(scope: "user" | "project"): string {
  return scope === "user" ? join(homedir(), ".claude") : join(process.cwd(), ".claude");
}

function fetchMarketplace(): string {
  const dir = mkdtempSync(join(tmpdir(), "shipeasy-marketplace-"));
  const res = spawnSync("git", ["clone", "--depth", "1", MARKETPLACE_REPO, dir], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(
      `git clone of ${MARKETPLACE_REPO} failed: ${res.stderr?.toString() ?? "unknown error"}.\n` +
        `Plugin install needs git on PATH. Install git or use:\n` +
        `  claude plugin marketplace add shipeasy-ai/shipeasy && claude plugin install shipeasy@base`,
    );
  }
  return dir;
}

function copyPlugin(srcRoot: string, pluginName: string, claudeRoot: string, force: boolean) {
  const pluginRoot = join(srcRoot, pluginName);
  if (!existsSync(pluginRoot) || !statSync(pluginRoot).isDirectory()) {
    throw new Error(`Plugin '${pluginName}' not found in marketplace`);
  }
  let copied = 0;
  let overwritten = 0;
  let skipped = 0;
  for (const sub of ["commands", "skills"] as const) {
    const subSrc = join(pluginRoot, sub);
    if (!existsSync(subSrc)) continue;
    const dest = join(claudeRoot, sub);
    const r = copyTree(subSrc, dest, force);
    copied += r.copied.length;
    overwritten += r.overwritten.length;
    skipped += r.skipped.length;
    console.log(
      `  ${pluginName}/${sub.padEnd(8)} ${r.copied.length} new, ${r.overwritten.length} overwritten, ${r.skipped.length} skipped → ${dest}`,
    );
  }
  return { copied, overwritten, skipped };
}

export function pluginCommand(parent: Command): void {
  const plugin = parent
    .command("plugin")
    .description(
      "Install Shipeasy Claude/Cursor/Windsurf plugins (clones shipeasy-ai/shipeasy and copies the requested plugin's skills + slash commands into .claude/)",
    );

  plugin
    .command("install [plugins...]")
    .description(
      "Fetch one or more plugins from the marketplace (shipeasy-ai/shipeasy) and copy " +
        "their skills + commands into .claude/. With no args, installs `base` only. " +
        `Known plugins: ${KNOWN_PLUGINS.join(", ")}.`,
    )
    .option("--scope <scope>", "user | project", "project")
    .option("--target <dir>", "Override the destination .claude root (advanced)")
    .option("--all", "Install every known plugin")
    .option("--force", "Overwrite existing files")
    .action(
      (
        requested: string[],
        opts: {
          scope?: "user" | "project";
          target?: string;
          all?: boolean;
          force?: boolean;
        },
      ) => {
        const claudeRoot = opts.target
          ? resolve(opts.target)
          : rootFor(opts.scope === "user" ? "user" : "project");

        let toInstall: string[];
        if (opts.all) {
          toInstall = [...KNOWN_PLUGINS];
        } else if (requested.length === 0) {
          toInstall = ["base"];
          console.log("No plugins specified. Installing `base` (use --all for everything).");
        } else {
          toInstall = requested;
        }

        const unknown = toInstall.filter((p) => !(KNOWN_PLUGINS as readonly string[]).includes(p));
        if (unknown.length > 0) {
          console.error(`Unknown plugin(s): ${unknown.join(", ")}. Known: ${KNOWN_PLUGINS.join(", ")}`);
          process.exit(1);
        }

        console.log(`Cloning ${MARKETPLACE_REPO}…`);
        let srcRoot: string;
        try {
          srcRoot = fetchMarketplace();
        } catch (e) {
          console.error(e instanceof Error ? e.message : String(e));
          process.exit(1);
        }

        let totalCopied = 0;
        let totalOverwritten = 0;
        let totalSkipped = 0;
        try {
          for (const name of toInstall) {
            const r = copyPlugin(srcRoot, name, claudeRoot, !!opts.force);
            totalCopied += r.copied;
            totalOverwritten += r.overwritten;
            totalSkipped += r.skipped;
          }
        } finally {
          rmSync(srcRoot, { recursive: true, force: true });
        }

        console.log(
          `\nDone. ${totalCopied} new, ${totalOverwritten} overwritten, ${totalSkipped} skipped.`,
        );
        if (totalSkipped > 0 && !opts.force) {
          console.log("Some files already existed. Re-run with --force to overwrite.");
        }
        console.log(
          "\nRestart your AI assistant or reload the skill/command index to pick up the new files.",
        );
        console.log(
          "\nFor Claude Code, the marketplace path is preferred:\n" +
            "  claude plugin marketplace add shipeasy-ai/shipeasy\n" +
            `  claude plugin install shipeasy@${toInstall[0]}`,
        );
      },
    );

  plugin
    .command("list")
    .description("List the known plugins available in the marketplace")
    .action(() => {
      for (const name of KNOWN_PLUGINS) {
        console.log(`  ${name}`);
      }
      console.log(
        `\nFull catalogue + descriptions: https://github.com/shipeasy-ai/shipeasy/blob/main/.claude-plugin/marketplace.json`,
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
    });
}
