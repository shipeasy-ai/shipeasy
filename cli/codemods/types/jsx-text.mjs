/**
 * jsx-text.mjs — Extract translatable JSXText nodes.
 *
 * Handles: <h1>Patients</h1>, <Button><Icon /> Label</Button>, etc.
 */

import { t } from "../lib/parse.mjs";
import { isTranslatableString } from "../lib/strings.mjs";

export default {
  name: "jsx-text",
  description: "Extract translatable text from JSX text children",
  params: {
    skipMixedContent: {
      type: "boolean",
      default: false,
      description: "Skip JSXText nodes that have element siblings (mixed content)",
    },
  },

  examples: [
    { before: "<h1>Patients</h1>", after: "<h1>{i18n.t('key', 'Patients')}</h1>" },
    {
      before: "<Button><Icon /> Label</Button>",
      after: "<Button><Icon /> {i18n.t('key', 'Label')}</Button>",
    },
  ],

  visitors(config, helpers) {
    const { skipMixedContent = false } = config;

    return {
      JSXText(path, addExtraction) {
        // `value` is entity-decoded (`it&apos;s` → `it's`), so it can't size a
        // source range — the raw text can. The fallback is what React renders:
        // decoded, each line trimmed, lines joined by one space.
        const node = path.node;
        const raw = node.extra?.raw ?? node.value;
        const trimmed = node.value
          .split(/\r\n|\n|\r/)
          .map((line) => line.trim())
          .filter(Boolean)
          .join(" ");
        if (!isTranslatableString(trimmed)) return;

        // Skip if has element siblings (mixed content)
        const siblings = path.parentPath.node.children;
        const hasElementSiblings = siblings.some((c) => t.isJSXElement(c) || t.isJSXFragment(c));

        if (skipMixedContent && hasElementSiblings) return;

        // Allow text next to icons (common pattern: <Button><Icon /> Label</Button>)
        // But skip if text is between two text-bearing elements
        if (hasElementSiblings && trimmed.length < 3) return;

        // Replace the raw text minus its surrounding whitespace
        const absStart = node.start + (raw.length - raw.trimStart().length);
        const absEnd = node.start + raw.trimEnd().length;

        addExtraction({
          start: absStart,
          end: absEnd,
          original: trimmed,
          context: "jsx-text",
          propName: null,
          wrapBraces: true,
        });
      },
    };
  },
};
