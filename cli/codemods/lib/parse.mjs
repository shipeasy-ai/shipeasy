/**
 * parse.mjs — Babel parse helper + AST predicate functions.
 *
 * Extracted from scripts/codemod-i18n.mjs for reuse across codemods.
 */

import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import * as t from "@babel/types";

const traverse = _traverse.default || _traverse;

// ── Babel parse helper ───────────────────────────────────────────────────

/**
 * Parse a source string into a Babel AST with JSX + TypeScript support.
 *
 * @param {string} source — file contents
 * @returns {import('@babel/types').File} — Babel AST
 */
export function parseFile(source) {
  return parse(source, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
    ranges: true,
  });
}

// ── AST context predicates ───────────────────────────────────────────────

/**
 * Returns true if `astPath` is inside a TypeScript type annotation, interface,
 * enum, type alias, or other type-only position.
 *
 * @param {import('@babel/traverse').NodePath} astPath
 * @returns {boolean}
 */
export function isInTypeContext(astPath) {
  let p = astPath;
  while (p) {
    if (
      p.isTSTypeAnnotation() ||
      p.isTSTypeAliasDeclaration() ||
      p.isTSInterfaceDeclaration() ||
      p.isTSEnumDeclaration() ||
      p.isTSLiteralType() ||
      p.isTSPropertySignature() ||
      p.isTSUnionType() ||
      p.isTSIntersectionType() ||
      p.isTSTypeParameterDeclaration() ||
      p.isTSTypeReference() ||
      p.isTSAsExpression() ||
      p.isTSSatisfiesExpression()
    )
      return true;
    p = p.parentPath;
  }
  return false;
}

/**
 * Returns true if `astPath` is a direct operand of `===`, `!==`, `==`, `!=`,
 * or the `test` of a `SwitchCase`.
 *
 * @param {import('@babel/traverse').NodePath} astPath
 * @returns {boolean}
 */
export function isInComparison(astPath) {
  const p = astPath.parentPath;
  if (!p) return false;
  if (p.isBinaryExpression()) {
    const op = p.node.operator;
    if (["===", "!==", "==", "!="].includes(op)) return true;
  }
  if (p.isSwitchCase() && astPath.key === "test") return true;
  return false;
}

// ── Skip-method sets ─────────────────────────────────────────────────────

/**
 * Method names on call expressions whose string arguments are patterns / selectors,
 * not user-visible text. The codemod skips string args to these methods.
 */
export const SKIP_CALL_METHODS = new Set([
  "includes",
  "indexOf",
  "lastIndexOf",
  "startsWith",
  "endsWith",
  "match",
  "matchAll",
  "replace",
  "replaceAll",
  "split",
  "search",
  "test",
  "exec",
  "localeCompare",
  "querySelector",
  "querySelectorAll",
  "getElementById",
  "getAttribute",
  "setAttribute",
  "hasAttribute",
  "addEventListener",
  "removeEventListener",
  "createElement",
  "join",
  "sort",
]);

/**
 * Console method names — string args to `console.<method>()` are debug output,
 * not user-visible text.
 */
export const CONSOLE_METHODS = new Set([
  "log",
  "warn",
  "error",
  "info",
  "debug",
  "trace",
  "assert",
  "table",
  "group",
  "groupEnd",
  "groupCollapsed",
  "time",
  "timeEnd",
  "timeLog",
  "count",
  "dir",
]);

// ── Re-exports ───────────────────────────────────────────────────────────

export { t, traverse };
