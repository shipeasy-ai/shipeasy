import ts from "typescript";
import { readFile } from "node:fs/promises";
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
  "helpertext",
  "errormessage",
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

function posToLine(source: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

// ── types ─────────────────────────────────────────────────────────────────────

interface ScanCandidate {
  file: string;
  line: number;
  text: string;
  suggested_key?: string;
  kind: "jsx_text" | "string_prop" | "t_call";
}

// ── AST scan ──────────────────────────────────────────────────────────────────

function scanSource(
  source: string,
  filePath: string,
  opts: { keysOnly?: boolean } = {},
): ScanCandidate[] {
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.JSX;
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind,
  );

  const results: ScanCandidate[] = [];
  const seenPos = new Set<number>();

  function visit(node: ts.Node): void {
    // ── JsxText ──────────────────────────────────────────────────────────
    if (!opts.keysOnly && ts.isJsxText(node)) {
      const rawText = source.slice(node.pos, node.end);
      const trimmed = rawText.trim();
      if (isTranslatableText(trimmed) && !seenPos.has(node.pos)) {
        seenPos.add(node.pos);
        const k = slugify(trimmed);
        if (k) {
          results.push({
            file: filePath,
            line: posToLine(source, node.pos),
            text: trimmed,
            suggested_key: k,
            kind: "jsx_text",
          });
        }
      }
    }

    // ── JsxAttribute with StringLiteral value ────────────────────────────
    if (!opts.keysOnly && ts.isJsxAttribute(node)) {
      const attrName = node.name.getText(sourceFile).toLowerCase();
      if (TRANSLATABLE_ATTR_NAMES.has(attrName)) {
        const init = node.initializer;
        if (init && ts.isStringLiteral(init)) {
          const value = init.text;
          const start = init.getStart(sourceFile);
          if (isTranslatableText(value) && !seenPos.has(start)) {
            seenPos.add(start);
            results.push({
              file: filePath,
              line: posToLine(source, start),
              text: value,
              suggested_key: slugify(value),
              kind: "string_prop",
            });
          }
        }
      }
    }

    // ── t("key") calls ───────────────────────────────────────────────────
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "t" &&
      node.arguments.length === 1
    ) {
      const arg = node.arguments[0]!;
      if (ts.isStringLiteral(arg)) {
        const key = arg.text;
        const pos = node.getStart(sourceFile);
        if (!seenPos.has(pos)) {
          seenPos.add(pos);
          results.push({
            file: filePath,
            line: posToLine(source, pos),
            text: key,
            suggested_key: key,
            kind: "t_call",
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return results;
}

// ── public API ────────────────────────────────────────────────────────────────

export async function scanFiles(
  paths: string[],
  opts: { keysOnly?: boolean } = {},
): Promise<ScanCandidate[]> {
  const allFiles: string[] = [];
  for (const p of paths) await walkFiles(p, allFiles);

  const results: ScanCandidate[] = [];

  for (const file of allFiles) {
    const src = await readFile(file, "utf8").catch(() => "");
    if (!src) continue;
    results.push(...scanSource(src, file, opts));
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
