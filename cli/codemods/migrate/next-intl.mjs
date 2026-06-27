/**
 * next-intl.mjs — Migration plugin for next-intl → @shipeasy/sdk i18n.t()
 *
 * Detects `import { useTranslations } from 'next-intl'` and converts:
 *
 *   const t = useTranslations('namespace')
 *   t('key')              → i18n.t('namespace.key', translations['namespace.key'])
 *   t('key', { name })    → i18n.t('namespace.key', translations['namespace.key'], { name })
 *   t.rich('key', { … })  → i18n.rich('namespace.key', translations['namespace.key'], { … })
 *
 * Removes: import … from 'next-intl', useTranslations() declarations
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
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return `'${esc(node.quasis[0].value.cooked)}'`;
  }
  if (t.isArrowFunctionExpression(node)) {
    const params = node.params.map((p) => nodeToSource(p)).join(", ");
    const body = t.isBlockStatement(node.body) ? "{ /* … */ }" : nodeToSource(node.body);
    return `(${params}) => ${body}`;
  }
  if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
    const args = node.arguments.map((a) => nodeToSource(a)).join(", ");
    return `${node.callee.name}(${args})`;
  }
  if (t.isJSXElement(node)) {
    const name = t.isJSXIdentifier(node.openingElement.name) ? node.openingElement.name.name : "?";
    return `<${name} />`;
  }
  return "/* … */";
}

/**
 * Build an i18n.t() or i18n.rich() call string.
 */
function buildCall(method, key, fallback, varEntries) {
  let call = `i18n.${method}('${esc(key)}', '${esc(fallback)}'`;
  if (varEntries && varEntries.length > 0) {
    const props = varEntries.map(([name, src]) => (name === src ? name : `${name}: ${src}`));
    call += `, { ${props.join(", ")} }`;
  }
  call += ")";
  return call;
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export default {
  name: "next-intl",
  description: "Migrate from next-intl to @shipeasy/sdk i18n.t()",

  detect(source) {
    return /\bfrom\s+['"]next-intl['"]/.test(source);
  },

  /**
   * next-intl uses nested JSON: { "namespace": { "key": "value" } }.
   * Flatten to dot-separated keys.
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

  removeImports: ["next-intl"],

  visitors(config, translations) {
    const trans = translations || {};

    // Track useTranslations() bindings: local name → namespace
    // e.g. const t = useTranslations('Dashboard') → tBindings.set('t', 'Dashboard')
    const tBindings = new Map();

    return {
      /**
       * Track `const t = useTranslations('namespace')` and mark for removal.
       */
      VariableDeclarator(path) {
        const init = path.node.init;
        if (!t.isCallExpression(init)) return;
        if (!t.isIdentifier(init.callee, { name: "useTranslations" })) return;

        // Extract namespace (required in next-intl, optional in theory)
        let namespace = "";
        if (init.arguments.length > 0 && t.isStringLiteral(init.arguments[0])) {
          namespace = init.arguments[0].value;
        }

        const id = path.node.id;
        if (t.isIdentifier(id)) {
          tBindings.set(id.name, namespace);
        }

        const declarationPath = path.parentPath;
        return {
          type: "remove",
          start: declarationPath.node.start,
          end: declarationPath.node.end,
        };
      },

      /**
       * Convert t('key') and t('key', { name }) calls.
       * Also handles nested keys: t('section.key') → i18n.t('namespace.section.key', …)
       */
      CallExpression(path) {
        const callee = path.node.callee;

        // ── t('key') or t('key', { vars })
        if (t.isIdentifier(callee) && tBindings.has(callee.name)) {
          const namespace = tBindings.get(callee.name);
          const args = path.node.arguments;

          if (args.length === 0) return;
          if (!t.isStringLiteral(args[0])) return;

          const rawKey = args[0].value;
          const fullKey = namespace ? `${namespace}.${rawKey}` : rawKey;
          const fallback = lookup(trans, fullKey);

          const varEntries = [];
          if (args.length >= 2 && t.isObjectExpression(args[1])) {
            for (const prop of args[1].properties) {
              if (!t.isObjectProperty(prop)) continue;
              const propName = t.isIdentifier(prop.key)
                ? prop.key.name
                : t.isStringLiteral(prop.key)
                  ? prop.key.value
                  : null;
              if (!propName) continue;
              varEntries.push([propName, nodeToSource(prop.value)]);
            }
          }

          return {
            type: "replace",
            start: path.node.start,
            end: path.node.end,
            replacement: buildCall("t", fullKey, fallback, varEntries),
          };
        }

        // ── t.rich('key', { bold: (chunks) => <strong>{chunks}</strong>, … })
        if (
          t.isMemberExpression(callee) &&
          t.isIdentifier(callee.object) &&
          tBindings.has(callee.object.name) &&
          t.isIdentifier(callee.property, { name: "rich" })
        ) {
          const namespace = tBindings.get(callee.object.name);
          const args = path.node.arguments;

          if (args.length === 0) return;
          if (!t.isStringLiteral(args[0])) return;

          const rawKey = args[0].value;
          const fullKey = namespace ? `${namespace}.${rawKey}` : rawKey;
          const fallback = lookup(trans, fullKey);

          const varEntries = [];
          if (args.length >= 2 && t.isObjectExpression(args[1])) {
            for (const prop of args[1].properties) {
              if (!t.isObjectProperty(prop)) continue;
              const propName = t.isIdentifier(prop.key)
                ? prop.key.name
                : t.isStringLiteral(prop.key)
                  ? prop.key.value
                  : null;
              if (!propName) continue;
              varEntries.push([propName, nodeToSource(prop.value)]);
            }
          }

          return {
            type: "replace",
            start: path.node.start,
            end: path.node.end,
            replacement: buildCall("rich", fullKey, fallback, varEntries),
          };
        }

        // ── t.raw('key') → i18n.t('namespace.key', translations['namespace.key'])
        if (
          t.isMemberExpression(callee) &&
          t.isIdentifier(callee.object) &&
          tBindings.has(callee.object.name) &&
          t.isIdentifier(callee.property, { name: "raw" })
        ) {
          const namespace = tBindings.get(callee.object.name);
          const args = path.node.arguments;

          if (args.length === 0) return;
          if (!t.isStringLiteral(args[0])) return;

          const rawKey = args[0].value;
          const fullKey = namespace ? `${namespace}.${rawKey}` : rawKey;
          const fallback = lookup(trans, fullKey);

          return {
            type: "replace",
            start: path.node.start,
            end: path.node.end,
            replacement: buildCall("t", fullKey, fallback, null),
          };
        }

        // ── t.has('key') → check existence — replace with a boolean lookup
        if (
          t.isMemberExpression(callee) &&
          t.isIdentifier(callee.object) &&
          tBindings.has(callee.object.name) &&
          t.isIdentifier(callee.property, { name: "has" })
        ) {
          const namespace = tBindings.get(callee.object.name);
          const args = path.node.arguments;

          if (args.length === 0) return;
          if (!t.isStringLiteral(args[0])) return;

          const rawKey = args[0].value;
          const fullKey = namespace ? `${namespace}.${rawKey}` : rawKey;

          // t.has() returns boolean — no direct equivalent, so we emit a comment
          return {
            type: "replace",
            start: path.node.start,
            end: path.node.end,
            replacement: `/* TODO: i18n.has() not supported — was t.has('${esc(fullKey)}') */ true`,
          };
        }
      },
    };
  },
};
