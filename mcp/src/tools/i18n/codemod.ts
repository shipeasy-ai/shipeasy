import ts from "typescript";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { ok, apiErr } from "../../util/api-client.js";

const TRANSLATABLE_EXTENSIONS = new Set([".tsx", ".jsx"]);

const TRANSLATABLE_ATTR_NAMES = new Set([
  "label",
  "title",
  "placeholder",
  "description",
  "alt",
  "aria-label",
  "caption",
  "heading",
  "tooltip",
  "helperText",
  "errorMessage",
]);

// ── helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function isTranslatableText(text: string): boolean {
  const t = text.trim();
  if (t.length < 3) return false;
  if (!/[a-zA-Z]/.test(t)) return false; // must contain a letter
  if (/^https?:\/\//.test(t)) return false; // skip URLs
  if (/^[\d\s.,/$%@#!^&*()\[\]{};:]+$/.test(t)) return false; // pure symbols/numbers
  // skip short all-lowercase tokens that look like identifiers (e.g. "sm", "lg", "px")
  if (/^[a-z][a-z0-9-]*$/.test(t) && t.length <= 5) return false;
  return true;
}

async function walkFiles(dir: string, files: string[] = []): Promise<string[]> {
  if (!existsSync(dir)) return files;
  const s = await stat(dir);
  if (s.isFile()) {
    if (TRANSLATABLE_EXTENSIONS.has(extname(dir))) files.push(dir);
    return files;
  }
  const entries = await readdir(dir);
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    await walkFiles(join(dir, entry), files);
  }
  return files;
}

// ── AST transform ─────────────────────────────────────────────────────────────

interface Replacement {
  pos: number;
  end: number;
  replacement: string;
  key: string;
  value: string;
}

function findReplacements(source: string, filePath: string, keyPrefix?: string): Replacement[] {
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.JSX;
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind,
  );

  const replacements: Replacement[] = [];
  const seenPos = new Set<number>();

  function key(raw: string): string {
    const k = slugify(raw);
    return keyPrefix ? `${keyPrefix}_${k}` : k;
  }

  function visit(node: ts.Node): void {
    // ── JsxText: bare text between JSX tags ──────────────────────────────
    if (ts.isJsxText(node)) {
      const rawText = source.slice(node.pos, node.end);
      const trimmed = rawText.trim();
      if (isTranslatableText(trimmed) && !trimmed.includes('t("') && !seenPos.has(node.pos)) {
        const k = key(trimmed);
        if (k) {
          seenPos.add(node.pos);
          const leading = rawText.match(/^(\s*)/)?.[1] ?? "";
          const trailing = rawText.match(/(\s*)$/)?.[1] ?? "";
          replacements.push({
            pos: node.pos,
            end: node.end,
            replacement: `${leading}{t("${k}")}${trailing}`,
            key: k,
            value: trimmed,
          });
        }
      }
    }

    // ── JsxAttribute with StringLiteral value ────────────────────────────
    if (ts.isJsxAttribute(node)) {
      const attrName = node.name.getText(sourceFile).toLowerCase();
      if (TRANSLATABLE_ATTR_NAMES.has(attrName)) {
        const init = node.initializer;
        if (init && ts.isStringLiteral(init)) {
          const value = init.text; // full decoded string, handles escapes + embedded quotes
          const start = init.getStart(sourceFile);
          if (isTranslatableText(value) && !seenPos.has(start)) {
            const k = key(value);
            if (k) {
              seenPos.add(start);
              replacements.push({
                pos: start,
                end: init.getEnd(),
                replacement: `{t("${k}")}`,
                key: k,
                value,
              });
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return replacements;
}

function applyReplacements(source: string, replacements: Replacement[]): string {
  // Sort descending by position so earlier replacements don't shift later offsets
  const sorted = [...replacements].sort((a, b) => b.pos - a.pos);
  let result = source;
  for (const r of sorted) {
    result = result.slice(0, r.pos) + r.replacement + result.slice(r.end);
  }
  return result;
}

function addI18nImport(source: string): string {
  if (/useShipEasyI18n/.test(source)) return source;

  const sf = ts.createSourceFile(
    "_tmp.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let lastImportEnd = 0;
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      lastImportEnd = stmt.getEnd();
    } else if (lastImportEnd > 0) {
      break;
    }
  }

  const insert =
    `\nimport { useShipEasyI18n } from "@shipeasy/i18n-react";` +
    `\n// TODO: add \`const { t } = useShipEasyI18n();\` inside your component`;

  if (lastImportEnd === 0) return insert + "\n" + source;
  return source.slice(0, lastImportEnd) + insert + source.slice(lastImportEnd);
}

// ── diff builder ──────────────────────────────────────────────────────────────

function buildDiff(file: string, original: string, modified: string): string {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  const hunks: string[] = [];
  const maxLen = Math.max(origLines.length, modLines.length);

  let i = 0;
  while (i < maxLen) {
    if ((origLines[i] ?? "") !== (modLines[i] ?? "")) {
      const hunkStart = Math.max(0, i - 2);
      const lines: string[] = [`@@ -${i + 1} +${i + 1} @@`];
      for (let c = hunkStart; c < i; c++) lines.push(` ${origLines[c] ?? ""}`);
      lines.push(`-${origLines[i] ?? ""}`);
      lines.push(`+${modLines[i] ?? ""}`);
      for (let c = i + 1; c < Math.min(i + 3, maxLen); c++) {
        if ((origLines[c] ?? "") === (modLines[c] ?? "")) lines.push(` ${origLines[c] ?? ""}`);
      }
      hunks.push(lines.join("\n"));
    }
    i++;
  }

  if (hunks.length === 0) return "";
  return `--- a/${file}\n+++ b/${file}\n${hunks.join("\n")}`;
}

// ── transform entry (shared by preview + apply) ───────────────────────────────

interface TransformResult {
  modified: string;
  strings: { key: string; value: string }[];
}

function transformFile(content: string, filePath: string, keyPrefix?: string): TransformResult {
  const replacements = findReplacements(content, filePath, keyPrefix);
  if (replacements.length === 0) return { modified: content, strings: [] };

  let modified = applyReplacements(content, replacements);
  modified = addI18nImport(modified);

  return {
    modified,
    strings: replacements.map((r) => ({ key: r.key, value: r.value })),
  };
}

// ── public handlers ───────────────────────────────────────────────────────────

export async function handleCodemodPreview(input: {
  framework: string;
  files: string[];
  profile?: string;
  key_prefix?: string;
}) {
  try {
    const allFiles: string[] = [];
    for (const p of input.files) await walkFiles(p, allFiles);

    const diffs = [];
    let totalStrings = 0;

    for (const file of allFiles) {
      const original = await readFile(file, "utf8").catch(() => "");
      if (!original) continue;

      const { modified, strings } = transformFile(original, file, input.key_prefix);
      if (strings.length === 0) continue;

      totalStrings += strings.length;
      const diff = buildDiff(file, original, modified);
      diffs.push({ file, diff, strings });
    }

    return ok({ files_changed: diffs.length, total_strings: totalStrings, diffs });
  } catch (err) {
    return apiErr(err);
  }
}

export async function handleCodemodApply(input: {
  framework: string;
  files: string[];
  confirm: boolean;
  profile?: string;
  key_prefix?: string;
}) {
  if (!input.confirm) return apiErr("Pass confirm: true to apply");

  try {
    const allFiles: string[] = [];
    for (const p of input.files) await walkFiles(p, allFiles);

    const reviewData: Record<string, string> = {};
    let filesChanged = 0;
    let totalStrings = 0;

    for (const file of allFiles) {
      const original = await readFile(file, "utf8").catch(() => "");
      if (!original) continue;

      const { modified, strings } = transformFile(original, file, input.key_prefix);
      if (strings.length === 0) continue;

      await writeFile(file, modified, "utf8");
      filesChanged++;
      totalStrings += strings.length;
      for (const s of strings) reviewData[s.key] = s.value;
    }

    const reviewFile = join(process.cwd(), "i18n-codemod-review.json");
    await writeFile(reviewFile, JSON.stringify(reviewData, null, 2) + "\n", "utf8");

    return ok({
      files_changed: filesChanged,
      total_strings: totalStrings,
      review_file: "i18n-codemod-review.json",
    });
  } catch (err) {
    return apiErr(err);
  }
}
