/**
 * fallback.mjs — Extract translatable strings from nullish coalescing (??)
 * and logical OR (||) fallback expressions.
 *
 * Handles:
 *   x ?? 'No data'
 *   title || 'Untitled'
 *   condition && 'text'  (right side in JSX expression container)
 */

import { t } from "../lib/parse.mjs";
import { isTranslatableString } from "../lib/strings.mjs";

export default {
  name: "fallback",
  description: "Extract translatable strings from ?? and || fallback expressions",
  params: {
    operators: {
      type: "string[]",
      default: ["??", "||"],
      description: "Logical operators whose right-hand string operands should be extracted",
    },
  },

  examples: [
    { before: "name ?? 'No data'", after: "name ?? i18n.t('key', 'No data')" },
    { before: "title || 'Untitled'", after: "title || i18n.t('key', 'Untitled')" },
  ],

  visitors(config, helpers) {
    const operators = new Set(config.operators ?? ["??", "||"]);

    return {
      StringLiteral(path, addExtraction) {
        // Skip if in JSX attribute (handled by jsx-attr type)
        if (path.parentPath.isJSXAttribute()) return;

        if (!isTranslatableString(path.node.value)) return;

        const parent = path.parentPath;
        if (!parent.isLogicalExpression()) return;

        const op = parent.node.operator;

        // ?? and || fallbacks — right-hand side
        if (operators.has(op) && path.key === "right") {
          const contextType = op === "??" ? "nullish-fallback" : "or-fallback";
          addExtraction({
            start: path.node.start,
            end: path.node.end,
            original: path.node.value,
            context: contextType,
            propName: null,
            wrapBraces: false,
          });
          return;
        }

        // && render: condition && 'text' (right side in JSX)
        if (op === "&&" && path.key === "right") {
          if (parent.parentPath?.isJSXExpressionContainer()) {
            addExtraction({
              start: path.node.start,
              end: path.node.end,
              original: path.node.value,
              context: "and-render",
              propName: null,
              wrapBraces: false,
            });
          }
        }
      },
    };
  },
};
