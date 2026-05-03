/**
 * jsx-attr.mjs — Extract translatable JSX attribute string values.
 *
 * Handles: label="First name", aria-label="Close dialog", placeholder="Search...", etc.
 */

import { t } from "../lib/parse.mjs";
import { isTranslatableString, TRANSLATABLE_ATTRS, SKIP_ATTRS } from "../lib/strings.mjs";

export default {
  name: "jsx-attr",
  description: "Extract translatable strings from JSX attribute values",
  params: {
    attrs: {
      type: "string[]",
      default: [...TRANSLATABLE_ATTRS],
      description: "Attribute names to extract (merged with aria-* prefix matching)",
    },
    skipAttrs: {
      type: "string[]",
      default: [...SKIP_ATTRS],
      description: "Attribute names to always skip",
    },
  },

  examples: [
    {
      before: '<Input label="First name" />',
      after: "<Input label={i18n.t('key', 'First name')} />",
    },
    { before: '<div aria-label="Close">', after: "<div aria-label={i18n.t('key', 'Close')}>" },
  ],

  visitors(config, helpers) {
    const translatableAttrs = config.attrs ? new Set(config.attrs) : TRANSLATABLE_ATTRS;
    const skipAttrs = config.skipAttrs ? new Set(config.skipAttrs) : SKIP_ATTRS;

    return {
      JSXAttribute(path, addExtraction) {
        const nameNode = path.node.name;
        const attrName = t.isJSXIdentifier(nameNode)
          ? nameNode.name
          : t.isJSXNamespacedName(nameNode)
            ? `${nameNode.namespace.name}-${nameNode.name.name}`
            : null;
        if (!attrName) return;

        if (skipAttrs.has(attrName)) return;
        if (!translatableAttrs.has(attrName) && !attrName.startsWith("aria-")) return;

        const val = path.node.value;
        if (!t.isStringLiteral(val)) return;
        if (!isTranslatableString(val.value)) return;

        addExtraction({
          start: val.start,
          end: val.end,
          original: val.value,
          context: "jsx-attr",
          propName: attrName,
          wrapBraces: true,
        });
      },
    };
  },
};
