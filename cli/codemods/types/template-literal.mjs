/**
 * template-literal.mjs — Extract translatable template literals with expressions.
 *
 * Handles: `${count} items`, `Hello ${name}!`, etc.
 * Includes variable naming, dedup, String() wrapping, optional-chain coalescing.
 *
 * Note: simple backtick strings without expressions are handled by the
 * respective context-specific types (toast, ternary, etc.) via their own
 * StringLiteral-like handling. This type only handles template literals
 * that contain interpolated expressions.
 */

import { t } from "../lib/parse.mjs";
import { isTranslatableString, TRANSLATABLE_ATTRS, SKIP_ATTRS } from "../lib/strings.mjs";

export default {
  name: "template-literal",
  description: "Extract translatable template literals with interpolated expressions",
  params: {},

  examples: [
    {
      before: "`${count} items`",
      after: "i18n.t('key', '{{count}} items', { count })",
    },
    {
      before: "`Hello ${user.name}!`",
      after: "i18n.t('key', 'Hello {{name}}!', { name: String(user.name) })",
    },
  ],

  visitors(config, helpers) {
    return {
      TemplateLiteral(path, addExtraction, source) {
        // Skip tagged templates (graphql`...`, css`...`, etc.)
        if (path.parentPath.isTaggedTemplateExpression()) return;

        const quasis = path.node.quasis;
        const expressions = path.node.expressions;

        // No expressions — simple string in backticks; treated like StringLiteral
        // by the getStringContext logic elsewhere. We only process templates with
        // expressions here, EXCEPT we also handle simple backtick strings that
        // are in a translatable call/JSX context.
        if (expressions.length === 0) {
          const text = quasis[0].value.cooked;
          if (!text || !isTranslatableString(text)) return;

          const ctx = getTemplateLiteralContext(path, t);
          if (!ctx) return;

          addExtraction({
            start: path.node.start,
            end: path.node.end,
            original: text,
            context: ctx.type || "template-simple",
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

        // Content check: templates with interpolations get a lenient check because
        // the context detection (toast, JSX, known variable) provides the real signal
        const remnant = template.replace(/\{\{\w+\}\}/g, "").trim();
        if (!remnant) return;
        if (/^[-_\/:.;,|\s]+$/.test(remnant)) return;
        if (/^[/.]|^https?:/.test(template)) return;

        // Determine context — skip ternary branches (handled by ternary type)
        const parent = path.parentPath;
        if (
          parent.isConditionalExpression() &&
          (path.key === "consequent" || path.key === "alternate")
        )
          return;

        const ctx = getTemplateLiteralContext(path, t);
        if (!ctx) return;

        // Build vars source for replacement
        const varsSource = vars.length
          ? ", { " +
            vars
              .map((v) => {
                let exprSrc = source.slice(v.start, v.end);
                // Wrap complex expressions with String() for type safety:
                // member access chains (.label, .name) might return ReactNode or other non-scalar
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
          context: ctx.type,
          propName: null,
          wrapBraces: false,
          templateVarsSource: varsSource,
        });
      },
    };
  },
};

/**
 * Determine the translatable context for a TemplateLiteral, mirroring
 * the context detection logic in the monolith's TemplateLiteral visitor.
 *
 * @returns {{ type: string } | null}
 */
function getTemplateLiteralContext(path, t) {
  const parent = path.parentPath;
  let ctx = null;

  if (parent.isCallExpression()) {
    const callee = parent.node.callee;
    // Skip CSS utility functions
    if (
      t.isIdentifier(callee) &&
      ["cn", "clsx", "classNames", "twMerge", "tw", "cva"].includes(callee.name)
    )
      return null;
    if (t.isMemberExpression(callee) && t.isIdentifier(callee.object, { name: "toast" })) {
      ctx = { type: "toast-template" };
    }
  }

  if (parent.isJSXExpressionContainer()) {
    // Skip if this is the value of a non-translatable attribute (className, etc.)
    const exprParent = parent.parentPath;
    if (exprParent.isJSXAttribute()) {
      const an = t.isJSXIdentifier(exprParent.node.name) ? exprParent.node.name.name : null;
      if (an && SKIP_ATTRS.has(an)) return null;
      if (an && (TRANSLATABLE_ATTRS.has(an) || an.startsWith("aria-"))) {
        ctx = { type: "jsx-template" };
      }
    } else {
      ctx = { type: "jsx-template" };
    }
  }

  if (parent.isVariableDeclarator()) {
    const id = parent.node.id;
    if (t.isIdentifier(id) && /[Ll]abel|[Tt]ext|[Tt]itle|[Mm]essage/.test(id.name)) {
      ctx = { type: "var-template" };
    }
  }

  if (parent.isTemplateLiteral()) return null; // nested — skip

  return ctx;
}
