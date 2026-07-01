import path from "node:path";
import { Command } from "commander";
import { detectTargets, type TargetRecommendation } from "./scan";
import { printJson } from "../util/output";
import { mergeDetected } from "../util/project-config";
import { withExamples, withDetails, withOutput } from "../util/examples";

/**
 * Record what we detected into each real target's own `.shipeasy` (non-
 * destructively — `project_id` is never touched). This seeds the `sdk` the
 * `docs` commands default to, even before the project is bound. Skips the
 * workspace-root / unsupported folders that carry no SDK. Returns the paths
 * written so the caller can surface them.
 */
function recordDetection(targets: TargetRecommendation[]): string[] {
  const written: string[] = [];
  for (const t of targets) {
    const { sdk, action } = t.recommendation;
    // Only real projects get a file: not unsupported langs, not JS workspace
    // roots (those aren't a project — the subprojects beneath them are).
    if (!sdk || action === "skip_workspace_root" || action === "skip_unsupported") continue;
    const { path: p } = mergeDetected(t.path, {
      language: t.language,
      sdk,
      frameworks: t.frameworks,
    });
    written.push(p);
  }
  return written;
}

const ACTION_GLYPH: Record<string, string> = {
  install: "▸",
  set_key: "▸",
  already_onboarded: "✓",
  skip_workspace_root: "·",
  skip_unsupported: "·",
};

function rel(root: string, p: string): string {
  const r = path.relative(root, p);
  return r === "" ? "." : r;
}

function printHuman(root: string, targets: TargetRecommendation[]): void {
  if (targets.length === 0) {
    console.log("No install targets found under this directory.");
    return;
  }
  console.log(`Detected ${targets.length} target(s) under ${root}:\n`);
  for (const t of targets) {
    const r = t.recommendation;
    const glyph = ACTION_GLYPH[r.action] ?? "▸";
    const fw = t.frameworks.length ? ` · ${t.frameworks.join(", ")}` : "";
    console.log(`${glyph} ${rel(root, t.path)}/  [${t.language}${fw}]  → ${r.action}`);
    console.log(`    ${r.reason}`);
    if (r.install) console.log(`    install:   ${r.install}`);
    if (r.keys.length) console.log(`    keys:      ${r.keys.join(" + ")} (mint with: shipeasy keys create --type <t> --env prod)`);
    if (r.secret_store) console.log(`    secret:    ${r.secret_store}`);
    if (r.docs) console.log(`    docs:      ${r.docs}`);
    if (r.next_skills.length) console.log(`    then:      ${r.next_skills.join("  ")}`);
    console.log("");
  }
  const todo = targets.filter((t) => t.recommendation.action === "install" || t.recommendation.action === "set_key");
  console.log(
    todo.length
      ? `${todo.length} target(s) need work. Pull each folder's version-correct install + wiring with the \`docs\` line above.`
      : "All detected targets are already onboarded.",
  );
}

export function detectCommand(parent: Command): void {
  const cmd = parent
    .command("detect [paths...]")
    .description(
      "Scan the repo for install targets and print a per-folder onboarding recommendation " +
        "(language, install command, keys, secret store, docs handle, next skills).",
    )
    .option("--json", "Output the structured recommendation set as JSON")
    .action(async (paths: string[], opts: { json?: boolean }) => {
      const result = await detectTargets(paths).catch((err: unknown) => {
        console.error(`detect failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      });
      if (!result) return;
      const wrote = recordDetection(result.targets);
      if (opts.json) {
        printJson({ ...result, recorded: wrote });
        return;
      }
      printHuman(result.root, result.targets);
      if (wrote.length) {
        console.log(
          `\nRecorded language/sdk into ${wrote.length} .shipeasy file(s):\n` +
            wrote.map((p) => `  ${rel(result.root, p)}`).join("\n"),
        );
      }
    });

  withDetails(
    cmd,
    "`detect` is the engine behind the setup skill's 'detect subprojects' step. With " +
      "no args it walks the tree under the cwd (depth 4, pruning node_modules/vendor/" +
      "build/etc.) and finds every project manifest (package.json, pyproject.toml, " +
      "Gemfile, go.mod, pom.xml, build.gradle[.kts], composer.json, Package.swift). " +
      "Pass explicit paths to scan only those folders.\n\n" +
      "For each folder it reports the detected language + frameworks and a " +
      "**recommendation**: the SDK install command, which keys to mint (server, plus " +
      "client for browser frameworks), the idiomatic secret store, the `shipeasy docs " +
      "get` line that pulls the version-correct install + `configure()` wiring for that " +
      "language, and the feature-install skills to run next. Already-onboarded folders " +
      "and JS workspace roots are flagged so they're skipped. Use `--json` to drive it " +
      "programmatically.\n\n" +
      "It also **writes what it detected** — the `language`, `sdk`, and `frameworks` — into " +
      "each real target's own `.shipeasy` (non-destructively; `project_id` is never touched), " +
      "recording one file per project and seeding the `sdk` that `shipeasy docs` defaults to. " +
      "`--json` echoes the written paths under `recorded`.",
  );

  withExamples(cmd, [
    { run: "shipeasy detect", note: "recommendations for every target under the cwd" },
    { run: "shipeasy detect --json", note: "machine-readable, for the setup skill" },
    { run: "shipeasy detect apps/web apps/api", note: "scan only these folders" },
  ]);

  withOutput(cmd, {
    note: "with --json",
    json: {
      status: "ok",
      root: "/repo",
      targets: [
        {
          path: "/repo/apps/web",
          language: "typescript",
          frameworks: ["nextjs", "react"],
          package_manager: "pnpm",
          entry_points: ["src/app/layout.tsx"],
          recommendation: {
            sdk: "typescript",
            action: "install",
            reason: "No Shipeasy SDK installed — install it, mint keys, wire the entry point.",
            install: "pnpm add @shipeasy/sdk @shipeasy/react",
            keys: ["server", "client"],
            secret_store: "<dir>/.env.local (gitignored)",
            docs: "shipeasy docs get --sdk typescript installation",
            next_skills: [
              "/shipeasy:flags:install",
              "/shipeasy:ops:install",
              "/shipeasy:i18n:install",
            ],
          },
        },
      ],
      recorded: ["/repo/apps/web/.shipeasy"],
    },
  });
}
