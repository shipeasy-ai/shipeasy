// NOTE: This codemod uses regex-based transforms, not a full AST.
// This means edge cases (e.g. multi-line JSX, nested quotes in JSX text) may
// not be handled perfectly. Review the generated diff carefully before applying.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { ok, apiErr } from "../../util/api-client.js";

const TRANSLATABLE_EXTENSIONS = new Set([".tsx", ".jsx"]);

// Matches JSX text content: >Some text here< (4+ chars, no tags/braces/newlines)
const JSX_TEXT_RE = />([^<>{}\n]{4,})</g;
// Matches string props that look like UI copy
const STRING_PROP_RE =
  /(?:label|title|placeholder|description|alt|aria-label)=["']([^"']{4,})["']/gi;
// Already wrapped check
const T_CALL_RE = /\bt\(\s*["'`]/;
// useShipEasyI18n import already present
const I18N_IMPORT_RE = /useShipEasyI18n/;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
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

interface StringReplacement {
  key: string;
  value: string;
}

interface FileDiff {
  file: string;
  diff: string;
  strings: StringReplacement[];
}

function buildDiff(file: string, original: string, modified: string): string {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");

  const hunks: string[] = [];
  let i = 0;
  while (i < origLines.length || i < modLines.length) {
    const origLine = origLines[i] ?? "";
    const modLine = modLines[i] ?? "";
    if (origLine !== modLine) {
      const hunkStart = Math.max(0, i - 2);
      const hunkLines: string[] = [`@@ -${i + 1} +${i + 1} @@`];
      // context before
      for (let c = hunkStart; c < i; c++) {
        hunkLines.push(` ${origLines[c] ?? ""}`);
      }
      hunkLines.push(`-${origLine}`);
      hunkLines.push(`+${modLine}`);
      // context after
      for (let c = i + 1; c < Math.min(i + 3, Math.max(origLines.length, modLines.length)); c++) {
        const ctxLine = origLines[c] ?? modLines[c] ?? "";
        if (origLines[c] === modLines[c]) {
          hunkLines.push(` ${ctxLine}`);
        }
      }
      hunks.push(hunkLines.join("\n"));
    }
    i++;
  }

  if (hunks.length === 0) return "";
  return `--- a/${file}\n+++ b/${file}\n${hunks.join("\n")}`;
}

function transformFile(
  content: string,
  keyPrefix: string | undefined,
): { modified: string; strings: StringReplacement[] } {
  const strings: StringReplacement[] = [];
  let modified = content;

  // Replace JSX text: >Text< → >{t("key")}<
  // Only if not already wrapped in {t(
  modified = modified.replace(JSX_TEXT_RE, (match, text: string) => {
    const trimmed = text.trim();
    if (!trimmed || T_CALL_RE.test(match)) return match;
    // Skip purely whitespace or numeric content
    if (/^\s*$/.test(trimmed) || /^\d+$/.test(trimmed)) return match;
    const rawKey = slugify(trimmed);
    if (!rawKey) return match;
    const key = keyPrefix ? `${keyPrefix}_${rawKey}` : rawKey;
    strings.push({ key, value: trimmed });
    return `>{t("${key}")}<`;
  });

  // Replace string props: label="Text" → label={t("key")}
  modified = modified.replace(STRING_PROP_RE, (match, text: string) => {
    if (!text || T_CALL_RE.test(match)) return match;
    const rawKey = slugify(text);
    if (!rawKey) return match;
    const key = keyPrefix ? `${keyPrefix}_${rawKey}` : rawKey;
    // Determine which attr name was matched
    const attrMatch = /^(\w[\w-]*)=/.exec(match);
    const attr = attrMatch?.[1] ?? match.split("=")[0];
    strings.push({ key, value: text });
    return `${attr}={t("${key}")}`;
  });

  // If we made replacements and the import isn't already present, add it
  if (strings.length > 0 && !I18N_IMPORT_RE.test(modified)) {
    // Find the last import line
    const lines = modified.split("\n");
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^import\s/.test(lines[i]!)) lastImportIdx = i;
    }
    const importLine = `import { useShipEasyI18n } from "@shipeasy/i18n-react";`;
    const todoComment = `// TODO: add const { t } = useShipEasyI18n(); inside your component`;
    if (lastImportIdx >= 0) {
      lines.splice(lastImportIdx + 1, 0, importLine, todoComment);
    } else {
      lines.unshift(importLine, todoComment);
    }
    modified = lines.join("\n");
  }

  return { modified, strings };
}

export async function handleCodemodPreview(input: {
  framework: string;
  files: string[];
  profile?: string;
  key_prefix?: string;
}) {
  try {
    const allFiles: string[] = [];
    for (const p of input.files) await walkFiles(p, allFiles);

    const diffs: FileDiff[] = [];
    let totalStrings = 0;

    for (const file of allFiles) {
      const original = await readFile(file, "utf8").catch(() => "");
      if (!original) continue;

      const { modified, strings } = transformFile(original, input.key_prefix);
      if (strings.length === 0) continue;

      totalStrings += strings.length;
      const diff = buildDiff(file, original, modified);
      diffs.push({ file, diff, strings });
    }

    return ok({
      files_changed: diffs.length,
      total_strings: totalStrings,
      diffs,
    });
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

      const { modified, strings } = transformFile(original, input.key_prefix);
      if (strings.length === 0) continue;

      await writeFile(file, modified, "utf8");
      filesChanged++;
      totalStrings += strings.length;

      for (const s of strings) {
        reviewData[s.key] = s.value;
      }
    }

    // Write the review JSON to cwd
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
