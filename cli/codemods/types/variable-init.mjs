/**
 * variable-init.mjs — Extract translatable strings from variable initializers
 * with text-like names.
 *
 * Handles: const errorMessage = 'Something went wrong'
 *          const buttonLabel = 'Save changes'
 *          const pageTitle = 'Dashboard'
 */

import { t } from "../lib/parse.mjs";
import { isTranslatableString } from "../lib/strings.mjs";

/** Default regex for variable names that trigger extraction */
const DEFAULT_NAME_RE = /[Ll]abel|[Tt]ext|[Tt]itle|[Mm]essage|[Dd]escription|[Hh]eading/;

export default {
  name: "variable-init",
  description:
    "Extract translatable strings from variable declarator initializers with text-like names",
  params: {
    names: {
      type: "string",
      default: DEFAULT_NAME_RE.source,
      description: "Regex pattern for variable names that trigger extraction",
    },
  },

  examples: [
    {
      before: "const errorMessage = 'Something went wrong'",
      after: "const errorMessage = i18n.t('key', 'Something went wrong')",
    },
    {
      before: "const pageTitle = 'Dashboard'",
      after: "const pageTitle = i18n.t('key', 'Dashboard')",
    },
  ],

  visitors(config, helpers) {
    const nameRe = config.names ? new RegExp(config.names) : DEFAULT_NAME_RE;

    return {
      StringLiteral(path, addExtraction) {
        // Skip if in JSX attribute (handled by jsx-attr type)
        if (path.parentPath.isJSXAttribute()) return;

        if (!isTranslatableString(path.node.value)) return;

        const parent = path.parentPath;

        // Variable initializer with text-like name
        if (parent.isVariableDeclarator() && path.key === "init") {
          const id = parent.node.id;
          if (t.isIdentifier(id) && nameRe.test(id.name)) {
            addExtraction({
              start: path.node.start,
              end: path.node.end,
              original: path.node.value,
              context: "variable",
              propName: id.name,
              wrapBraces: false,
            });
          }
        }
      },
    };
  },
};
