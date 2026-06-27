/**
 * call-arg.mjs — Extract translatable string arguments from function/method calls.
 *
 * Generic: works for ANY obj.method('string') pattern — toast, notification,
 * alert, dialog, or any custom API. Configure via params.
 *
 * Also extracts string values from option-object properties when specified
 * (e.g. toast.error('msg', { description: 'details' })).
 */

import { t } from "../lib/parse.mjs";
import { isTranslatableString } from "../lib/strings.mjs";

export default {
  name: "call-arg",
  description: "Extract translatable string arguments from object.method() calls",
  params: {
    callee: {
      type: "string",
      default: "toast",
      description: 'Object identifier (e.g. "toast", "notification", "Alert")',
    },
    methods: {
      type: "string[]",
      default: ["success", "error", "info", "message", "loading", "warning"],
      description: "Method names whose arguments contain user-visible text",
    },
    argIndex: { type: "number", default: 0, description: "Which argument to extract (0-based)" },
    optionKeys: {
      type: "string[]",
      default: ["description"],
      description: "Keys in the options object (2nd arg) that also contain translatable text",
    },
  },

  examples: [
    {
      before: "toast.success('Changes saved')",
      after: "toast.success(i18n.t('key', 'Changes saved'))",
    },
    {
      before: "notification.show('Hello')",
      after: "notification.show(i18n.t('key', 'Hello'))",
      note: "callee='notification', methods=['show']",
    },
    {
      before: "Alert.warn('Caution', { body: 'Be careful' })",
      after: "Alert.warn(i18n.t(...), { body: i18n.t(...) })",
      note: "optionKeys=['body']",
    },
  ],

  visitors(config) {
    const calleeName = config.callee ?? "toast";
    const methods = new Set(
      config.methods ?? ["success", "error", "info", "message", "loading", "warning"],
    );
    const targetArg = config.argIndex ?? 0;
    const optionKeys = new Set(config.optionKeys ?? ["description"]);

    return {
      StringLiteral(path, addExtraction) {
        if (path.parentPath.isJSXAttribute()) return;
        if (!isTranslatableString(path.node.value)) return;

        const parent = path.parentPath;

        // ── Direct call argument: callee.method('string') at argIndex
        if (parent.isCallExpression()) {
          const callee = parent.node.callee;
          const argIdx = parent.node.arguments.indexOf(path.node);

          if (
            t.isMemberExpression(callee) &&
            t.isIdentifier(callee.object, { name: calleeName }) &&
            t.isIdentifier(callee.property) &&
            methods.has(callee.property.name) &&
            argIdx === targetArg
          ) {
            addExtraction({
              start: path.node.start,
              end: path.node.end,
              original: path.node.value,
              context: "call-arg",
              propName: null,
              wrapBraces: false,
            });
            return;
          }
        }

        // ── Option object property: callee.method('msg', { key: 'string' })
        if (parent.isObjectProperty() && path.key === "value") {
          const keyNode = parent.node.key;
          const propName = t.isIdentifier(keyNode)
            ? keyNode.name
            : t.isStringLiteral(keyNode)
              ? keyNode.value
              : null;

          if (propName && optionKeys.has(propName)) {
            const objParent = parent.parentPath?.parentPath;
            if (objParent?.isCallExpression()) {
              const callee = objParent.node.callee;
              if (
                t.isMemberExpression(callee) &&
                t.isIdentifier(callee.object, { name: calleeName })
              ) {
                addExtraction({
                  start: path.node.start,
                  end: path.node.end,
                  original: path.node.value,
                  context: "call-arg-option",
                  propName,
                  wrapBraces: false,
                });
              }
            }
          }
        }
      },
    };
  },
};
