import { Command } from "commander";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { withExamples } from "../util/examples";

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

/**
 * Run the i18n source codemod over one or more target dirs and return the
 * total files scanned. Shared by the `i18n codemod i18n` subcommand and the
 * higher-level `i18n extract` / `i18n migrate` orchestrators so they all drive
 * the exact same JS/TS AST rewrite. Throws on a missing target so callers can
 * surface the per-language gap.
 */
export async function runI18nCodemod(opts: CodemodOptions & { target?: string }): Promise<number> {
  const codemodsDir = resolveCodemodsDir();
  const configMod = (await import(
    pathToFileURL(resolve(codemodsDir, "lib/config-schema.mjs")).href
  )) as { loadConfig: (p: string | null) => unknown };
  const runnerMod = (await import(pathToFileURL(resolve(codemodsDir, "runner.mjs")).href)) as {
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
  const targets = resolveTargets(opts.target, (config as { srcDir?: string }).srcDir ?? "src");
  if (targets.length === 0) {
    throw new Error(
      "no target directory found. Pass an explicit path (e.g. `app`) or create a " +
        "`.i18n-codemod.json` with `srcDir` pointing at your source root.",
    );
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
  return totalScanned;
}

export function codemodCommand(parent: Command): void {
  const cmd = parent
    .command("codemod")
    .description("Source-code codemods (i18n extraction, framework migrations)");

  const codemodI18n = cmd
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
        const totalScanned = await runI18nCodemod({ ...opts, target });
        if (totalScanned === 0) process.exit(1);
      } catch (err) {
        console.error(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`);
        if (opts.verbose && err instanceof Error) console.error(err.stack);
        process.exit(1);
      }
    });

  withExamples(codemodI18n, [
    { note: "Preview extraction over app/", run: "shipeasy i18n codemod i18n app --dry-run" },
    { note: "Run only JSX text extraction", run: "shipeasy i18n codemod i18n ./src --type jsx-text" },
    { note: "Migrate from react-i18next", run: "shipeasy i18n codemod i18n --migrate react-i18next" },
  ]);
}

export function resolveTargets(explicit: string | undefined, configSrcDir: string): string[] {
  const cwd = process.cwd();
  if (explicit) return [resolve(explicit)];
  // If the configured srcDir exists, honor it (single target).
  const configured = resolve(cwd, configSrcDir);
  if (existsSync(configured)) return [configured];
  // Auto-detect common modern layouts.
  const candidates = ["app", "src", "components", "lib", "pages"];
  return candidates.map((c) => resolve(cwd, c)).filter((p) => existsSync(p));
}
