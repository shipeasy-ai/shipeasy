/**
 * lingui.mjs — Migration plugin for @lingui/macro + @lingui/core → @shipeasy/sdk i18n.t()
 *
 * Detects `import { t, Trans } from '@lingui/macro'` or
 * `import { i18n } from '@lingui/core'` and converts:
 *
 *   t`text`                → i18n.t('auto-key', 'text')
 *   t`Hello ${name}`       → i18n.t('key', 'Hello {{name}}', { name })
 *   <Trans>text</Trans>    → {i18n.t('key', 'text')}
 *   i18n._(msg)            → i18n.t(msg.id, msg.message)
 *
 * Removes: import … from '@lingui/macro', import … from '@lingui/core'
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

/**
 * Generate a stable key from message text by slugifying the content.
 * Lingui often uses the message text itself as the key (or auto-generates a hash).
 */
function autoKey(text) {
  const slug = text
    .replace(/\{\{\w+\}\}/g, "") // remove interpolation placeholders
    .replace(/[^\w\s]/g, "") // remove punctuation
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join("");

  return slug || "text";
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
  if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
    return `${node.callee.name}()`;
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
 * Collect the raw text content of JSX children, converting embedded JSX
 * expressions to interpolation placeholders.
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
 * Extract variable names referenced in JSX children (from expression containers).
 */
function extractJSXChildrenVars(children) {
  const vars = [];
  for (const child of children) {
    if (t.isJSXExpressionContainer(child)) {
      if (t.isIdentifier(child.expression)) {
        vars.push([child.expression.name, child.expression.name]);
      } else if (
        t.isMemberExpression(child.expression) &&
        t.isIdentifier(child.expression.property)
      ) {
        vars.push([child.expression.property.name, nodeToSource(child.expression)]);
      }
    } else if (t.isJSXElement(child)) {
      vars.push(...extractJSXChildrenVars(child.children));
    }
  }
  return vars;
}

// ── Plugin ───────────────────────────────────────────────────────────────────

export default {
  name: "lingui",
  description: "Migrate from @lingui/macro + @lingui/core to @shipeasy/sdk i18n.t()",

  detect(source) {
    return (
      /\bfrom\s+['"]@lingui\/macro['"]/.test(source) ||
      /\bfrom\s+['"]@lingui\/core['"]/.test(source)
    );
  },

  /**
   * Lingui stores translations in PO or JSON catalog files.
   * JSON catalogs: { "msgId": { "message": "translated" } } or flat { "msgId": "translated" }.
   */
  loadTranslations(translationFilePaths) {
    const translations = {};

    for (const filePath of translationFilePaths) {
      try {
        const raw = fs.readFileSync(filePath, "utf8");

        // Try JSON first
        if (filePath.endsWith(".json")) {
          const data = JSON.parse(raw);
          for (const [k, v] of Object.entries(data)) {
            if (typeof v === "string") {
              translations[k] = v;
            } else if (v && typeof v === "object" && typeof v.message === "string") {
              // Lingui catalog format: { "key": { "message": "value" } }
              translations[k] = v.message;
            }
          }
        }

        // PO file support: extract msgid/msgstr pairs
        if (filePath.endsWith(".po") || filePath.endsWith(".pot")) {
          const msgRegex = /msgid\s+"([^"]*(?:\\.[^"]*)*)"\s*\n\s*msgstr\s+"([^"]*(?:\\.[^"]*)*)"/g;
          let match;
          while ((match = msgRegex.exec(raw)) !== null) {
            const id = match[1].replace(/\\"/g, '"');
            const str = match[2].replace(/\\"/g, '"');
            if (id && str) translations[id] = str;
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return translations;
  },

  removeImports: ["@lingui/macro", "@lingui/core"],

  visitors(config, translations) {
    const trans = translations || {};

    // Track local names for the `t` tag from @lingui/macro
    const tTagBindings = new Set(["t"]); // default import name
    // Track local names for the lingui `i18n` object from @lingui/core
    const linguiI18nBindings = new Set();

    return {
      /**
       * Scan imports to identify local binding names.
       */
      ImportDeclaration(path) {
        const source = path.node.source.value;
        if (source === "@lingui/macro") {
          for (const spec of path.node.specifiers) {
            if (t.isImportSpecifier(spec) && t.isIdentifier(spec.imported, { name: "t" })) {
              tTagBindings.add(spec.local.name);
            }
          }
        }
        if (source === "@lingui/core") {
          for (const spec of path.node.specifiers) {
            if (t.isImportSpecifier(spec) && t.isIdentifier(spec.imported, { name: "i18n" })) {
              linguiI18nBindings.add(spec.local.name);
            }
            if (t.isImportDefaultSpecifier(spec)) {
              linguiI18nBindings.add(spec.local.name);
            }
          }
        }
        // Don't return a removal — the `removeImports` config handles that.
      },

      /**
       * Convert tagged template: t`text` or t`Hello ${name}`
       */
      TaggedTemplateExpression(path) {
        const tag = path.node.tag;
        if (!t.isIdentifier(tag) || !tTagBindings.has(tag.name)) return;

        const quasi = path.node.quasi;
        const quasis = quasi.quasis;
        const expressions = quasi.expressions;

        // Build the message template and collect variables
        let template = "";
        const varEntries = [];
        const usedNames = new Set();

        for (let i = 0; i < quasis.length; i++) {
          template += quasis[i].value.cooked ?? quasis[i].value.raw;
          if (i < expressions.length) {
            const expr = expressions[i];
            let varName;
            if (t.isIdentifier(expr)) {
              varName = expr.name;
            } else if (t.isMemberExpression(expr) && t.isIdentifier(expr.property)) {
              varName = expr.property.name;
            } else if (t.isCallExpression(expr) && t.isIdentifier(expr.callee)) {
              varName = expr.callee.name + "Result";
            } else {
              varName = `var${i}`;
            }

            // Deduplicate
            if (usedNames.has(varName)) {
              let suffix = 2;
              while (usedNames.has(`${varName}${suffix}`)) suffix++;
              varName = `${varName}${suffix}`;
            }
            usedNames.add(varName);

            template += `{{${varName}}}`;
            varEntries.push([varName, nodeToSource(expr)]);
          }
        }

        const key = autoKey(template);
        const fallback = lookup(trans, template) !== template ? lookup(trans, template) : template;

        return {
          type: "replace",
          start: path.node.start,
          end: path.node.end,
          replacement: buildCall(key, fallback, varEntries),
        };
      },

      /**
       * Convert <Trans>text</Trans> → {i18n.t('key', 'text')}
       */
      JSXElement(path) {
        const opening = path.node.openingElement;
        if (!t.isJSXIdentifier(opening.name, { name: "Trans" })) return;

        // Check if this Trans is from @lingui/macro (not react-i18next)
        // Lingui's Trans has no i18nKey prop — react-i18next's does
        const hasI18nKey = opening.attributes.some(
          (attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name, { name: "i18nKey" }),
        );
        if (hasI18nKey) return; // This is react-i18next Trans, not lingui

        // Check for explicit `id` prop on Trans
        let explicitId = null;
        for (const attr of opening.attributes) {
          if (
            t.isJSXAttribute(attr) &&
            t.isJSXIdentifier(attr.name, { name: "id" }) &&
            t.isStringLiteral(attr.value)
          ) {
            explicitId = attr.value.value;
          }
        }

        const childText = extractJSXChildrenText(path.node.children);
        const childVars = extractJSXChildrenVars(path.node.children);

        if (!childText && !explicitId) return;

        const key = explicitId || autoKey(childText);
        const fallback = childText || lookup(trans, key);

        return {
          type: "replace",
          start: path.node.start,
          end: path.node.end,
          replacement: `{${buildCall(key, fallback, childVars)}}`,
        };
      },

      /**
       * Convert i18n._(msg) → i18n.t(msg.id, msg.message)
       * Also handles i18n._('text') → i18n.t('auto-key', 'text')
       */
      CallExpression(path) {
        const callee = path.node.callee;
        if (!t.isMemberExpression(callee)) return;
        if (!t.isIdentifier(callee.property, { name: "_" })) return;

        const objName = t.isIdentifier(callee.object) ? callee.object.name : null;
        if (!objName || !linguiI18nBindings.has(objName)) return;

        const args = path.node.arguments;
        if (args.length === 0) return;

        const arg = args[0];

        // i18n._('literal string')
        if (t.isStringLiteral(arg)) {
          const text = arg.value;
          const key = autoKey(text);
          const fallback = lookup(trans, text) !== text ? lookup(trans, text) : text;

          return {
            type: "replace",
            start: path.node.start,
            end: path.node.end,
            replacement: buildCall(key, fallback, null),
          };
        }

        // i18n._(msg) where msg is an identifier — use msg.id and msg.message
        if (t.isIdentifier(arg)) {
          const name = arg.name;
          return {
            type: "replace",
            start: path.node.start,
            end: path.node.end,
            replacement: `i18n.t(${name}.id, ${name}.message)`,
          };
        }

        // i18n._(someObj.prop) — less common but handle gracefully
        if (t.isMemberExpression(arg)) {
          const src = nodeToSource(arg);
          return {
            type: "replace",
            start: path.node.start,
            end: path.node.end,
            replacement: `i18n.t(${src}.id, ${src}.message)`,
          };
        }
      },
    };
  },
};
