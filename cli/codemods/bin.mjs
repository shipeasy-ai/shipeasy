#!/usr/bin/env node
/**
 * bin.mjs — CLI entry point for the i18n codemod.
 *
 * Usage:
 *   npx @shipeasy/sdk-codemod-i18n                       # transform src/**
 *   npx @shipeasy/sdk-codemod-i18n --dry-run              # preview without writing
 *   npx @shipeasy/sdk-codemod-i18n --verbose              # detailed per-file output
 *   npx @shipeasy/sdk-codemod-i18n --type jsx-text        # run only one type
 *   npx @shipeasy/sdk-codemod-i18n --config ./custom.json # custom config file
 *   npx @shipeasy/sdk-codemod-i18n --migrate legacy       # run a migration plugin
 *   npx @shipeasy/sdk-codemod-i18n src/pages/auth/        # transform specific dir
 *   npx @shipeasy/sdk-codemod-i18n --help                 # show usage
 */

import { loadConfig } from "./lib/config-schema.mjs";
import { run } from "./runner.mjs";

// ── Argument parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function parseArgs(argv) {
  const parsed = {
    config: null,
    dryRun: false,
    verbose: false,
    type: null,
    migrate: null,
    target: null,
    help: false,
  };

  const positional = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      i++;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
      i++;
    } else if (arg === "--verbose" || arg === "-v") {
      parsed.verbose = true;
      i++;
    } else if (arg === "--config") {
      i++;
      if (i >= argv.length) {
        console.error("  Error: --config requires a path argument\n");
        process.exit(1);
      }
      parsed.config = argv[i];
      i++;
    } else if (arg === "--type") {
      i++;
      if (i >= argv.length) {
        console.error("  Error: --type requires a type name argument\n");
        process.exit(1);
      }
      parsed.type = argv[i];
      i++;
    } else if (arg === "--migrate") {
      i++;
      if (i >= argv.length) {
        console.error("  Error: --migrate requires a migration name argument\n");
        process.exit(1);
      }
      parsed.migrate = argv[i];
      i++;
    } else if (arg.startsWith("--")) {
      console.error(`  Error: Unknown flag "${arg}"\n`);
      printUsage();
      process.exit(1);
    } else {
      positional.push(arg);
      i++;
    }
  }

  if (positional.length > 1) {
    console.error("  Error: Only one positional argument (target path) is allowed\n");
    process.exit(1);
  }

  parsed.target = positional[0] || null;

  return parsed;
}

function printUsage() {
  console.log(`
  i18n Codemod — Convert hardcoded user-visible strings to i18n.t() calls.

  Usage:
    npx @shipeasy/sdk-codemod-i18n [options] [target]

  Arguments:
    target                   Directory or file to transform (default: config srcDir)

  Options:
    --config <path>          Path to config JSON file (default: .i18n-codemod.json)
    --dry-run                Preview without writing any files
    --verbose, -v            Show detailed per-file output
    --type <name>            Run only one extraction type (e.g. jsx-text, jsx-attr,
                             string-literal, template-literal)
    --migrate <name>         Run a migration plugin from ./migrate/
    --help, -h               Show this help message

  Config file (.i18n-codemod.json):
    {
      "sdk": "@shipeasy/sdk/client",       // Import path for the SDK
      "function": "i18n.t",                // Translation function call
      "srcDir": "src",                     // Source directory to scan
      "outputJson": "src/i18n/en.json",    // Output translation JSON
      "skipFiles": ["**/*.test.*", ...],   // Glob patterns to skip
      "types": { "jsx-text": true, ... },  // Enabled extraction types
      "skipAttrs": [...],                  // Attributes to skip
      "translatableAttrs": [...],          // Attributes to translate
      "skipStrings": [...],                // Exact strings to skip
      "dedup": {                           // Dedup settings
        "threshold": 2,                    // Min files for common.*
        "predefined": [...]                // Always-common strings
      },
      "containerDirs": ["pages", ...],     // Stripped from scope path
      "migrate": null                      // Migration plugin name
    }

  Examples:
    npx @shipeasy/sdk-codemod-i18n
    npx @shipeasy/sdk-codemod-i18n --dry-run --verbose
    npx @shipeasy/sdk-codemod-i18n --type jsx-text src/pages/
    npx @shipeasy/sdk-codemod-i18n --config custom.json --verbose
    npx @shipeasy/sdk-codemod-i18n --migrate legacy
`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const parsed = parseArgs(args);

  if (parsed.help) {
    printUsage();
    process.exit(0);
  }

  let config;
  try {
    config = loadConfig(parsed.config);
  } catch (err) {
    console.error(`\n  Error loading config: ${err.message}\n`);
    process.exit(1);
  }

  try {
    const result = await run(config, {
      dryRun: parsed.dryRun,
      verbose: parsed.verbose,
      type: parsed.type,
      migrate: parsed.migrate,
      target: parsed.target,
    });

    // Exit with non-zero if nothing was found (useful for CI)
    if (result.filesScanned === 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n  Error: ${err.message}\n`);
    if (parsed.verbose) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
