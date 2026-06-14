import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { copyTree } from "../util/copy";
import { withExamples } from "../util/examples";

const MARKETPLACE_REPO = "https://github.com/shipeasy-ai/shipeasy.git";
const PLUGIN_NAME = "shipeasy";

function targetDir(scope: "user" | "project"): string {
  return scope === "user"
    ? join(homedir(), ".claude", "skills")
    : join(process.cwd(), ".claude", "skills");
}

function fetchMarketplace(): string {
  const dir = mkdtempSync(join(tmpdir(), "shipeasy-marketplace-"));
  const res = spawnSync("git", ["clone", "--depth", "1", MARKETPLACE_REPO, dir], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(
      `git clone of ${MARKETPLACE_REPO} failed: ${res.stderr?.toString() ?? "unknown error"}`,
    );
  }
  return dir;
}

function listSkillDirs(srcRoot: string): { skill: string; skillRoot: string }[] {
  const skillsDir = join(srcRoot, PLUGIN_NAME, "skills");
  if (!existsSync(skillsDir)) return [];
  const out: { skill: string; skillRoot: string }[] = [];
  for (const entry of readdirSync(skillsDir)) {
    const full = join(skillsDir, entry);
    if (statSync(full).isDirectory()) {
      out.push({ skill: entry, skillRoot: full });
    }
  }
  return out;
}

export function skillsCommand(parent: Command): void {
  const skills = parent
    .command("skills")
    .description(
      "Install or list Shipeasy agent skills from the marketplace (shipeasy-ai/shipeasy)",
    );

  const listSkills = skills
    .command("list")
    .description("List skills available in the marketplace")
    .action(() => {
      let srcRoot: string;
      try {
        srcRoot = fetchMarketplace();
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
        process.exit(1);
      }
      try {
        const found = listSkillDirs(srcRoot);
        if (found.length === 0) {
          console.log("No skills found.");
          return;
        }
        for (const { skill } of found) {
          console.log(`  ${skill}`);
        }
      } finally {
        rmSync(srcRoot, { recursive: true, force: true });
      }
    });

  withExamples(listSkills, [{ run: "shipeasy skills list" }]);

  const installSkills = skills
    .command("install [skill...]")
    .description(
      "Copy skills from the marketplace into .claude/skills. With no args, installs every " +
        "skill in the shipeasy plugin. Skill names: shipeasy-setup, shipeasy-experiments, " +
        "shipeasy-flags, shipeasy-i18n, shipeasy-bugs.",
    )
    .option("--scope <scope>", "user | project", "project")
    .option("--target <dir>", "Override the destination directory (advanced)")
    .option("--force", "Overwrite existing files")
    .action(
      (
        requested: string[],
        opts: { scope?: "user" | "project"; target?: string; force?: boolean },
      ) => {
        const dest = opts.target
          ? resolve(opts.target)
          : targetDir(opts.scope === "user" ? "user" : "project");

        console.log(`Cloning ${MARKETPLACE_REPO}…`);
        let srcRoot: string;
        try {
          srcRoot = fetchMarketplace();
        } catch (e) {
          console.error(e instanceof Error ? e.message : String(e));
          process.exit(1);
        }

        try {
          const available = listSkillDirs(srcRoot);
          if (available.length === 0) {
            console.error(`No skills found in marketplace (clone at ${srcRoot}).`);
            process.exit(1);
          }
          const toInstall =
            requested.length > 0
              ? available.filter((s) => requested.includes(s.skill))
              : available;
          const unknown = requested.filter((s) => !available.some((a) => a.skill === s));
          if (unknown.length > 0) {
            console.error(
              `Unknown skill(s): ${unknown.join(", ")}. Available: ${available.map((a) => a.skill).join(", ")}`,
            );
            process.exit(1);
          }

          let copied = 0;
          let skipped = 0;
          let overwritten = 0;
          for (const { skill, skillRoot } of toInstall) {
            const r = copyTree(skillRoot, join(dest, skill), !!opts.force);
            copied += r.copied.length;
            skipped += r.skipped.length;
            overwritten += r.overwritten.length;
            if (r.copied.length > 0 || r.overwritten.length > 0) {
              console.log(`✓ ${skill} → ${join(dest, skill)}`);
            } else if (r.skipped.length > 0) {
              console.log(`• ${skill}: already installed (use --force to overwrite)`);
            }
          }
          console.log(`\nDone. ${copied} new, ${overwritten} overwritten, ${skipped} skipped.`);
          if (copied + overwritten > 0) {
            console.log(
              "Restart your AI assistant or reload the skill index to pick them up.",
            );
          }
        } finally {
          rmSync(srcRoot, { recursive: true, force: true });
        }
      },
    );

  withExamples(installSkills, [
    { run: "shipeasy skills install", note: "install every shipeasy skill" },
    { run: "shipeasy skills install shipeasy-flags shipeasy-experiments" },
    { run: "shipeasy skills install shipeasy-setup --scope user --force" },
  ]);
}
