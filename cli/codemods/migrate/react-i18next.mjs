/**
 * react-i18next.mjs — Migration plugin for react-i18next → @shipeasy/sdk i18n.t()
 *
 * Detects `import { useTranslation } from 'react-i18next'` or
 * `import { Trans } from 'react-i18next'` and converts:
 *
 *   t('key')                          → i18n.t('key', translations['key'] ?? 'key')
 *   t('key', { defaultValue: '…' })   → i18n.t('key', '…')
 *   t('key', { count: n })            → i18n.t('key', translations['key'], { count: n })
 *   <Trans i18nKey="key">fallback</Trans> → {i18n.t('key', 'fallback')}
 *
 * Removes: import … from 'react-i18next', useTranslation() declarations
 */

import fs from "node:fs";
import { t } from "../lib/parse.mjs";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Escape a string for use inside a single-quoted JS string literal. */
function esc(str) {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/** Look up a translation value, falling back to the key itself. */
function lookup(translations, key) {
  if (translations && key in translations) return translations[key];
  return key;
}

/**
 * Collect the raw text content of JSX children (strings and expressions flattened).
 * Used to extract fallback text from <Trans> children.
 */
function extractJSXChildrenText(children) {
  const parts = [];
  for (const child of children) {
    if (t.isJSXText(child)) {
      const text = child.value.trim();
      if (text) parts.push(text);
    } else if (t.isJSXExpressionContainer(child)) {
      if (t.isStringLiteral(child.expression)) {
        parts.push(child.expression.value);
      } else if (t.isIdentifier(child.expression)) {
        parts.push(`{{${child.expression.name}}}`);
      } else if (
        t.isMemberExpression(child.expression) &&
        t.isIdentifier(child.expression.property)
      ) {
        parts.push(`{{${child.expression.property.name}}}`);
      }
    } else if (t.isJSXElement(child)) {
      const inner = extractJSXChildrenText(child.children);
      if (inner) parts.push(inner);
    }
  }
  return parts.join(" ");
}

/**
 * Reconstruct a source-code snippet for a Babel AST node.
 * Used to serialize variable values in the replacement output.
 */
function nodeToSource(node) {
  if (t.isIdentifier(node)) return node.name;
  if (t.isNumericLiteral(node)) return String(node.value);
  if (t.isStringLiteral(node)) return `'${esc(node.value)}'`;
  if (t.isBooleanLiteral(node)) return String(node.value);
  if (t.isNullLiteral(node)) return "null";
  if (t.isMemberExpression(node)) {
    const obj = nodeToSource(node.object);
    const prop = node.computed ? `[${nodeToSource(node.property)}]` : `.${node.property.name}`;
    return `${obj}${prop}`;
  }
  // Fallback: not perfectly reconstructable — return placeholder
  return "/* … */";
}

/**
 * Build an i18n.t() call string.
 */
function buildCall(key, fallback, varEntries) {
  let call = `i18n.t('${esc(key)}', '${esc(fallback)}'`;
  if (varEntries && varEntries.length > 0) {
    const props = varEntries.map(([name, src]) => (name === src ? name : `${name}: ${src}`));
    call += `, { ${props.join(", ")} }`;
  }
  call += ")";
  return call;
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export default {
  name: "react-i18next",
  description: "Migrate from react-i18next to @shipeasy/sdk i18n.t()",

  /**
   * Returns true if the source file imports from 'react-i18next'.
   */
  detect(source) {
    return /\bfrom\s+['"]react-i18next['"]/.test(source);
  },

  /**
   * Read existing translation JSON files and return a flat Record<key, value>.
   * react-i18next typically uses nested JSON: { "ns": { "key": "value" } }.
   * We flatten to dot-separated keys.
   */
  loadTranslations(translationFilePaths) {
    const translations = {};

    function flatten(obj, prefix) {
      for (const [k, v] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${k}` : k;
        if (typeof v === "string") {
          translations[fullKey] = v;
        } else if (v && typeof v === "object") {
          flatten(v, fullKey);
        }
      }
    }

    for (const filePath of translationFilePaths) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        flatten(data, "");
      } catch {
        // Skip unreadable/invalid files
      }
    }

    return translations;
  },

  removeImports: ["react-i18next"],

  /**
   * Return Babel AST visitors that find react-i18next usage and return extractions.
   *
   * Each visitor method receives a Babel NodePath and should return an extraction
   * object ({ type, start, end, replacement }) or nothing to skip.
   *
   * @param {object} config — codemod configuration
   * @param {Record<string, string>} translations — flat key→value map
   * @returns {object} — Babel visitor map
   */
  visitors(config, translations) {
    const trans = translations || {};

    // Track `t` binding names and their namespaces from useTranslation() calls.
    // Maps local binding name → namespace string ('' for default).
    const tBindings = new Map();

    return {
      /**
       * Track `const { t } = useTranslation()` / `useTranslation('ns')`.
       * Mark the entire variable declaration for removal.
       */
      VariableDeclarator(path) {
        const init = path.node.init;
        if (!t.isCallExpression(init)) return;
        if (!t.isIdentifier(init.callee, { name: "useTranslation" })) return;

        // Extract namespace: useTranslation('myNamespace')
        let namespace = "";
        if (init.arguments.length > 0 && t.isStringLiteral(init.arguments[0])) {
          namespace = init.arguments[0].value;
        }

        // Extract destructured `t` binding: const { t } = …
        const id = path.node.id;
        if (t.isObjectPattern(id)) {
          for (const prop of id.properties) {
            if (t.isObjectProperty(prop) && t.isIdentifier(prop.key, { name: "t" })) {
              const localName = t.isIdentifier(prop.value) ? prop.value.name : "t";
              tBindings.set(localName, namespace);
            }
          }
        }

        // Also handle: const t = useTranslation().t (less common)
        if (t.isIdentifier(id)) {
          tBindings.set(id.name, namespace);
        }

        // Return removal extraction for the entire declaration statement
        const declarationPath = path.parentPath;
        return {
          type: "remove",
          start: declarationPath.node.start,
          end: declarationPath.node.end,
        };
      },

      /**
       * Convert t('key') and t('key', { defaultValue, count, … }) calls.
       */
      CallExpression(path) {
        const callee = path.node.callee;
        if (!t.isIdentifier(callee)) return;
        if (!tBindings.has(callee.name)) return;

        const namespace = tBindings.get(callee.name);
        const args = path.node.arguments;

        if (args.length === 0) return;
        if (!t.isStringLiteral(args[0])) return;

        const rawKey = args[0].value;
        const fullKey = namespace ? `${namespace}.${rawKey}` : rawKey;

        let fallback = null;
        const varEntries = []; // [name, sourceCode][]

        // Parse second argument: t('key', { defaultValue, count, name, … })
        if (args.length >= 2 && t.isObjectExpression(args[1])) {
          for (const prop of args[1].properties) {
            if (t.isSpreadElement(prop)) continue;
            if (!t.isObjectProperty(prop)) continue;

            const propName = t.isIdentifier(prop.key)
              ? prop.key.name
              : t.isStringLiteral(prop.key)
                ? prop.key.value
                : null;
            if (!propName) continue;

            if (propName === "defaultValue") {
              if (t.isStringLiteral(prop.value)) {
                fallback = prop.value.value;
              }
            } else {
              // Everything else (count, name, etc.) becomes an interpolation variable
              const src = nodeToSource(prop.value);
              varEntries.push([propName, src]);
            }
          }
        }

        if (fallback == null) {
          fallback = lookup(trans, fullKey);
        }

        const replacement = buildCall(fullKey, fallback, varEntries);

        return {
          type: "replace",
          start: path.node.start,
          end: path.node.end,
          replacement,
        };
      },

      /**
       * Convert <Trans i18nKey="key">fallback</Trans> → {i18n.t('key', 'fallback')}
       */
      JSXElement(path) {
        const opening = path.node.openingElement;
        if (!t.isJSXIdentifier(opening.name, { name: "Trans" })) return;

        // Find i18nKey attribute
        let i18nKey = null;
        for (const attr of opening.attributes) {
          if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name, { name: "i18nKey" })) {
            if (t.isStringLiteral(attr.value)) {
              i18nKey = attr.value.value;
            }
          }
        }

        if (!i18nKey) return;

        // Extract fallback text from children
        const childText = extractJSXChildrenText(path.node.children);
        const fallback = childText || lookup(trans, i18nKey);

        return {
          type: "replace",
          start: path.node.start,
          end: path.node.end,
          replacement: `{${buildCall(i18nKey, fallback, null)}}`,
        };
      },
    };
  },
};
