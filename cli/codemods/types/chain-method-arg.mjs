/**
 * chain-method-arg.mjs — Extract translatable string arguments from chained method calls.
 *
 * Generic: works for ANY .method(constraint, 'message') pattern — Zod, Yup,
 * Joi, Valibot, or any validation/builder API with chained methods that
 * accept a user-visible message as a trailing argument.
 *
 * Also skips schema-definition methods (e.g. z.literal('value')) via
 * configurable skipMethods.
 */

import { t } from "../lib/parse.mjs";
import { isTranslatableString } from "../lib/strings.mjs";

export default {
  name: "chain-method-arg",
  description:
    "Extract translatable string arguments from chained method calls (validation messages, builder APIs)",
  params: {
    methods: {
      type: "string[]",
      default: [
        "min",
        "max",
        "length",
        "email",
        "url",
        "regex",
        "uuid",
        "nonempty",
        "trim",
        "startsWith",
        "endsWith",
        "refine",
      ],
      description: "Method names whose trailing string arg is a user-visible message",
    },
    argIndex: {
      type: "number",
      default: -1,
      description: "Argument index to extract (-1 = last string arg after non-string args)",
    },
    skipObjects: {
      type: "string[]",
      default: [],
      description: 'Object names to skip entirely for skipMethods (e.g. ["z"] to skip z.literal)',
    },
    skipMethods: {
      type: "string[]",
      default: ["literal", "enum", "discriminatedUnion", "nativeEnum"],
      description: "Methods that define schema shape — their string args are values, not messages",
    },
  },

  examples: [
    {
      before: "z.string().min(1, 'Required')",
      after: "z.string().min(1, i18n.t('key', 'Required'))",
    },
    {
      before: "yup.string().email('Invalid email')",
      after: "yup.string().email(i18n.t('key', 'Invalid email'))",
      note: "works with any schema library",
    },
    { before: "schema.max(100, 'Too long')", after: "schema.max(100, i18n.t('key', 'Too long'))" },
  ],

  visitors(config) {
    const methods = new Set(
      config.methods ?? [
        "min",
        "max",
        "length",
        "email",
        "url",
        "regex",
        "uuid",
        "nonempty",
        "trim",
        "startsWith",
        "endsWith",
        "refine",
      ],
    );
    const desiredArgIndex = config.argIndex ?? -1;
    const skipObjects = new Set(config.skipObjects ?? []);
    const skipMethods = new Set(
      config.skipMethods ?? ["literal", "enum", "discriminatedUnion", "nativeEnum"],
    );

    return {
      StringLiteral(path, addExtraction) {
        if (path.parentPath.isJSXAttribute()) return;
        if (!isTranslatableString(path.node.value)) return;

        const parent = path.parentPath;
        if (!parent.isCallExpression()) return;

        const callee = parent.node.callee;
        if (!t.isMemberExpression(callee) || !t.isIdentifier(callee.property)) return;

        const method = callee.property.name;

        // Skip schema-definition calls on specific objects
        if (
          t.isIdentifier(callee.object) &&
          skipObjects.has(callee.object.name) &&
          skipMethods.has(method)
        )
          return;

        // Skip methods that define values, not messages
        if (skipMethods.has(method)) return;

        if (!methods.has(method)) return;

        const args = parent.node.arguments;
        const argIdx = args.indexOf(path.node);

        if (desiredArgIndex === -1) {
          if (argIdx < 1 && args.length > 1) return;
        } else if (argIdx !== desiredArgIndex) {
          return;
        }

        addExtraction({
          start: path.node.start,
          end: path.node.end,
          original: path.node.value,
          context: "chain-method-arg",
          propName: method,
          wrapBraces: false,
        });
      },
    };
  },
};
