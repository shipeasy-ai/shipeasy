/**
 * thunk.mjs — Turn a module-scope constant that holds copy into a getter.
 *
 * A string evaluated at import time can't be translated: `t()` runs before the
 * loader has fetched anything, and the result is frozen. The fix the i18n docs
 * prescribe is a thunk, resolved during render:
 *
 *   const NAV = [{ label: "Docs" }];         // frozen
 *   const NAV = () => [{ label: "Docs" }];   // read as NAV() inside a component
 *
 * `planThunks` finds the top-level `const` declarations that contain module-scope
 * extractions and can be rewritten safely, and returns the text edits. Anything
 * it can't prove safe is left alone (and its strings stay skipped):
 *
 *   - not a plain `const X = …` (destructuring, let/var), or already a function
 *   - exported — callers in other files would need `X()` too
 *   - any reference that isn't inside a function/class body, so would run at
 *     import time anyway
 *   - any reference that isn't a plain read (`X = …`, `X++`, `<X/>`, `typeof X`)
 *   - any reference inside a hook dependency array — `X()` is a new value every
 *     render, so the effect would re-run every render
 */

import { t, traverse } from "./parse.mjs";

const HOOK_RE = /^use[A-Z]/;

function insideBody(p) {
  return Boolean(p.findParent((a) => a.isFunction() || a.isClass()));
}

function inHookDeps(p) {
  const arr = p.findParent((a) => a.isArrayExpression());
  if (!arr || !arr.parentPath?.isCallExpression()) return false;
  const call = arr.parentPath.node;
  if (call.arguments[1] !== arr.node) return false;
  const callee = call.callee;
  const name = t.isIdentifier(callee)
    ? callee.name
    : t.isMemberExpression(callee) && t.isIdentifier(callee.property)
      ? callee.property.name
      : null;
  return Boolean(name && HOOK_RE.test(name));
}

/**
 * @param {import('@babel/types').File} ast
 * @param {string} source
 * @param {Array<{start: number, end: number}>} moduleExtractions — extractions
 *   that sit outside every function/class body
 * @returns {{ edits: Array<{start: number, end: number, newText: string}>,
 *             kept: Set<object> }} — `kept` holds the extractions now inside a
 *   thunk (safe to wrap)
 */
export function planThunks(ast, source, moduleExtractions) {
  const edits = [];
  const kept = new Set();
  if (!moduleExtractions.length) return { edits, kept };

  let program = null;
  traverse(ast, {
    Program(p) {
      program = p;
      p.stop();
    },
  });
  if (!program) return { edits, kept };

  for (const stmt of program.get("body")) {
    // `export const X` is exported by definition — skip it outright.
    if (!stmt.isVariableDeclaration() || stmt.node.kind !== "const") continue;

    for (const decl of stmt.get("declarations")) {
      const { id, init } = decl.node;
      if (!t.isIdentifier(id) || !init) continue;
      if (t.isFunction(init)) continue;

      const mine = moduleExtractions.filter((e) => e.start >= init.start && e.end <= init.end);
      if (!mine.length) continue;

      const binding = program.scope.getBinding(id.name);
      if (!binding || !binding.constant) continue;
      const refs = binding.referencePaths;
      if (!refs.length) continue;

      // `typeof X` in a type position isn't in referencePaths — look for it in the text.
      if (new RegExp(`\\btypeof\\s+${id.name}\\b`).test(source)) continue;

      const safe = refs.every((r) => {
        if (!r.isIdentifier()) return false;
        if (r.parentPath.isExportSpecifier()) return false;
        if (!insideBody(r)) return false;
        if (inHookDeps(r)) return false;
        return true;
      });
      if (!safe) continue;

      // `const X: T = …` → `const X = (): T => (…)`
      let head = "() => (";
      if (id.typeAnnotation) {
        const ta = id.typeAnnotation;
        head = `(): ${source.slice(ta.typeAnnotation.start, ta.typeAnnotation.end)} => (`;
        edits.push({ start: ta.start, end: ta.end, newText: "" });
      }
      edits.push({ start: init.start, end: init.start, newText: head });
      edits.push({ start: init.end, end: init.end, newText: ")" });

      for (const r of refs) {
        const parent = r.parentPath;
        if (parent.isObjectProperty() && parent.node.shorthand && parent.node.value === r.node) {
          edits.push({ start: r.node.start, end: r.node.end, newText: `${id.name}: ${id.name}()` });
        } else {
          edits.push({ start: r.node.start, end: r.node.end, newText: `${id.name}()` });
        }
      }
      for (const e of mine) kept.add(e);
    }
  }

  return { edits, kept };
}
