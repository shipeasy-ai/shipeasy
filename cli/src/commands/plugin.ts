import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, statSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { copyTree } from "../util/copy";

const MARKETPLACE_REPO = "https://github.com/shipeasy-ai/shipeasy.git";
const PLUGIN_NAME = "shipeasy";
const FEATURES = ["setup", "bugs", "flags", "experiments", "i18n"] as const;
type Feature = (typeof FEATURES)[number];

const POINTERS: Record<Feature, string> = {
  setup: `---
name: shipeasy-setup
description: Project pointer — Shipeasy is integrated here. Triggers on "set up shipeasy", "onboard shipeasy", "new contributor shipeasy".
---

# Shipeasy is integrated in this repo

This project uses Shipeasy. The full skill lives in the \`shipeasy\`
Claude Code plugin. This file is the breadcrumb so new contributors
can find their way without already having the plugin loaded.

## With plugin installed

\`/shipeasy:install\` or invoke the \`shipeasy-setup\` skill.

## Without the plugin

\`\`\`bash
claude plugin marketplace add shipeasy-ai/shipeasy
claude plugin install shipeasy@shipeasy
/shipeasy:install
\`\`\`

Cursor / Windsurf / non-Claude harness:

\`\`\`bash
npx @shipeasy/cli plugin install
\`\`\`

## Feature add-ons (run after base)

- \`/shipeasy:ops:install\` — in-app bug reports + feature requests + error collection
- \`/shipeasy:flags:install\` — feature gates, configs, kill switches
- \`/shipeasy:experiments:install\` — A/B experiments
- \`/shipeasy:i18n:install\` — translations
`,

  bugs: `---
name: shipeasy-bugs
description: Project pointer — Shipeasy feedback module is enabled here. Triggers on "bug report", "feature request", "feedback", "user-reported issue", "report a bug", "production error".
---

# Shipeasy bug reports, feature requests + errors (project pointer)

This project has the Shipeasy \`feedback\` module enabled and
auto-collects production errors through the events system. The full
skill lives in the \`shipeasy\` Claude Code plugin.

## With plugin installed

- Skill: \`shipeasy-bugs\`
- Commands: \`/shipeasy:bugs:bug\`, \`/shipeasy:bugs:fix\`, \`/shipeasy:ops:install\`

## Without the plugin

\`\`\`bash
claude plugin marketplace add shipeasy-ai/shipeasy
claude plugin install shipeasy@shipeasy
/shipeasy:install
/shipeasy:ops:install
\`\`\`

Cursor / Windsurf / non-Claude harness:

\`\`\`bash
npx @shipeasy/cli plugin install
\`\`\`

## Doing the workflow by hand

\`\`\`bash
shipeasy modules enable feedback

shipeasy feedback bugs create "Title" --description "what / where / repro"
shipeasy feedback bugs list --status open --json
shipeasy feedback bugs update <id> --status in_progress
shipeasy feedback bugs update <id> --status ready_for_qa
shipeasy feedback features create "Title" --description "…"
shipeasy feedback features list

shipeasy ops.errors list              # auto-tracked production errors (read-only)
shipeasy ops.errors get <id>
\`\`\`

Status lifecycle: \`open → triaged → in_progress → ready_for_qa →
resolved\` (or \`wont_fix\`). Developers flip to \`ready_for_qa\` after
the fix; QA flips to \`resolved\` after dashboard verification.

The in-page overlay opens on any URL with \`?se=1\` appended (requires
\`getBootstrapHtml()\` rendered into \`<head>\` by base setup). Error
collection is on by default via the client SDK's \`autoCollect\` errors
group — disable with \`shipeasy({ clientKey, autoCollect: { errors: false } })\`.
`,

  flags: `---
name: shipeasy-flags
description: Project pointer — Shipeasy gates + configs are enabled here. Triggers on "feature flag", "feature gate", "rollout", "kill switch", "dynamic config", "remote config".
---

# Shipeasy feature gates + configs (project pointer)

This project has the Shipeasy \`gates\` and \`configs\` modules enabled.
The full skill lives in the \`shipeasy\` Claude Code plugin.

## With plugin installed

- Skill: \`shipeasy-flags\`
- Commands: \`/shipeasy:flags:flag\`, \`/shipeasy:flags:install\`

## Without the plugin

\`\`\`bash
claude plugin marketplace add shipeasy-ai/shipeasy
claude plugin install shipeasy@shipeasy
/shipeasy:install
/shipeasy:flags:install
\`\`\`

Cursor / Windsurf / non-Claude harness:

\`\`\`bash
npx @shipeasy/cli plugin install
\`\`\`

## Doing the workflow by hand

\`\`\`bash
shipeasy modules enable gates
shipeasy modules enable configs

shipeasy flags create --name checkout_v2 --percent 0
shipeasy flags list
shipeasy flags update checkout_v2 --percent 25
\`\`\`

Read from SDK:

\`\`\`ts
import { gates, configs } from "@shipeasy/sdk/server"; // or /client
if (await gates.check("checkout_v2", { user_id })) { /* new path */ }
const ranking = await configs.get("search_ranking", { country });
\`\`\`

**Rollout pattern.** Start at \`rollout_percent: 0\`, default \`false\`.
Ramp 5 → 25 → 50 → 100 manually. Once at 100% for a full deploy cycle,
remove the gate from code, then \`shipeasy flags archive <name>\`.

**Kill switch.** Create a separate \`kill_<feature>\` gate defaulting
**on** that guards the old path. Flip off if the new path breaks.
`,

  experiments: `---
name: shipeasy-experiments
description: Project pointer — Shipeasy experiments module is enabled here. Triggers on "A/B test", "experiment", "split test", "holdout", "metric significance".
---

# Shipeasy A/B experiments (project pointer)

This project has the Shipeasy \`experiments\` module enabled. The full
skill lives in the \`shipeasy\` Claude Code plugin.

## With plugin installed

- Skill: \`shipeasy-experiments\`
- Commands: \`/shipeasy:experiments:experiment\`, \`/shipeasy:experiments:install\`

## Without the plugin

\`\`\`bash
claude plugin marketplace add shipeasy-ai/shipeasy
claude plugin install shipeasy@shipeasy
/shipeasy:install
/shipeasy:experiments:install
\`\`\`

Cursor / Windsurf / non-Claude harness:

\`\`\`bash
npx @shipeasy/cli plugin install
\`\`\`

## Doing the workflow by hand

\`\`\`bash
shipeasy modules enable experiments

shipeasy experiments create --help
shipeasy experiments start  <name>
shipeasy experiments status <name>
shipeasy experiments stop   <name>
\`\`\`

Read from SDK:

\`\`\`ts
import { experiments } from "@shipeasy/sdk/server";
const { group, params } = await experiments.assign("checkout_button_v2", {
  user_id, country,
});
\`\`\`

**Design rules.** Universe owns holdouts + mutual exclusion. Always
include a \`control\`. Pre-register one success metric. After \`stop\`,
don't relaunch under the same name.
`,

  i18n: `---
name: shipeasy-i18n
description: Project pointer — Shipeasy translations are enabled here. Triggers on "translate", "i18n", "add a key", "make this translatable", or any request involving user-facing copy.
---

# Shipeasy i18n / translations (project pointer)

This project has the Shipeasy \`translations\` module enabled. The full
skill lives in the \`shipeasy\` Claude Code plugin.

## With plugin installed

- Skill: \`shipeasy-i18n\`
- Commands: \`/shipeasy:i18n:install\`, \`/shipeasy:i18n:extract\`, \`/shipeasy:i18n:migrate\`

## Without the plugin

\`\`\`bash
claude plugin marketplace add shipeasy-ai/shipeasy
claude plugin install shipeasy@shipeasy
/shipeasy:install
/shipeasy:i18n:install
\`\`\`

Cursor / Windsurf / non-Claude harness:

\`\`\`bash
npx @shipeasy/cli plugin install
\`\`\`

## Doing the workflow by hand

Wrap a string:

\`\`\`tsx
import { i18n } from "@shipeasy/sdk/client";
<button>{i18n.t("landing.nav.cta", "Install with Claude")}</button>
\`\`\`

Bulk extract + push (idempotent):

\`\`\`bash
shipeasy codemod i18n
shipeasy i18n push <generated-json> --profile en:prod --chunk default
shipeasy i18n publish               --profile en:prod --chunk default
\`\`\`

Key naming: \`<chunk>.<component>.<element>\` (e.g. \`landing.hero.title\`).
Variables: \`i18n.t("k", "Hi {{name}}", { name: "Ada" })\`.

Migrate from another lib: \`shipeasy codemod i18n --migrate react-i18next\`
(also: \`react-intl\`, \`lingui\`, \`next-intl\`, \`raw-i18next\`).
`,
};

function pointerSkillPath(claudeRoot: string, feature: Feature): string {
  return join(claudeRoot, "skills", `shipeasy-${feature}`, "SKILL.md");
}

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
        `  claude plugin marketplace add shipeasy-ai/shipeasy && claude plugin install shipeasy@shipeasy`,
    );
  }
  return dir;
}

function dropPointers(claudeRoot: string, features: Feature[], force: boolean) {
  let written = 0;
  let skipped = 0;
  for (const f of features) {
    const target = pointerSkillPath(claudeRoot, f);
    if (existsSync(target) && !force) {
      console.log(`  • shipeasy-${f}: pointer already exists (use --force to overwrite) → ${target}`);
      skipped += 1;
      continue;
    }
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, POINTERS[f]);
    console.log(`  ✓ shipeasy-${f}: pointer written → ${target}`);
    written += 1;
  }
  return { written, skipped };
}

function copyFullPlugin(srcRoot: string, claudeRoot: string, force: boolean) {
  const pluginRoot = join(srcRoot, PLUGIN_NAME);
  if (!existsSync(pluginRoot) || !statSync(pluginRoot).isDirectory()) {
    throw new Error(`Plugin '${PLUGIN_NAME}' not found in marketplace clone at ${srcRoot}`);
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
      `  ${sub.padEnd(8)} ${r.copied.length} new, ${r.overwritten.length} overwritten, ${r.skipped.length} skipped → ${dest}`,
    );
  }
  return { copied, overwritten, skipped };
}

export function pluginCommand(parent: Command): void {
  const plugin = parent
    .command("plugin")
    .description(
      "Install Shipeasy plugin files into .claude/ for non-Claude-Code harnesses " +
        "(Cursor, Windsurf) or to drop project-level pointer skills that new contributors " +
        "follow. For Claude Code itself prefer `claude plugin marketplace add shipeasy-ai/shipeasy`.",
    );

  plugin
    .command("install [features...]")
    .description(
      "With no args: copy the full `shipeasy` plugin (every command + every skill) into " +
        ".claude/ — useful for non-Claude-Code harnesses. With feature names " +
        `(${FEATURES.join(", ")}): drop just the per-feature pointer skill(s) into ` +
        ".claude/skills/shipeasy-<feature>/SKILL.md so new contributors find the workflow.",
    )
    .option("--scope <scope>", "user | project", "project")
    .option("--target <dir>", "Override the destination .claude root (advanced)")
    .option("--full", "Force full install (commands + skills) even when features are given")
    .option("--pointer-only", "Drop pointer skills only, even with no feature args (== all features)")
    .option("--force", "Overwrite existing files")
    .action(
      (
        requested: string[],
        opts: {
          scope?: "user" | "project";
          target?: string;
          full?: boolean;
          pointerOnly?: boolean;
          force?: boolean;
        },
      ) => {
        const claudeRoot = opts.target
          ? resolve(opts.target)
          : rootFor(opts.scope === "user" ? "user" : "project");

        const unknown = requested.filter((f) => !(FEATURES as readonly string[]).includes(f));
        if (unknown.length > 0) {
          console.error(`Unknown feature(s): ${unknown.join(", ")}. Known: ${FEATURES.join(", ")}`);
          process.exit(1);
        }

        const pointerMode = opts.pointerOnly || (requested.length > 0 && !opts.full);

        if (pointerMode) {
          const features = (requested.length > 0 ? requested : [...FEATURES]) as Feature[];
          const { written, skipped } = dropPointers(claudeRoot, features, !!opts.force);
          console.log(`\nDone. ${written} pointer(s) written, ${skipped} skipped.`);
          if (skipped > 0 && !opts.force) {
            console.log("Some pointers already existed. Re-run with --force to overwrite.");
          }
          console.log(
            "\nPointers are breadcrumbs — they tell future contributors how to install the\n" +
              "full plugin. To activate the workflows, run the matching install slash command\n" +
              "(`/shipeasy:install`, `/shipeasy:ops:install`, etc.) once the plugin is loaded.",
          );
          return;
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
          const r = copyFullPlugin(srcRoot, claudeRoot, !!opts.force);
          totalCopied += r.copied;
          totalOverwritten += r.overwritten;
          totalSkipped += r.skipped;
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
            "  claude plugin install shipeasy@shipeasy",
        );
      },
    );

  plugin
    .command("list")
    .description("List the features available in the shipeasy plugin")
    .action(() => {
      for (const f of FEATURES) {
        console.log(`  ${f}`);
      }
      console.log(
        `\nFull manifest: https://github.com/shipeasy-ai/shipeasy/blob/main/.claude-plugin/marketplace.json`,
      );
    });

  plugin
    .command("uninstall")
    .description("Print the directories to remove (refuses to delete user files)")
    .option("--scope <scope>", "user | project", "project")
    .action((opts: { scope?: "user" | "project" }) => {
      const claudeRoot = rootFor(opts.scope === "user" ? "user" : "project");
      console.log("Remove by hand (the CLI refuses to recursive-delete user files):");
      console.log(`  rm    ${join(claudeRoot, "commands", "install.md")}`);
      console.log(`  rm -r ${join(claudeRoot, "commands", "bugs")}`);
      console.log(`  rm -r ${join(claudeRoot, "commands", "flags")}`);
      console.log(`  rm -r ${join(claudeRoot, "commands", "experiments")}`);
      console.log(`  rm -r ${join(claudeRoot, "commands", "i18n")}`);
      console.log(`  rm -r ${join(claudeRoot, "skills", "shipeasy-*")}`);
    });
}
