/**
 * strings.mjs — String classification and source-code escaping.
 *
 * Extracted from scripts/codemod-i18n.mjs for reuse across codemods.
 */

// ── Translatable / skip attribute sets ────────────────────────────────────

/**
 * JSX attribute names (and object property keys) whose string values are
 * considered user-visible and should be translated.
 */
export const TRANSLATABLE_ATTRS = new Set([
  "label",
  "title",
  "description",
  "placeholder",
  "helperText",
  "hint",
  "tooltip",
  "alt",
  "saveLabel",
  "cancelLabel",
  "cleanLabel",
  "dirtyLabel",
  "confirmLabel",
  "heading",
  "subheading",
  "subtitle",
  "navHelp",
  "actionName",
  "aria-label",
  "emptyTitle",
  "emptyDescription",
  "successMessage",
  "errorMessage",
  "illustration",
]);

/**
 * JSX attribute names whose values are never user-visible text (code tokens,
 * CSS classes, identifiers, etc.). These are skipped unconditionally.
 */
export const SKIP_ATTRS = new Set([
  "className",
  "name",
  "key",
  "id",
  "to",
  "href",
  "src",
  "type",
  "variant",
  "size",
  "color",
  "icon",
  "value",
  "defaultValue",
  "as",
  "role",
  "tabIndex",
  "slot",
  "ref",
  "style",
  "htmlFor",
  "data-testid",
  "data-label",
  "data-variables",
  "data-state",
  "method",
  "action",
  "target",
  "rel",
  "media",
  "dir",
  "lang",
  "autoComplete",
  "inputMode",
  "pattern",
  "accept",
  "encType",
  "span",
  "colSpan",
  "rowSpan",
  "width",
  "height",
  "mode",
  "trigger",
  "side",
  "align",
  "orientation",
  "direction",
  "position",
  "connection",
  "edgeTypeName",
  "format",
  "mask",
  "prefix",
  "suffix",
  "delimiter",
  "step",
  "min",
  "max",
  "rows",
  "cols",
  "maxLength",
  "minLength",
]);

// ── Short translatable strings ───────────────────────────────────────────

/**
 * Strings of 3 characters or fewer (no spaces) that are still user-visible
 * and should be translated. Everything else that short is assumed to be a
 * code token.
 */
export const SHORT_TRANSLATABLE = new Set([
  "Yes",
  "No",
  "OK",
  "Add",
  "All",
  "New",
  "Off",
  "On",
  "Or",
  "or",
  "DOB",
  "MRN",
  "N/A",
  "Age",
  "Fax",
  "Tax",
  "Due",
]);

// ── Translatable-string detection ────────────────────────────────────────

/**
 * Returns `true` when `str` looks like user-visible text that should be
 * internationalized, `false` when it looks like a code identifier, CSS class,
 * URL, color hex, MIME type, or other non-translatable token.
 *
 * @param {string} str — the raw string value (will be trimmed internally)
 * @returns {boolean}
 */
export function isTranslatableString(str) {
  const s = str.trim();
  if (!s || s.length < 2) return false;
  if (!/[a-zA-Z]/.test(s)) return false;

  // Short strings without spaces — only from known-good list
  if (s.length <= 3 && !/\s/.test(s)) {
    return SHORT_TRANSLATABLE.has(s);
  }

  // Pattern-based skips
  if (/^[a-z]+(-[a-z]+)*$/.test(s) && s.length < 25) return false; // kebab-case
  if (/^[a-z][a-zA-Z0-9]+$/.test(s) && !/\s/.test(s)) return false; // camelCase
  if (/^[A-Z][a-z]+([A-Z][a-z]+)+$/.test(s)) return false; // PascalCase multi-hump
  if (/^[A-Z][A-Z0-9_]+$/.test(s)) return false; // UPPER_CASE
  if (/^[a-z][a-z0-9_]+$/.test(s) && s.length < 25) return false; // snake_case
  if (/^(https?:|\/|\.\/|\.\.\/)/.test(s)) return false; // URL / path
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return false; // color hex
  if (/^(rgb|hsl|var\(|calc\()/.test(s)) return false; // CSS function
  if (/^\d+(\.\d+)?(px|rem|em|%|vh|vw|s|ms)?$/.test(s)) return false; // number+unit
  if (/^(application|text|image|audio|video|font)\//.test(s)) return false; // MIME
  if (/^\.\w{1,5}$/.test(s)) return false; // extension
  if (/^\d{4}-\d{2}(-\d{2})?/.test(s)) return false; // ISO date
  if (/^(query|mutation|subscription|fragment)\s/.test(s)) return false; // GraphQL
  if (/^data-/.test(s)) return false; // data attribute
  if (/^[a-z]+-[\d.]+$/.test(s)) return false; // CSS utility: mt-3, p-4, w-1.5
  if (/^[a-z]+-[a-z]+-[\d.]+$/.test(s)) return false; // CSS compound: gap-x-4, space-y-2

  // Tailwind/CSS class-like strings: space-separated tokens mostly with dashes/dots
  if (/\s/.test(s)) {
    const words = s.split(/\s+/);
    if (
      words.length >= 2 &&
      words.every((w) => /^[!]?[a-z\d][\w.\-/[\]():%]*$/.test(w)) &&
      words.some((w) => /[-.]/.test(w))
    ) {
      return false;
    }
  }

  return true;
}

// ── Source-code string escaping ──────────────────────────────────────────

/**
 * Escape a string for embedding as a source-code string literal.
 * Chooses single or double quotes to minimise internal escaping.
 *
 * @param {string} str — raw string value
 * @returns {string} — quoted source-code literal (e.g. `'hello'` or `"it's"`)
 */
export function toSourceString(str) {
  const escaped = str
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\0/g, "\\0");

  const hasSingle = escaped.includes("'");
  const hasDouble = escaped.includes('"');
  if (hasSingle && !hasDouble) return `"${escaped}"`;
  if (hasSingle) return `'${escaped.replace(/'/g, "\\'")}'`;
  return `'${escaped}'`;
}
