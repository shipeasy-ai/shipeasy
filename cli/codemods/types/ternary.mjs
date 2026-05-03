/**
 * ternary.mjs — Extract translatable strings from ternary expression branches.
 *
 * Handles both StringLiteral and TemplateLiteral in consequent/alternate of
 * ConditionalExpression, when the ternary is in a translatable context:
 *   - JSX expression container
 *   - Toast call
 *   - Return statement
 *   - Variable declarator with label/text/title/message name
 *   - Object property with known translatable key
 *   - Nested ternary
 */

import { t } from "../lib/parse.mjs";
import { isTranslatableString, TRANSLATABLE_ATTRS, SKIP_ATTRS } from "../lib/strings.mjs";

export default {
  name: "ternary",
  description: "Extract translatable strings from ternary (conditional) expression branches",
  params: {},

  examples: [
    {
      before: "{isNew ? 'Create' : 'Update'}",
      after: "{isNew ? i18n.t('k1', 'Create') : i18n.t('k2', 'Update')}",
    },
  ],

  visitors(config, helpers) {
    return {
      /**
       * StringLiteral in ternary branches.
       */
      StringLiteral(path, addExtraction) {
        // Skip if in JSX attribute (handled by jsx-attr type)
        if (path.parentPath.isJSXAttribute()) return;

        if (!isTranslatableString(path.node.value)) return;

        const parent = path.parentPath;
        if (!parent.isConditionalExpression()) return;
        if (path.key !== "consequent" && path.key !== "alternate") return;

        if (!isTernaryTranslatable(parent)) return;

        addExtraction({
          start: path.node.start,
          end: path.node.end,
          original: path.node.value,
          context: "ternary",
          propName: null,
          wrapBraces: false,
        });
      },

      /**
       * TemplateLiteral in ternary branches: condition ? `${x} items` : 'none'
       */
      TemplateLiteral(path, addExtraction, source) {
        // Skip tagged templates
        if (path.parentPath.isTaggedTemplateExpression()) return;

        const parent = path.parentPath;
        if (!parent.isConditionalExpression()) return;
        if (path.key !== "consequent" && path.key !== "alternate") return;

        if (!isTernaryTranslatable(parent)) return;

        const quasis = path.node.quasis;
        const expressions = path.node.expressions;

        // No expressions — simple backtick string
        if (expressions.length === 0) {
          const text = quasis[0].value.cooked;
          if (!text || !isTranslatableString(text)) return;

          addExtraction({
            start: path.node.start,
            end: path.node.end,
            original: text,
            context: "ternary",
            propName: null,
            wrapBraces: false,
          });
          return;
        }

        // With expressions — build interpolated template
        let template = "";
        const vars = [];
        const usedVarNames = new Set();
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
            // Deduplicate variable names
            if (usedVarNames.has(varName)) {
              let suffix = 2;
              while (usedVarNames.has(`${varName}${suffix}`)) suffix++;
              varName = `${varName}${suffix}`;
            }
            usedVarNames.add(varName);
            template += `{{${varName}}}`;
            vars.push({ varName, start: expr.start, end: expr.end });
          }
        }

        // Content check
        const remnant = template.replace(/\{\{\w+\}\}/g, "").trim();
        if (!remnant) return;
        if (/^[-_\/:.;,|\s]+$/.test(remnant)) return;
        if (/^[/.]|^https?:/.test(template)) return;

        // Build vars source for replacement
        const varsSource = vars.length
          ? ", { " +
            vars
              .map((v) => {
                let exprSrc = source.slice(v.start, v.end);
                if (/\?\./.test(exprSrc)) {
                  exprSrc = `String((${exprSrc}) ?? '')`;
                } else if (/\.\w+$/.test(exprSrc) && !/\(/.test(exprSrc)) {
                  exprSrc = `String(${exprSrc})`;
                }
                return v.varName === exprSrc ? v.varName : `${v.varName}: ${exprSrc}`;
              })
              .join(", ") +
            " }"
          : "";

        addExtraction({
          start: path.node.start,
          end: path.node.end,
          original: template,
          context: "ternary-template",
          propName: null,
          wrapBraces: false,
          templateVarsSource: varsSource,
        });
      },
    };
  },
};

/**
 * Check whether a ConditionalExpression path is in a translatable context.
 */
function isTernaryTranslatable(ternaryPath) {
  const ternaryParent = ternaryPath.parentPath;

  if (ternaryParent.isJSXExpressionContainer()) return true;

  if (ternaryParent.isCallExpression()) {
    const callee = ternaryParent.node.callee;
    if (t.isMemberExpression(callee) && t.isIdentifier(callee.object, { name: "toast" })) {
      return true;
    }
  }

  if (ternaryParent.isReturnStatement()) return true;

  if (ternaryParent.isVariableDeclarator()) {
    const id = ternaryParent.node.id;
    if (t.isIdentifier(id) && /[Ll]abel|[Tt]ext|[Tt]itle|[Mm]essage/.test(id.name)) {
      return true;
    }
  }

  if (ternaryParent.isObjectProperty() && ternaryParent.key === "value") {
    const propKey = ternaryParent.node.key;
    const pn = t.isIdentifier(propKey) ? propKey.name : null;
    if (pn && TRANSLATABLE_ATTRS.has(pn)) return true;
  }

  // Nested ternary
  if (ternaryParent.isConditionalExpression()) return true;

  return false;
}
