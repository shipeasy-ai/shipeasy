/**
 * array-element.mjs — Extract translatable strings from array elements
 * in known list contexts.
 *
 * Handles: const CSV_HEADERS = ['Name', 'Email', 'Phone']
 *          const columns = ['First name', 'Last name', 'Date of birth']
 *          const tabs = ['Overview', 'Details', 'History']
 */

import { t } from "../lib/parse.mjs";
import { isTranslatableString } from "../lib/strings.mjs";

/** Default regex for array variable names that trigger extraction */
const DEFAULT_NAME_RE = /headers?|columns?|labels?|options?|items?|tabs?/i;

export default {
  name: "array-element",
  description: "Extract translatable strings from array elements in known list contexts",
  params: {
    names: {
      type: "string",
      default: DEFAULT_NAME_RE.source,
      description:
        "Regex pattern (case-insensitive) for array variable names that trigger extraction",
    },
  },

  examples: [
    {
      before: "const headers = ['Name', 'Email']",
      after: "const headers = [i18n.t('k1', 'Name'), i18n.t('k2', 'Email')]",
    },
    {
      before: "const tabs = ['Overview', 'Details']",
      after: "const tabs = [i18n.t('k1', 'Overview'), i18n.t('k2', 'Details')]",
    },
  ],

  visitors(config, helpers) {
    const nameRe = config.names ? new RegExp(config.names, "i") : DEFAULT_NAME_RE;

    return {
      StringLiteral(path, addExtraction) {
        // Skip if in JSX attribute (handled by jsx-attr type)
        if (path.parentPath.isJSXAttribute()) return;

        if (!isTranslatableString(path.node.value)) return;

        const parent = path.parentPath;

        // Array element in known list contexts
        if (parent.isArrayExpression()) {
          const arrParent = parent.parentPath;
          if (arrParent?.isVariableDeclarator()) {
            const id = arrParent.node.id;
            if (t.isIdentifier(id) && nameRe.test(id.name)) {
              addExtraction({
                start: path.node.start,
                end: path.node.end,
                original: path.node.value,
                context: "array-label",
                propName: null,
                wrapBraces: false,
              });
            }
          }
        }
      },
    };
  },
};
