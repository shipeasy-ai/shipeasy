/**
 * keys.mjs — i18n key generation helpers.
 *
 * Extracted from scripts/codemod-i18n.mjs for reuse across codemods.
 */

import path from "node:path";

// ── Scope derivation ─────────────────────────────────────────────────────

/**
 * Derive an i18n key scope (dot-separated prefix) from a source file path.
 *
 * The scope is built from the path segments between `srcDir` and the file,
 * with container directories (pages, components, features) stripped out,
 * route-file prefixes cleaned, and the result capped at 3 segments.
 *
 * @param {string} filePath       — absolute path to the source file
 * @param {string} srcDir         — absolute path to the `src/` root
 * @param {Set<string>} [containerDirs] — directory names to strip (default: pages, components, features)
 * @returns {string} — dot-joined scope, e.g. `billing.invoiceTable`
 */
export function filePathToScope(filePath, srcDir, containerDirs) {
  const containers = containerDirs ?? new Set(["pages", "components", "features"]);

  let rel = path.relative(srcDir, filePath);
  rel = rel.replace(/\.(tsx?|jsx?)$/, "");
  rel = rel.replace(/\.react$/, "");

  let segs = rel.split(path.sep);

  // Strip empty / dot-prefixed segments. `path.relative` can yield "" for
  // leading separators on some inputs, and downstream `join(".")` would emit
  // `.....foo` keys. Also drop any segment that's only dots or whitespace.
  segs = segs.filter((s) => s && s.replace(/[.\s]/g, "").length > 0);

  // Next.js App Router conventions:
  //   `(group)`  → route group, organisational only — drop entirely.
  //   `[param]`  → dynamic segment — drop the brackets but keep the param name.
  //   `@slot`    → parallel route — drop the @ prefix.
  segs = segs
    .filter((s) => !/^\(.+\)$/.test(s))
    .map((s) => s.replace(/^\[\.{3}(.+)\]$/, "$1").replace(/^\[(.+)\]$/, "$1"))
    .map((s) => s.replace(/^@/, ""));

  // Route files: _private.billing.invoices -> billing.invoices
  if (segs[0] === "routes") {
    const routeFile = segs[segs.length - 1];
    const parts = routeFile.split(".").filter((p) => !p.startsWith("_"));
    segs = ["routes", ...parts];
  }

  // Remove container dirs
  segs = segs.filter((s) => !containers.has(s));

  // Remove index filename
  if (segs[segs.length - 1] === "index") segs.pop();

  // CamelCase each segment
  segs = segs.map((s) => {
    // Handle acronym prefixes: DSForm -> dsForm, APISurface -> apiSurface
    const acronymMatch = s.match(/^([A-Z]+)([a-z].*)/);
    if (acronymMatch) {
      const [, prefix, rest] = acronymMatch;
      s =
        prefix.length === 1
          ? prefix.toLowerCase() + rest
          : prefix.slice(0, -1).toLowerCase() + prefix.slice(-1) + rest;
    } else if (/^[A-Z]/.test(s)) {
      s = s[0].toLowerCase() + s.slice(1);
    }
    return s.replace(/[-_](.)/g, (_, c) => c.toUpperCase());
  });

  // Collapse if too deep (scope should be <= 3 to leave room for subKey)
  if (segs.length > 3) segs = [segs[0], ...segs.slice(-2)];

  // Dedupe adjacent
  segs = segs.filter((s, i) => i === 0 || s !== segs[i - 1]);

  return segs.join(".") || "app";
}

// ── Sub-key generation ───────────────────────────────────────────────────

/**
 * Derive a camelCase sub-key from a translatable string's content.
 *
 * Takes up to 5 words from the cleaned string. When `propName` is a
 * non-default prop (not label/title/children/text), it's appended as a suffix.
 *
 * @param {string} str      — the translatable string
 * @param {string} [propName] — JSX attribute or object-property name, if any
 * @returns {string} — e.g. `saveChanges`, `enterEmailPlaceholder`
 */
export function stringToSubKey(str, propName) {
  let clean = str
    .replace(/\{\{(\w+)\}\}/g, "$1")
    .replace(/[''`]/g, "")
    .replace(/[^\w\s]/g, "")
    .trim();

  const words = clean.split(/\s+/).filter(Boolean).slice(0, 5);
  if (!words.length) return "text";

  let sub = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join("");

  // Add prop suffix for non-default props
  if (propName && !["label", "title", "children", "text"].includes(propName)) {
    sub += propName[0].toUpperCase() + propName.slice(1);
  }

  // Cap length
  if (sub.length > 40) sub = sub.slice(0, 40);

  return sub;
}

// ── Common-key generation ────────────────────────────────────────────────

/**
 * Build a `common.<subKey>` key from a string's content.
 *
 * @param {string} str — the translatable string
 * @returns {string} — e.g. `common.saveChanges`
 */
export function commonKeyFromString(str) {
  const sub = stringToSubKey(str);
  return `common.${sub}`;
}
