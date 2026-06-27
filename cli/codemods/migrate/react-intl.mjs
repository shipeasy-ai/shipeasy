/**
 * react-intl.mjs — Migration plugin for react-intl → @shipeasy/sdk i18n.t()
 *
 * Detects `import { FormattedMessage, useIntl } from 'react-intl'` and converts:
 *
 *   <FormattedMessage id="key" defaultMessage="text" />
 *     → {i18n.t('key', 'text')}
 *
 *   <FormattedMessage id="key" defaultMessage="text" values={{ name }} />
 *     → {i18n.t('key', 'text', { name })}
 *
 *   intl.formatMessage({ id: 'key', defaultMessage: 'text' })
 *     → i18n.t('key', 'text')
 *
 * Removes: import … from 'react-intl', useIntl() declarations
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
  if (t.isMemberExpression(node)) {
    const obj = nodeToSource(node.object);
    const prop = node.computed ? `[${nodeToSource(node.property)}]` : `.${node.property.name}`;
    return `${obj}${prop}`;
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
 * Extract properties from a Babel ObjectExpression node into an array of
 * [propName, propValueNode] pairs.
 */
function extractObjectProps(objNode) {
  const result = [];
  if (!t.isObjectExpression(objNode)) return result;
  for (const prop of objNode.properties) {
    if (!t.isObjectProperty(prop)) continue;
    const name = t.isIdentifier(prop.key)
      ? prop.key.name
      : t.isStringLiteral(prop.key)
        ? prop.key.value
        : null;
    if (name) result.push([name, prop.value]);
  }
  return result;
}

/**
 * Convert react-intl ICU interpolation syntax `{name}` to i18n `{{name}}`.
 */
function convertICU(message) {
  // Simple variable interpolation: {name} → {{name}}
  // Avoids converting plural/select syntax that contains commas
  return message.replace(/\{(\w+)\}/g, (match, varName) => `{{${varName}}}`);
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export default {
  name: "react-intl",
  description: "Migrate from react-intl to @shipeasy/sdk i18n.t()",

  detect(source) {
    return /\bfrom\s+['"]react-intl['"]/.test(source);
  },

  /**
   * react-intl translation files are typically JSON: { "key": "message" } or
   * nested: { "namespace": { "key": "message" } }.
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
        // Skip
      }
    }

    return translations;
  },

  removeImports: ["react-intl"],

  visitors(config, translations) {
    const trans = translations || {};

    // Track local names bound from useIntl(): const intl = useIntl()
    const intlBindings = new Set();

    return {
      /**
       * Track `const intl = useIntl()` and mark for removal.
       */
      VariableDeclarator(path) {
        const init = path.node.init;
        if (!t.isCallExpression(init)) return;
        if (!t.isIdentifier(init.callee, { name: "useIntl" })) return;

        const id = path.node.id;
        if (t.isIdentifier(id)) {
          intlBindings.add(id.name);
        }

        const declarationPath = path.parentPath;
        return {
          type: "remove",
          start: declarationPath.node.start,
          end: declarationPath.node.end,
        };
      },

      /**
       * Convert <FormattedMessage id="key" defaultMessage="text" /> and
       * <FormattedMessage id="key" defaultMessage="text" values={{ name }} />
       */
      JSXElement(path) {
        const opening = path.node.openingElement;
        if (!t.isJSXIdentifier(opening.name, { name: "FormattedMessage" })) return;

        let id = null;
        let defaultMessage = null;
        let valuesNode = null;

        for (const attr of opening.attributes) {
          if (!t.isJSXAttribute(attr)) continue;
          const attrName = t.isJSXIdentifier(attr.name) ? attr.name.name : null;
          if (!attrName) continue;

          if (attrName === "id") {
            if (t.isStringLiteral(attr.value)) id = attr.value.value;
          } else if (attrName === "defaultMessage") {
            if (t.isStringLiteral(attr.value)) defaultMessage = attr.value.value;
            // Also handle: defaultMessage={"text"}
            if (
              t.isJSXExpressionContainer(attr.value) &&
              t.isStringLiteral(attr.value.expression)
            ) {
              defaultMessage = attr.value.expression.value;
            }
          } else if (attrName === "values") {
            if (t.isJSXExpressionContainer(attr.value)) {
              valuesNode = attr.value.expression;
            }
          }
        }

        if (!id) return;

        const fallback = defaultMessage ? convertICU(defaultMessage) : lookup(trans, id);

        // Extract values as variable entries
        const varEntries = [];
        if (valuesNode && t.isObjectExpression(valuesNode)) {
          for (const [name, valueNode] of extractObjectProps(valuesNode)) {
            varEntries.push([name, nodeToSource(valueNode)]);
          }
        }

        return {
          type: "replace",
          start: path.node.start,
          end: path.node.end,
          replacement: `{${buildCall(id, fallback, varEntries)}}`,
        };
      },

      /**
       * Convert intl.formatMessage({ id: 'key', defaultMessage: 'text' })
       * and intl.formatMessage({ id: 'key', defaultMessage: 'text' }, { name })
       */
      CallExpression(path) {
        const callee = path.node.callee;
        if (!t.isMemberExpression(callee)) return;
        if (!t.isIdentifier(callee.property, { name: "formatMessage" })) return;

        // Check if the object is a known intl binding
        const objName = t.isIdentifier(callee.object) ? callee.object.name : null;
        if (!objName || !intlBindings.has(objName)) return;

        const args = path.node.arguments;
        if (args.length === 0 || !t.isObjectExpression(args[0])) return;

        // Extract id and defaultMessage from the descriptor object
        let id = null;
        let defaultMessage = null;
        for (const [name, valueNode] of extractObjectProps(args[0])) {
          if (name === "id" && t.isStringLiteral(valueNode)) {
            id = valueNode.value;
          } else if (name === "defaultMessage" && t.isStringLiteral(valueNode)) {
            defaultMessage = valueNode.value;
          }
        }

        if (!id) return;

        const fallback = defaultMessage ? convertICU(defaultMessage) : lookup(trans, id);

        // Second argument is the values object
        const varEntries = [];
        if (args.length >= 2 && t.isObjectExpression(args[1])) {
          for (const [name, valueNode] of extractObjectProps(args[1])) {
            varEntries.push([name, nodeToSource(valueNode)]);
          }
        }

        return {
          type: "replace",
          start: path.node.start,
          end: path.node.end,
          replacement: buildCall(id, fallback, varEntries),
        };
      },
    };
  },
};
