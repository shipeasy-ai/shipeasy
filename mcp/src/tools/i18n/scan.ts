import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { ok, apiErr } from "../../util/api-client.js";

const TRANSLATABLE_EXTENSIONS = new Set([".tsx", ".ts", ".jsx", ".js"]);

// Matches JSX text content: >Some text here< (not just whitespace, not just {expr})
const JSX_TEXT_RE = />([^<>{}\n]{4,})</g;
// Matches string props that look like UI copy: label="..." title="..." placeholder="..."
const STRING_PROP_RE =
  /(?:label|title|placeholder|description|text|heading|caption|alt|aria-label)=["']([^"']{4,})["']/gi;
// Matches shipeasy t() calls already in code: t("key.name")
const T_CALL_RE = /\bt\(\s*["'`]([a-z0-9_.:-]+)["'`]\s*\)/g;

interface ScanCandidate {
  file: string;
  line: number;
  text: string;
  suggested_key?: string;
  kind: "jsx_text" | "string_prop" | "t_call";
}

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

export async function scanFiles(
  paths: string[],
  opts: { keysOnly?: boolean } = {},
): Promise<ScanCandidate[]> {
  const allFiles: string[] = [];
  for (const p of paths) await walkFiles(p, allFiles);

  const results: ScanCandidate[] = [];

  for (const file of allFiles) {
    const src = await readFile(file, "utf8").catch(() => "");
    const lines = src.split("\n");

    // t() calls — already wrapped keys
    for (const [, key] of src.matchAll(T_CALL_RE)) {
      const line = lines.findIndex((l) => l.includes(`t("${key}")`)) + 1;
      results.push({ file, line, text: key, suggested_key: key, kind: "t_call" });
    }

    if (opts.keysOnly) continue;

    // JSX text
    for (const [, text] of src.matchAll(JSX_TEXT_RE)) {
      const trimmed = text.trim();
      if (!trimmed || /^\{/.test(trimmed)) continue;
      const line = lines.findIndex((l) => l.includes(trimmed)) + 1;
      results.push({
        file,
        line,
        text: trimmed,
        suggested_key: slugify(trimmed),
        kind: "jsx_text",
      });
    }

    // String props
    for (const [, text] of src.matchAll(STRING_PROP_RE)) {
      const line = lines.findIndex((l) => l.includes(text)) + 1;
      results.push({ file, line, text, suggested_key: slugify(text), kind: "string_prop" });
    }
  }

  return results;
}

export async function handleScanCode(input: { paths?: string[]; framework?: string }) {
  const scanPaths = input.paths ?? [process.cwd()];
  try {
    const candidates = await scanFiles(scanPaths);
    const unwrapped = candidates.filter((c) => c.kind !== "t_call");
    return ok({
      total_candidates: unwrapped.length,
      already_wrapped: candidates.filter((c) => c.kind === "t_call").length,
      candidates: unwrapped.slice(0, 200),
      note:
        unwrapped.length > 200 ? `Showing first 200 of ${unwrapped.length} candidates.` : undefined,
    });
  } catch (err) {
    return apiErr(err);
  }
}
