/**
 * default-param.mjs — Extract translatable strings from default parameter values.
 *
 * Handles: { saveLabel = 'Save changes' }, { buttonText = 'Submit' }, etc.
 */

import { t } from "../lib/parse.mjs";
import { isTranslatableString, TRANSLATABLE_ATTRS } from "../lib/strings.mjs";

/** Default regex for parameter names that trigger extraction */
const DEFAULT_NAME_RE = /[Ll]abel$|[Tt]ext$|[Tt]itle$|[Mm]essage$|[Dd]escription$|[Hh]int$/;

export default {
  name: "default-param",
  description: "Extract translatable strings from default parameter values (AssignmentPattern)",
  params: {
    names: {
      type: "string",
      default: DEFAULT_NAME_RE.source,
      description:
        "Regex pattern for parameter names that trigger extraction (in addition to TRANSLATABLE_ATTRS)",
    },
  },

  examples: [
    {
      before: "{ saveLabel = 'Save changes' }",
      after: "{ saveLabel = i18n.t('key', 'Save changes') }",
    },
    { before: "{ buttonText = 'Submit' }", after: "{ buttonText = i18n.t('key', 'Submit') }" },
  ],

  visitors(config, helpers) {
    const nameRe = config.names ? new RegExp(config.names) : DEFAULT_NAME_RE;

    return {
      StringLiteral(path, addExtraction) {
        // Skip if in JSX attribute (handled by jsx-attr type)
        if (path.parentPath.isJSXAttribute()) return;

        if (!isTranslatableString(path.node.value)) return;

        const parent = path.parentPath;

        // Default parameter value: { saveLabel = 'Save changes' }
        if (parent.isAssignmentPattern() && path.key === "right") {
          const left = parent.node.left;
          if (t.isIdentifier(left)) {
            const pname = left.name;
            if (TRANSLATABLE_ATTRS.has(pname) || nameRe.test(pname)) {
              addExtraction({
                start: path.node.start,
                end: path.node.end,
                original: path.node.value,
                context: "default-param",
                propName: pname,
                wrapBraces: false,
              });
            }
          }
        }
      },
    };
  },
};
