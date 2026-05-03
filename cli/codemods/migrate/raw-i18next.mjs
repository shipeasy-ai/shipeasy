/**
 * raw-i18next.mjs — Migration plugin for i18next (non-React) → @shipeasy/sdk i18n.t()
 *
 * Detects `import i18next from 'i18next'` or `import { t } from 'i18next'`
 * and converts:
 *
 *   i18next.t('key')                        → i18n.t('key', translations['key'])
 *   i18next.t('key', { defaultValue: '…' }) → i18n.t('key', '…')
 *   t('key')  (where t is from i18next)     → i18n.t('key', translations['key'])
 *
 * Also handles:
 *   i18next.t('ns:key')                     → i18n.t('ns.key', translations['ns.key'])
 *   i18next.t('key', { count: n, name })    → i18n.t('key', translations['key'], { count: n, name })
 *   i18next.exists('key')                   → true (with TODO comment)
 *
 * Removes: import … from 'i18next'
 */

import fs from "node:fs";
import { t } from "../lib/parse.mjs";

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(str) {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

function lookup(translations, key) {
  if (translations && key in translations) return translations[key];
  return key;
}

function nodeToSource(node) {
  if (t.isIdentifier(node)) return node.name;
  if (t.isNumericLiteral(node)) return String(node.value);
  if (t.isStringLiteral(node)) return `'${esc(node.value)}'`;
  if (t.isBooleanLiteral(node)) return String(node.value);
  if (t.isNullLiteral(node)) return "null";
  if (t.isUnaryExpression(node) && node.operator === "-" && t.isNumericLiteral(node.argument)) {
    return `-${node.argument.value}`;
  }
  if (t.isMemberExpression(node)) {
    const obj = nodeToSource(node.object);
    const prop = node.computed ? `[${nodeToSource(node.property)}]` : `.${node.property.name}`;
    return `${obj}${prop}`;
  }
  if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
    const args = node.arguments.map((a) => nodeToSource(a)).join(", ");
    return `${node.callee.name}(${args})`;
  }
  return "/* … */";
}

function buildCall(key, fallback, varEntries) {
  let call = `i18n.t('${esc(key)}', '${esc(fallback)}'`;
  if (varEntries && varEntries.length > 0) {
    const props = varEntries.map(([name, src]) => (name === src ? name : `${name}: ${src}`));
    call += `, { ${props.join(", ")} }`;
  }
  call += ")";
  return call;
}

/**
 * Normalize an i18next key: convert namespace separator `:` to `.`.
 * e.g. 'common:greeting' → 'common.greeting'
 */
function normalizeKey(key) {
  return key.replace(/:/g, ".");
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export default {
  name: "raw-i18next",
  description: "Migrate from i18next to @shipeasy/sdk i18n.t()",

  detect(source) {
    return /\bfrom\s+['"]i18next['"]/.test(source);
  },

  /**
   * i18next uses the same JSON format as react-i18next: nested or namespaced.
   * Files can also be organized by namespace (e.g. common.json, dashboard.json).
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

        // If filename looks like a namespace, use it as prefix
        const match = filePath.match(/([^/\\]+)\.json$/);
        const namespace = match && match[1] !== "en" && match[1] !== "translation" ? match[1] : "";

        flatten(data, namespace);
      } catch {
        // Skip
      }
    }

    return translations;
  },

  removeImports: ["i18next"],

  visitors(config, translations) {
    const trans = translations || {};

    // Track default-import binding: import i18next from 'i18next'
    const defaultBindings = new Set();
    // Track named `t` binding: import { t } from 'i18next'
    const tBindings = new Set();

    return {
      /**
       * Scan imports to identify local binding names.
       */
      ImportDeclaration(path) {
        if (path.node.source.value !== "i18next") return;

        for (const spec of path.node.specifiers) {
          if (t.isImportDefaultSpecifier(spec)) {
            defaultBindings.add(spec.local.name);
          }
          if (t.isImportSpecifier(spec)) {
            const imported = t.isIdentifier(spec.imported)
              ? spec.imported.name
              : spec.imported.value;
            if (imported === "t") {
              tBindings.add(spec.local.name);
            }
            // Also track the default export re-exported as named
            if (imported === "default") {
              defaultBindings.add(spec.local.name);
            }
          }
          // import * as i18next from 'i18next'
          if (t.isImportNamespaceSpecifier(spec)) {
            defaultBindings.add(spec.local.name);
          }
        }
        // Don't return removal — `removeImports` handles it.
      },

      /**
       * Convert i18next.t('key', …) and standalone t('key', …) calls.
       * Also handles i18next.exists('key').
       */
      CallExpression(path) {
        const callee = path.node.callee;
        const args = path.node.arguments;

        // ── i18next.t('key', …) or i18next.exists('key')
        if (t.isMemberExpression(callee) && t.isIdentifier(callee.object)) {
          const objName = callee.object.name;
          if (!defaultBindings.has(objName)) return;

          const methodName = t.isIdentifier(callee.property) ? callee.property.name : null;

          // i18next.exists('key') → /* TODO */ true
          if (methodName === "exists") {
            if (args.length > 0 && t.isStringLiteral(args[0])) {
              const key = normalizeKey(args[0].value);
              return {
                type: "replace",
                start: path.node.start,
                end: path.node.end,
                replacement: `/* TODO: i18n.exists() not supported — was ${objName}.exists('${esc(key)}') */ true`,
              };
            }
            return;
          }

          if (methodName !== "t") return;
          return processTranslationCall(path, args, trans);
        }

        // ── t('key', …) where t is imported from 'i18next'
        if (t.isIdentifier(callee) && tBindings.has(callee.name)) {
          return processTranslationCall(path, args, trans);
        }
      },
    };
  },
};

/**
 * Process a t('key', options?) call and return an extraction.
 */
function processTranslationCall(path, args, trans) {
  if (args.length === 0) return;
  if (!t.isStringLiteral(args[0])) return;

  const rawKey = args[0].value;
  const key = normalizeKey(rawKey);

  let fallback = null;
  const varEntries = [];

  // Parse options object: t('key', { defaultValue, count, name, … })
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
      } else if (
        propName === "ns" ||
        propName === "lng" ||
        propName === "lngs" ||
        propName === "fallbackLng" ||
        propName === "keySeparator" ||
        propName === "nsSeparator" ||
        propName === "returnObjects" ||
        propName === "joinArrays" ||
        propName === "postProcess" ||
        propName === "interpolation" ||
        propName === "context"
      ) {
        // Skip i18next-specific options that don't map to interpolation vars
      } else {
        // Interpolation variable (count, name, etc.)
        varEntries.push([propName, nodeToSource(prop.value)]);
      }
    }
  }

  // t('key', 'default value') — second arg is a string (shorthand for defaultValue)
  if (args.length >= 2 && t.isStringLiteral(args[1])) {
    fallback = args[1].value;
  }

  if (fallback == null) {
    fallback = lookup(trans, key);
  }

  return {
    type: "replace",
    start: path.node.start,
    end: path.node.end,
    replacement: buildCall(key, fallback, varEntries),
  };
}
