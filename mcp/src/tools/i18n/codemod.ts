import ts from "typescript";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join, extname, sep, relative, resolve, dirname } from "node:path";
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

// A key going into `common` chunk needs to appear in at least this many distinct files.
const COMMON_MIN_FILES = 3;

// Framework-specific "source-root" folders stripped from the chunk path.
// Only folders that don't carry semantic meaning for chunking — e.g. Next.js `app/`
// IS semantic (App Router) so we don't strip it, but `src/` is a mechanical wrapper.
const SRC_ROOT_SEGMENTS: Record<string, string[]> = {
  nextjs: ["src"],
  react: ["src"],
  vue: ["src"],
  svelte: ["src"],
  angular: ["src"],
  default: ["src"],
};

// ── helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function sanitizeChunkName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/_{2,}/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");
  return cleaned.slice(0, 64) || "root";
}

function isTranslatableText(text: string): boolean {
  const t = text.trim();
  if (t.length < 3) return false;
  if (!/[a-zA-Z]/.test(t)) return false;
  if (/^https?:\/\//.test(t)) return false;
  if (/^[\d\s.,/$%@#!^&*()\[\]{};:]+$/.test(t)) return false;
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

// Walk upward from `file` looking for a repo-root marker. Order matters: `.git`
// is the strongest signal, then pnpm/npm/yarn workspaces, then the outermost
// package.json (for non-monorepo projects).
function findRepoRoot(file: string): string {
  const absFile = resolve(file);
  let dir = statSync(absFile).isFile() ? dirname(absFile) : absFile;
  let lastPackageJson: string | null = null;

  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (existsSync(join(dir, "package.json"))) lastPackageJson = dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: topmost package.json we saw, else the file's directory.
  return lastPackageJson ?? dirname(absFile);
}

// Given a path relative to repo root (POSIX-style), strip framework-specific
// source-root segments like `apps/ui/src/app` → `apps/ui/app` (Next.js src dir)
// or `packages/x/src/lib` → `packages/x/lib`.
function stripSrcSegments(relPosix: string, framework: string): string {
  const stripSet = new Set(SRC_ROOT_SEGMENTS[framework] ?? SRC_ROOT_SEGMENTS.default);
  const parts = relPosix.split("/").filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (stripSet.has(p)) continue;
    out.push(p);
  }
  return out.join("/");
}

// ── AST transform ─────────────────────────────────────────────────────────────

interface RawReplacement {
  pos: number;
  end: number;
  slug: string;
  value: string;
  kind: "jsx_text" | "jsx_attr";
  leading: string;
  trailing: string;
}

function findRawReplacements(source: string, filePath: string): RawReplacement[] {
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.JSX;
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  const out: RawReplacement[] = [];
  const seenPos = new Set<number>();

  function visit(node: ts.Node): void {
    if (ts.isJsxText(node)) {
      const rawText = source.slice(node.pos, node.end);
      const trimmed = rawText.trim();
      if (isTranslatableText(trimmed) && !trimmed.includes('t("') && !seenPos.has(node.pos)) {
        const slug = slugify(trimmed);
        if (slug) {
          seenPos.add(node.pos);
          out.push({
            pos: node.pos,
            end: node.end,
            slug,
            value: trimmed,
            kind: "jsx_text",
            leading: rawText.match(/^(\s*)/)?.[1] ?? "",
            trailing: rawText.match(/(\s*)$/)?.[1] ?? "",
          });
        }
      }
    }

    if (ts.isJsxAttribute(node)) {
      const attrName = node.name.getText(sourceFile).toLowerCase();
      if (TRANSLATABLE_ATTR_NAMES.has(attrName)) {
        const init = node.initializer;
        if (init && ts.isStringLiteral(init)) {
          const value = init.text;
          const start = init.getStart(sourceFile);
          if (isTranslatableText(value) && !seenPos.has(start)) {
            const slug = slugify(value);
            if (slug) {
              seenPos.add(start);
              out.push({
                pos: start,
                end: init.getEnd(),
                slug,
                value,
                kind: "jsx_attr",
                leading: "",
                trailing: "",
              });
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return out;
}

function applyReplacementsWithPlan(
  source: string,
  entries: Array<{ raw: RawReplacement; finalKey: string }>,
): string {
  const sorted = [...entries].sort((a, b) => b.raw.pos - a.raw.pos);
  let result = source;
  for (const { raw, finalKey } of sorted) {
    const replacement =
      raw.kind === "jsx_text"
        ? `${raw.leading}{t("${finalKey}")}${raw.trailing}`
        : `{t("${finalKey}")}`;
    result = result.slice(0, raw.pos) + replacement + result.slice(raw.end);
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

// ── chunk planner ─────────────────────────────────────────────────────────────

interface FileCollected {
  file: string;
  content: string;
  replacements: RawReplacement[];
  repoRoot: string;
  chunkName: string; // precomputed full-path chunk for this file
}

interface PlanEntry {
  raw: RawReplacement;
  finalKey: string;
  chunk: string;
}

interface Plan {
  perFile: Map<string, PlanEntry[]>;
  chunks: Record<string, Record<string, string>>;
}

// Compute the chunk name for a file: full folder path from repo root, with
// framework-specific source-root segments stripped.
function fileChunkName(file: string, repoRoot: string, framework: string): string {
  const relPath = relative(repoRoot, file).split(sep).join("/");
  const folder = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
  const stripped = stripSrcSegments(folder, framework);
  if (!stripped) return "root";
  return sanitizeChunkName(stripped.replace(/\//g, "."));
}

function planChunks(collected: FileCollected[]): Plan {
  // 1. Count distinct files per slug so frequently-reused strings can go to `common`.
  const slugFiles = new Map<string, Set<string>>();
  for (const fc of collected) {
    for (const r of fc.replacements) {
      let s = slugFiles.get(r.slug);
      if (!s) {
        s = new Set();
        slugFiles.set(r.slug, s);
      }
      s.add(fc.file);
    }
  }
  const commonSlugs = new Set<string>();
  for (const [slug, files] of slugFiles) {
    if (files.size >= COMMON_MIN_FILES) commonSlugs.add(slug);
  }

  // 2. Assemble using each file's precomputed full-path chunk name.
  const perFile = new Map<string, PlanEntry[]>();
  const chunks: Record<string, Record<string, string>> = {};

  for (const fc of collected) {
    const entries: PlanEntry[] = [];
    for (const r of fc.replacements) {
      const chunk = commonSlugs.has(r.slug) ? "common" : fc.chunkName;
      const finalKey = `${chunk}.${r.slug}`;
      entries.push({ raw: r, finalKey, chunk });
      if (!chunks[chunk]) chunks[chunk] = {};
      chunks[chunk][finalKey] = r.value;
    }
    perFile.set(fc.file, entries);
  }

  return { perFile, chunks };
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

// ── shared collection phase ───────────────────────────────────────────────────

async function collectAll(inputPaths: string[], framework: string): Promise<FileCollected[]> {
  const allFiles: string[] = [];
  for (const p of inputPaths) await walkFiles(p, allFiles);

  const collected: FileCollected[] = [];
  for (const file of allFiles) {
    const content = await readFile(file, "utf8").catch(() => "");
    if (!content) continue;
    const replacements = findRawReplacements(content, file);
    if (replacements.length === 0) continue;
    const repoRoot = findRepoRoot(file);
    collected.push({
      file,
      content,
      replacements,
      repoRoot,
      chunkName: fileChunkName(file, repoRoot, framework),
    });
  }
  return collected;
}

// ── public handlers ───────────────────────────────────────────────────────────

export async function handleCodemodPreview(input: {
  framework: string;
  files: string[];
  profile?: string;
  key_prefix?: string;
}) {
  try {
    const collected = await collectAll(input.files, input.framework);
    const plan = planChunks(collected);

    const diffs = [];
    let totalStrings = 0;

    for (const fc of collected) {
      const entries = plan.perFile.get(fc.file) ?? [];
      if (entries.length === 0) continue;
      let modified = applyReplacementsWithPlan(fc.content, entries);
      modified = addI18nImport(modified);
      totalStrings += entries.length;
      diffs.push({
        file: fc.file,
        diff: buildDiff(fc.file, fc.content, modified),
        strings: entries.map((e) => ({ key: e.finalKey, value: e.raw.value, chunk: e.chunk })),
      });
    }

    return ok({
      files_changed: diffs.length,
      total_strings: totalStrings,
      chunks: Object.fromEntries(
        Object.entries(plan.chunks).map(([c, m]) => [c, Object.keys(m).length]),
      ),
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
    const collected = await collectAll(input.files, input.framework);
    const plan = planChunks(collected);

    let filesChanged = 0;
    let totalStrings = 0;

    for (const fc of collected) {
      const entries = plan.perFile.get(fc.file) ?? [];
      if (entries.length === 0) continue;
      let modified = applyReplacementsWithPlan(fc.content, entries);
      modified = addI18nImport(modified);
      await writeFile(fc.file, modified, "utf8");
      filesChanged++;
      totalStrings += entries.length;
    }

    const reviewFile = join(process.cwd(), "i18n-codemod-review.json");
    const reviewDoc = {
      version: 2,
      chunks: plan.chunks,
    };
    await writeFile(reviewFile, JSON.stringify(reviewDoc, null, 2) + "\n", "utf8");

    return ok({
      files_changed: filesChanged,
      total_strings: totalStrings,
      chunks: Object.fromEntries(
        Object.entries(plan.chunks).map(([c, m]) => [c, Object.keys(m).length]),
      ),
      review_file: "i18n-codemod-review.json",
    });
  } catch (err) {
    return apiErr(err);
  }
}
