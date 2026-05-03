/**
 * runner.mjs — Core orchestrator for the i18n codemod.
 *
 * Implements the same three-pass pipeline as the monolith codemod-i18n.mjs:
 *   Pass 1 — extract all translatable strings with AST positions
 *   Pass 2 — deduplicate (strings in 2+ files -> common.*)
 *   Pass 3 — transform files, write en.json
 *
 * Type modules are loaded dynamically from ./types/ so new extraction types
 * can be added without touching the runner.
 */

import fs from "node:fs";
import path from "node:path";

import { parseFile, traverse, t } from "./lib/parse.mjs";
import { isTranslatableString, toSourceString } from "./lib/strings.mjs";
import { filePathToScope, stringToSubKey } from "./lib/keys.mjs";
import { buildCommonKeys } from "./lib/dedup.mjs";

// ── Skip-file regexes (built from config globs) ──────────────────────────────

/**
 * Convert simple glob patterns to RegExp. Supports ** and * wildcards.
 */
function globToRegex(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "<<GLOBSTAR>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<GLOBSTAR>>/g, ".*");
  return new RegExp(escaped);
}

// ── Import injection ─────────────────────────────────────────────────────────

function addImport(source, ast, importStatement) {
  // Already imported?
  const importObj = importStatement.match(/\{([^}]+)\}/)?.[1]?.trim();
  const importFrom = importStatement.match(/from\s+['"]([^'"]+)['"]/)?.[1];
  if (importObj && importFrom) {
    const re = new RegExp(
      `import\\s*\\{[^}]*\\b${importObj.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^}]*\\}\\s*from\\s*['"]${importFrom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]`,
    );
    if (re.test(source)) return source;
  }

  // Find position after last import or directive
  let insertAfter = 0;
  for (const node of ast.program.body) {
    if (t.isImportDeclaration(node)) {
      insertAfter = node.end;
    } else if (
      t.isExpressionStatement(node) &&
      t.isStringLiteral(node.expression) &&
      ["use client", "use server", "use strict"].includes(node.expression.value)
    ) {
      if (node.end > insertAfter) insertAfter = node.end;
    }
  }

  if (insertAfter > 0) {
    return source.slice(0, insertAfter) + "\n" + importStatement + source.slice(insertAfter);
  }
  return importStatement + "\n" + source;
}

// ── File discovery ───────────────────────────────────────────────────────────

function discoverFiles(target, rootDir, skipRegexes) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    const rel = path.relative(rootDir, target);
    if (/\.(tsx?|jsx?)$/.test(target) && !skipRegexes.some((re) => re.test(rel))) {
      return [target];
    }
    return [];
  }

  const results = [];
  function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "__generated__") continue;
        walk(full);
      } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
        const rel = path.relative(rootDir, full);
        if (skipRegexes.some((re) => re.test(rel))) continue;
        results.push(full);
      }
    }
  }

  walk(target);
  return results.sort();
}

// ── Transformation ───────────────────────────────────────────────────────────

function transformFile(
  filePath,
  source,
  ast,
  extractions,
  commonKeys,
  parameterizedTemplates,
  config,
) {
  if (!extractions.length) return { source, changed: false, keys: {} };

  const srcDir = path.resolve(config.srcDir);
  const containerSet = new Set(config.containerDirs);
  const scope = filePathToScope(filePath, srcDir, containerSet);
  const keys = {};
  const usedSubKeys = new Map();
  const stringKeyCache = new Map();

  // Derive the import name from the function config (e.g. 'i18n' from 'i18n.t')
  const fnParts = config.function.split(".");
  const importName = fnParts[0];

  const replacements = [];
  for (const ext of extractions) {
    // Determine key
    let key;
    if (commonKeys.has(ext.original)) {
      key = commonKeys.get(ext.original);
    } else if (stringKeyCache.has(ext.original)) {
      key = stringKeyCache.get(ext.original);
    } else {
      let subKey = stringToSubKey(ext.original, ext.propName);
      const count = (usedSubKeys.get(subKey) ?? 0) + 1;
      usedSubKeys.set(subKey, count);
      if (count > 1) subKey = `${subKey}${count}`;
      key = `${scope}.${subKey}`;
      stringKeyCache.set(ext.original, key);
    }

    // Build replacement text
    const paramTpl = parameterizedTemplates.get(ext.original);
    let fallbackStr, varsArg;
    if (paramTpl && !ext.templateVarsSource) {
      const digits = ext.original.match(/\b\d+\b/g) ?? [];
      const varEntries = digits.map((d, i) => `n${i + 1}: ${d}`);
      fallbackStr = toSourceString(paramTpl);
      varsArg = varEntries.length ? `, { ${varEntries.join(", ")} }` : "";
      keys[key] = paramTpl;
    } else {
      fallbackStr = toSourceString(ext.original);
      varsArg = ext.templateVarsSource || "";
      keys[key] = ext.original;
    }

    const keyStr = `'${key.replace(/'/g, "\\'")}'`;
    const call = `${config.function}(${keyStr}, ${fallbackStr}${varsArg})`;

    let newText;
    if (ext.wrapBraces) {
      newText = `{${call}}`;
    } else {
      newText = call;
    }

    replacements.push({ start: ext.start, end: ext.end, newText });
  }

  // Apply replacements in reverse order
  let result = source;
  replacements.sort((a, b) => b.start - a.start);
  for (const r of replacements) {
    result = result.slice(0, r.start) + r.newText + result.slice(r.end);
  }

  // Add import
  const importStatement = `import { ${importName} } from '${config.sdk}'`;
  result = addImport(result, ast, importStatement);

  return { source: result, changed: true, keys };
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Run the i18n codemod pipeline.
 *
 * @param {object} config — Normalized config from loadConfig()
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false]  — Preview without writing files
 * @param {boolean} [options.verbose=false] — Detailed per-file output
 * @param {string}  [options.target]        — Target directory or file (absolute path).
 *   Defaults to config.srcDir resolved from cwd.
 * @param {string}  [options.type]          — Run only one extraction type (e.g. 'jsx-text')
 * @param {string}  [options.migrate]       — Run a migration plugin by name
 * @returns {Promise<{ filesScanned: number, filesModified: number, totalStrings: number, totalKeys: number }>}
 */
export async function run(config, options = {}) {
  const { dryRun = false, verbose = false, target: targetOverride } = options;

  const rootDir = process.cwd();
  const srcDir = path.resolve(rootDir, config.srcDir);
  const target = targetOverride ? path.resolve(targetOverride) : srcDir;
  const outputJson = path.resolve(rootDir, config.outputJson);

  // Build skip regexes from config globs + hardcoded infrastructure patterns
  const skipRegexes = [
    ...config.skipFiles.map((g) => globToRegex(g)),
    /\/enums\//,
    /vite\.config/,
    /tailwind\.config/,
    /eslint\.config/,
    /postcss\.config/,
    /tsconfig/,
    /\/i18n\//,
    /\/scripts\//,
  ];

  // Build the helpers object passed to type modules. Type modules also import
  // from ../lib/ directly, but helpers provides config-aware overrides (e.g.
  // translatableAttrs/skipAttrs may be extended by the user's config).
  const translatableAttrs = new Set(config.translatableAttrs);
  const skipAttrs = new Set(config.skipAttrs);
  const skipStringsSet = new Set(config.skipStrings);

  const isTranslatableStringWithSkips = (str) => {
    if (skipStringsSet.has(str) || skipStringsSet.has(str.trim())) return false;
    return isTranslatableString(str);
  };

  const helpers = {
    t,
    isTranslatableString: isTranslatableStringWithSkips,
    translatableAttrs,
    skipAttrs,
  };

  console.log(
    `\n  i18n Codemod ${dryRun ? "(dry run) " : ""}-- scanning ${path.relative(rootDir, target)}\n`,
  );

  // ── Step 1: Load enabled type modules ──────────────────────────────────

  const enabledTypes = Object.entries(config.types).filter(([, v]) => v !== false);
  const typeModules = [];

  // Support --type filter: narrows to a single type
  const typeFilter = options.type || null;

  for (const [typeName, typeParams] of enabledTypes) {
    if (typeFilter && typeName !== typeFilter) continue;

    try {
      const modulePath = new URL(`./types/${typeName}.mjs`, import.meta.url).href;
      const mod = await import(modulePath);
      const typeModule = mod.default || mod;

      if (typeof typeModule.visitors !== "function") {
        console.warn(`  [warn] Type module "${typeName}" has no visitors() export -- skipped`);
        continue;
      }

      typeModules.push({
        name: typeName,
        params: typeof typeParams === "object" ? typeParams : {},
        mod: typeModule,
      });
    } catch (err) {
      console.warn(`  [warn] Failed to load type module "${typeName}": ${err.message}`);
    }
  }

  if (!typeModules.length) {
    console.log("  No type modules loaded -- nothing to do.\n");
    return { filesScanned: 0, filesModified: 0, totalStrings: 0, totalKeys: 0 };
  }

  if (verbose) {
    console.log(`  Loaded types: ${typeModules.map((m) => m.name).join(", ")}\n`);
  }

  // ── Step 2: Discover files ─────────────────────────────────────────────

  const files = discoverFiles(target, rootDir, skipRegexes);
  console.log(`  Found ${files.length} files to scan\n`);

  // ── Step 3: Extract (Pass 1) ───────────────────────────────────────────

  const allFiles = [];
  let totalExtractions = 0;

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, "utf8");

    let ast;
    try {
      ast = parseFile(source);
    } catch {
      if (verbose) console.log(`  [skip] parse error: ${filePath}`);
      continue;
    }

    // Collect extractions from all type visitors
    const extractions = [];
    const addExtraction = (ext) => {
      if (ext.start == null || ext.end == null) return;
      if (ext.start >= ext.end) return;
      extractions.push(ext);
    };

    // Get visitors from each type module and merge into a single visitor
    // object for a single babel traverse call per file. Each type module's
    // visitors() receives (typeParams, helpers) and returns
    // { NodeType(path, addExtraction, source) }.
    const mergedVisitors = {};

    for (const typeMod of typeModules) {
      const typeVisitors = typeMod.mod.visitors(typeMod.params, helpers);
      for (const [nodeType, handler] of Object.entries(typeVisitors)) {
        if (mergedVisitors[nodeType]) {
          // Chain multiple handlers for the same node type
          const existing = mergedVisitors[nodeType];
          mergedVisitors[nodeType] = function (p) {
            existing.call(this, p);
            handler.call(this, p, addExtraction, source);
          };
        } else {
          mergedVisitors[nodeType] = function (p) {
            handler.call(this, p, addExtraction, source);
          };
        }
      }
    }

    // Single babel traverse with all type visitors merged
    traverse(ast, mergedVisitors);

    // Remove overlapping extractions (keep the one starting earlier / larger)
    extractions.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
    const deduped = [];
    let lastEnd = -1;
    for (const ext of extractions) {
      if (ext.start >= lastEnd) {
        deduped.push(ext);
        lastEnd = ext.end;
      }
    }

    if (deduped.length > 0) {
      allFiles.push({ filePath, source, ast, extractions: deduped });
      totalExtractions += deduped.length;
      if (verbose) {
        console.log(`  ${path.relative(rootDir, filePath)}: ${deduped.length} strings`);
      }
    }
  }

  console.log(`  Pass 1: ${totalExtractions} translatable strings in ${allFiles.length} files\n`);

  if (!totalExtractions) {
    console.log("  Nothing to transform.\n");
    return { filesScanned: files.length, filesModified: 0, totalStrings: 0, totalKeys: 0 };
  }

  // ── Step 4: Deduplicate (Pass 2) ───────────────────────────────────────

  const predefinedSet = new Set(config.dedup.predefined);
  const { commonKeys, parameterizedTemplates } = buildCommonKeys(allFiles, {
    predefinedCommon: predefinedSet,
    minFileCount: config.dedup.threshold,
  });

  const commonCount = commonKeys.size;
  let commonOccurrences = 0;
  for (const { extractions } of allFiles) {
    for (const ext of extractions) {
      if (commonKeys.has(ext.original)) commonOccurrences++;
    }
  }
  console.log(`  Pass 2: ${commonCount} common keys (${commonOccurrences} occurrences)\n`);

  // ── Step 5: Transform (Pass 3) ─────────────────────────────────────────

  const allTranslations = {};
  let filesModified = 0;

  for (const { filePath, source, ast, extractions } of allFiles) {
    const {
      source: newSource,
      changed,
      keys,
    } = transformFile(
      filePath,
      source,
      ast,
      extractions,
      commonKeys,
      parameterizedTemplates,
      config,
    );
    if (!changed) continue;
    filesModified++;
    Object.assign(allTranslations, keys);

    if (dryRun) {
      if (verbose) console.log(`  [would write] ${path.relative(rootDir, filePath)}`);
    } else {
      fs.writeFileSync(filePath, newSource, "utf8");
    }
  }

  // ── Step 6: Write en.json (merge with existing) ────────────────────────

  let existingTranslations = {};
  try {
    existingTranslations = JSON.parse(fs.readFileSync(outputJson, "utf8"));
  } catch {}
  const merged = { ...existingTranslations, ...allTranslations };
  const sortedTranslations = Object.fromEntries(
    Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)),
  );
  const totalKeys = Object.keys(sortedTranslations).length;

  if (!dryRun) {
    fs.mkdirSync(path.dirname(outputJson), { recursive: true });
    fs.writeFileSync(outputJson, JSON.stringify(sortedTranslations, null, 2) + "\n", "utf8");
  }

  // ── Step 7: Report ─────────────────────────────────────────────────────

  console.log("  ===================================================");
  console.log(`  i18n Codemod Report${dryRun ? " (DRY RUN)" : ""}`);
  console.log("  ===================================================");
  console.log(`  Files scanned:      ${files.length}`);
  console.log(`  Files modified:     ${filesModified}`);
  console.log(`  Total strings:      ${totalExtractions}`);
  console.log(`  Common (deduped):   ${commonCount} unique keys, ${commonOccurrences} occurrences`);
  console.log(`  File-scoped keys:   ${totalKeys - commonCount}`);
  console.log(`  Total keys in JSON: ${totalKeys}`);
  if (!dryRun) {
    console.log(`  Translation file:   ${path.relative(rootDir, outputJson)}`);
  }
  console.log("  ===================================================\n");

  // Top common strings
  if (commonCount > 0) {
    const freq = new Map();
    for (const { extractions } of allFiles) {
      for (const ext of extractions) {
        if (commonKeys.has(ext.original)) {
          freq.set(ext.original, (freq.get(ext.original) ?? 0) + 1);
        }
      }
    }
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

    console.log("  Top common strings:");
    for (const [str, count] of top) {
      const key = commonKeys.get(str);
      console.log(`    ${count.toString().padStart(4)}x  ${key.padEnd(35)} "${str}"`);
    }
    console.log();
  }

  // ── Step 8: Run migration plugin if specified ──────────────────────────

  const migrateName = options.migrate || config.migrate;
  if (migrateName) {
    try {
      const migrateUrl = new URL(`./migrate/${migrateName}.mjs`, import.meta.url).href;
      const migrateMod = await import(migrateUrl);
      const migrateRunner = migrateMod.default || migrateMod;
      if (typeof migrateRunner.run === "function") {
        console.log(`  Running migration: ${migrateName}\n`);
        await migrateRunner.run(config, { dryRun, verbose, target });
      } else {
        console.warn(`  [warn] Migration "${migrateName}" has no run() export`);
      }
    } catch (err) {
      console.error(`  [error] Migration "${migrateName}" failed: ${err.message}`);
    }
  }

  return { filesScanned: files.length, filesModified, totalStrings: totalExtractions, totalKeys };
}
