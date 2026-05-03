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
        const result = await runnerMod.run(config, {
          dryRun: opts.dryRun,
          verbose: opts.verbose,
          type: opts.type ?? null,
          migrate: opts.migrate ?? null,
          target: target ? resolve(target) : undefined,
        });

        if (result.filesScanned === 0) process.exit(1);
      } catch (err) {
        console.error(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`);
        if (opts.verbose && err instanceof Error) console.error(err.stack);
        process.exit(1);
      }
    });
}
