/**
 * object-prop.mjs — Extract translatable strings from object property values
 * with known translatable keys.
 *
 * Handles: { label: 'First name', title: 'Dashboard', placeholder: 'Search...' }
 */

import { t } from "../lib/parse.mjs";
import { isTranslatableString, TRANSLATABLE_ATTRS } from "../lib/strings.mjs";

export default {
  name: "object-prop",
  description: "Extract translatable strings from object property values with known keys",
  params: {
    keys: {
      type: "string[]",
      default: [...TRANSLATABLE_ATTRS],
      description: "Object property key names whose string values should be extracted",
    },
  },

  examples: [
    { before: "{ label: 'First name' }", after: "{ label: i18n.t('key', 'First name') }" },
    { before: "{ title: 'Dashboard' }", after: "{ title: i18n.t('key', 'Dashboard') }" },
  ],

  visitors(config, helpers) {
    const keys = config.keys ? new Set(config.keys) : TRANSLATABLE_ATTRS;

    return {
      StringLiteral(path, addExtraction) {
        // Skip if in JSX attribute (handled by jsx-attr type)
        if (path.parentPath.isJSXAttribute()) return;

        if (!isTranslatableString(path.node.value)) return;

        const parent = path.parentPath;

        // Object property value with known translatable key
        if (parent.isObjectProperty() && path.key === "value") {
          const keyNode = parent.node.key;
          const propName = t.isIdentifier(keyNode)
            ? keyNode.name
            : t.isStringLiteral(keyNode)
              ? keyNode.value
              : null;

          if (propName && keys.has(propName)) {
            addExtraction({
              start: path.node.start,
              end: path.node.end,
              original: path.node.value,
              context: "object-prop",
              propName,
              wrapBraces: false,
            });
          }
        }
      },
    };
  },
};
