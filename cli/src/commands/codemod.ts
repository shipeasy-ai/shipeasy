import { Command } from "commander";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Resolve codemods/ relative to the bundled CLI (`dist/index.js` ships beside
// `codemods/` at the package root). In dev (`pnpm dev` via tsx) __dirname
// is `src/commands/`, so we also try the sibling-of-package layout.
function resolveCodemodsDir(): string {
  const candidates = [
    resolve(__dirname, "../codemods"),
    resolve(__dirname, "../../codemods"),
    resolve(__dirname, "../../../codemods"),
  ];
  for (const c of candidates) if (existsSync(resolve(c, "runner.mjs"))) return c;
  throw new Error(
    `codemods/ not found relative to ${__dirname}. Looked in: ${candidates.join(", ")}`,
  );
}

interface CodemodOptions {
  config?: string;
  dryRun?: boolean;
  verbose?: boolean;
  type?: string;
  migrate?: string;
}

export function codemodCommand(parent: Command): void {
  const cmd = parent
    .command("codemod")
    .description("Source-code codemods (i18n extraction, framework migrations)");

  cmd
    .command("i18n [target]")
    .description(
      "Extract translatable strings and wrap them with i18n.t() from @shipeasy/sdk/client. " +
        "Reads .i18n-codemod.json from the current directory if present.",
    )
    .option("--config <path>", "Path to a JSON config file")
    .option("--dry-run", "Preview without writing files")
    .option("--verbose, -v", "Detailed per-file output")
    .option(
      "--type <name>",
      "Run only one extraction type (jsx-text, jsx-attr, template-literal, ...)",
    )
    .option(
      "--migrate <name>",
      "Run a migration plugin (react-i18next, react-intl, lingui, next-intl, raw-i18next)",
    )
    .action(async (target: string | undefined, opts: CodemodOptions) => {
      try {
        const codemodsDir = resolveCodemodsDir();
        const configMod = (await import(
          pathToFileURL(resolve(codemodsDir, "lib/config-schema.mjs")).href
        )) as { loadConfig: (p: string | null) => unknown };
        const runnerMod = (await import(
          pathToFileURL(resolve(codemodsDir, "runner.mjs")).href
        )) as {
          run: (
            config: unknown,
            options: {
              dryRun?: boolean;
              verbose?: boolean;
              target?: string;
              type?: string | null;
              migrate?: string | null;
            },
          ) => Promise<{ filesScanned: number }>;
        };

        const config = configMod.loadConfig(opts.config ?? null);
        // Resolve targets. Order of precedence:
        //   1. explicit `target` arg → that single dir
        //   2. config's srcDir (default "src") if it exists → that single dir
        //   3. fallback auto-detect: scan each of app/, components/, lib/,
        //      pages/, src/ that exists. This makes the codemod work on
        //      modern Next.js App Router projects without `src/` and on
        //      typical mixed layouts without requiring a config file.
        const targets = resolveTargets(target, (config as { srcDir?: string }).srcDir ?? "src");
        if (targets.length === 0) {
          console.error(
            "\n  Error: no target directory found. Pass an explicit path " +
              "(e.g. `shipeasy codemod i18n app`) or create a `.i18n-codemod.json` " +
              "with `srcDir` pointing at your source root.\n",
          );
          process.exit(1);
        }

        let totalScanned = 0;
        for (const t of targets) {
          if (targets.length > 1) console.log(`\n  → scanning ${t}`);
          const result = await runnerMod.run(config, {
            dryRun: opts.dryRun,
            verbose: opts.verbose,
            type: opts.type ?? null,
            migrate: opts.migrate ?? null,
            target: t,
          });
          totalScanned += result.filesScanned;
        }
        if (totalScanned === 0) process.exit(1);
      } catch (err) {
        console.error(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`);
        if (opts.verbose && err instanceof Error) console.error(err.stack);
        process.exit(1);
      }
    });
}

function resolveTargets(explicit: string | undefined, configSrcDir: string): string[] {
  const cwd = process.cwd();
  if (explicit) return [resolve(explicit)];
  // If the configured srcDir exists, honor it (single target).
  const configured = resolve(cwd, configSrcDir);
  if (existsSync(configured)) return [configured];
  // Auto-detect common modern layouts.
  const candidates = ["app", "src", "components", "lib", "pages"];
  return candidates.map((c) => resolve(cwd, c)).filter((p) => existsSync(p));
}
