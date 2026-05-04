/**
 * config-schema.mjs — Config loading, validation, and defaults for the i18n codemod.
 *
 * Loads `.i18n-codemod.json` (or a custom path) and normalizes it against
 * DEFAULT_CONFIG so every downstream consumer can rely on a complete shape.
 */

import fs from "node:fs";
import path from "node:path";

// ── Default config ───────────────────────────────────────────────────────────

export const DEFAULT_CONFIG = {
  /** The import path for the SDK client module */
  sdk: "@shipeasy/sdk/client",

  /** The function call expression to use for translations */
  function: "i18n.t",

  /** Source directory to scan (relative to project root) */
  srcDir: "src",

  /** Output JSON file for extracted keys (relative to project root) */
  outputJson: "src/i18n/en.json",

  /** Glob patterns for files to skip */
  skipFiles: [
    "**/*.test.*",
    "**/*.spec.*",
    "**/__tests__/**",
    "**/__generated__/**",
    "**/*.d.ts",
    "**/node_modules/**",
  ],

  /** Enabled type modules — each key is a type name from ./types/, value is
   *  `true` (use defaults) or an object with type-specific params */
  types: {
    "jsx-text": true,
    "jsx-attr": true,
    "template-literal": true,
    "call-arg": true,
    ternary: true,
    "default-param": true,
    "object-prop": true,
    fallback: true,
    "variable-init": true,
    "array-element": true,
    "chain-method-arg": true,
  },

  /** Function calls to skip — never extract string args from these.
   *  Keys are object/function names, values are method lists ('*' = all). */
  skipCalls: {
    i18n: ["t", "rich"],
    console: [
      "log",
      "warn",
      "error",
      "info",
      "debug",
      "trace",
      "assert",
      "table",
      "group",
      "groupEnd",
      "groupCollapsed",
      "time",
      "timeEnd",
      "timeLog",
      "count",
      "dir",
    ],
  },

  /** Standalone function calls to skip — string args are not user-visible text */
  skipFunctions: [
    "cn",
    "clsx",
    "classNames",
    "twMerge",
    "tw",
    "cva",
    "require",
    "import",
    "navigate",
    "redirect",
    "loadQuery",
    "String",
    "Number",
    "Boolean",
    "parseInt",
    "parseFloat",
    "encodeURIComponent",
    "decodeURIComponent",
    "encodeURI",
    "decodeURI",
    "setTimeout",
    "setInterval",
    "clearTimeout",
    "clearInterval",
    "fetch",
    "addEventListener",
    "removeEventListener",
  ],

  /** String/array methods to skip — their args are patterns, not user text */
  skipMethods: [
    "includes",
    "indexOf",
    "lastIndexOf",
    "startsWith",
    "endsWith",
    "match",
    "matchAll",
    "replace",
    "replaceAll",
    "split",
    "search",
    "test",
    "exec",
    "localeCompare",
    "querySelector",
    "querySelectorAll",
    "getElementById",
    "getAttribute",
    "setAttribute",
    "hasAttribute",
    "join",
    "sort",
  ],

  /** JSX/object attribute names that should never be translated */
  skipAttrs: [
    "className",
    "name",
    "key",
    "id",
    "to",
    "href",
    "src",
    "type",
    "variant",
    "size",
    "color",
    "icon",
    "value",
    "defaultValue",
    "as",
    "role",
    "tabIndex",
    "slot",
    "ref",
    "style",
    "htmlFor",
    "data-testid",
    "data-label",
    "data-variables",
    "data-state",
    "method",
    "action",
    "target",
    "rel",
    "media",
    "dir",
    "lang",
    "autoComplete",
    "inputMode",
    "pattern",
    "accept",
    "encType",
    "span",
    "colSpan",
    "rowSpan",
    "width",
    "height",
    "mode",
    "trigger",
    "side",
    "align",
    "orientation",
    "direction",
    "position",
    "connection",
    "edgeTypeName",
    "format",
    "mask",
    "prefix",
    "suffix",
    "delimiter",
    "step",
    "min",
    "max",
    "rows",
    "cols",
    "maxLength",
    "minLength",
  ],

  /** JSX/object attribute names that ARE translatable */
  translatableAttrs: [
    "label",
    "title",
    "description",
    "placeholder",
    "helperText",
    "hint",
    "tooltip",
    "alt",
    "saveLabel",
    "cancelLabel",
    "cleanLabel",
    "dirtyLabel",
    "confirmLabel",
    "heading",
    "subheading",
    "subtitle",
    "navHelp",
    "actionName",
    "aria-label",
    "emptyTitle",
    "emptyDescription",
    "successMessage",
    "errorMessage",
    "illustration",
  ],

  /** Exact strings that should never be extracted */
  skipStrings: [],

  /** Deduplication settings */
  dedup: {
    /** Minimum number of files a string must appear in to be promoted to common.* */
    threshold: 2,
    /** Strings that are always treated as common regardless of frequency */
    predefined: [
      "Save",
      "Save changes",
      "Cancel",
      "Delete",
      "Close",
      "Done",
      "Edit",
      "Add",
      "Remove",
      "Create",
      "Update",
      "Submit",
      "Confirm",
      "Back",
      "Next",
      "Previous",
      "More",
      "Less",
      "Loading...",
      "Loading",
      "Search",
      "Filter",
      "Clear",
      "Reset",
      "Yes",
      "No",
      "OK",
      "Actions",
      "Name",
      "Email",
      "Phone",
      "Address",
      "Date",
      "Time",
      "Status",
      "Type",
      "Notes",
      "Required",
      "Optional",
      "Select",
      "Select all",
      "No results",
      "No data",
      "Discard",
      "Keep editing",
      "Discard unsaved changes?",
      "You have unsaved changes",
      "All changes saved",
      "Sign out",
      "Sign in",
      "Sign up",
      "View",
      "Download",
      "Upload",
      "Send",
      "Copy",
      "Refresh",
      "Retry",
      "Continue",
      "Skip",
      "Apply",
      "Accept",
      "Decline",
      "Archive",
      "Restore",
      "Duplicate",
      "Share",
      "Print",
      "Export",
      "Import",
      "Settings",
      "Profile",
      "Help",
      "Load more",
      "Show more",
      "Show less",
      "See all",
      "Description",
      "Title",
      "Details",
      "Summary",
      "First name",
      "Last name",
      "Date of birth",
      "Street address",
      "City",
      "State",
      "Zip code",
      "Country",
      "Save changes",
      "Cancel",
    ],
  },

  /** Directory names treated as "container" dirs (stripped from scope path) */
  containerDirs: ["pages", "components", "features"],

  /** Migration plugin name to run (null = none) */
  migrate: null,
};

// ── Config loading ───────────────────────────────────────────────────────────

/**
 * Load and validate the codemod config.
 *
 * @param {string | null} configPath — explicit path to a JSON config, or null
 *   to search for `.i18n-codemod.json` in the current working directory.
 * @returns {object} Normalized config with all defaults applied.
 */
export function loadConfig(configPath) {
  const resolvedPath = configPath
    ? path.resolve(configPath)
    : path.resolve(process.cwd(), ".i18n-codemod.json");

  let userConfig = {};

  if (fs.existsSync(resolvedPath)) {
    try {
      const raw = fs.readFileSync(resolvedPath, "utf8");
      userConfig = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Failed to parse config at ${resolvedPath}: ${err.message}`);
    }

    // Validate: config must be a plain object
    if (typeof userConfig !== "object" || userConfig === null || Array.isArray(userConfig)) {
      throw new Error(`Config at ${resolvedPath} must be a JSON object`);
    }

    // Validate: warn on unknown top-level keys
    const knownKeys = new Set(Object.keys(DEFAULT_CONFIG));
    for (const key of Object.keys(userConfig)) {
      if (!knownKeys.has(key)) {
        console.warn(`  [config] Unknown key "${key}" in ${resolvedPath} — ignored`);
      }
    }
  } else if (configPath) {
    // User explicitly specified a path that doesn't exist
    throw new Error(`Config file not found: ${resolvedPath}`);
  }
  // If no explicit path and default doesn't exist, just use defaults silently

  return mergeConfig(DEFAULT_CONFIG, userConfig);
}

// ── Merging ──────────────────────────────────────────────────────────────────

/**
 * Deep-merge user overrides onto defaults. Arrays are replaced (not appended).
 * Nested objects (dedup, types) are shallow-merged one level deep.
 */
function mergeConfig(defaults, overrides) {
  const merged = { ...defaults };

  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in defaults)) continue; // skip unknown keys

    if (key === "dedup" && typeof value === "object" && value !== null) {
      merged.dedup = {
        ...defaults.dedup,
        ...value,
      };
    } else if (key === "types" && typeof value === "object" && value !== null) {
      // Types are fully replaced — user controls exactly which types run
      merged.types = value;
    } else {
      merged[key] = value;
    }
  }

  // Normalize array fields to Sets where the runner expects them
  // (left as arrays here — the runner converts as needed)

  // Validate required shape after merge
  validateMergedConfig(merged);

  return merged;
}

/**
 * Post-merge validation — ensure the shape is internally consistent.
 */
function validateMergedConfig(config) {
  if (typeof config.sdk !== "string" || !config.sdk) {
    throw new Error('Config "sdk" must be a non-empty string');
  }

  if (typeof config.function !== "string" || !config.function) {
    throw new Error('Config "function" must be a non-empty string');
  }

  if (typeof config.srcDir !== "string" || !config.srcDir) {
    throw new Error('Config "srcDir" must be a non-empty string');
  }

  if (typeof config.outputJson !== "string" || !config.outputJson) {
    throw new Error('Config "outputJson" must be a non-empty string');
  }

  if (!Array.isArray(config.skipFiles)) {
    throw new Error('Config "skipFiles" must be an array of glob patterns');
  }

  if (typeof config.types !== "object" || config.types === null || Array.isArray(config.types)) {
    throw new Error('Config "types" must be an object mapping type names to true or params');
  }

  if (!Array.isArray(config.skipAttrs)) {
    throw new Error('Config "skipAttrs" must be an array of attribute names');
  }

  if (!Array.isArray(config.translatableAttrs)) {
    throw new Error('Config "translatableAttrs" must be an array of attribute names');
  }

  if (typeof config.dedup !== "object" || config.dedup === null) {
    throw new Error('Config "dedup" must be an object with threshold and predefined');
  }

  if (typeof config.dedup.threshold !== "number" || config.dedup.threshold < 1) {
    throw new Error('Config "dedup.threshold" must be a positive integer');
  }

  if (!Array.isArray(config.dedup.predefined)) {
    throw new Error('Config "dedup.predefined" must be an array of strings');
  }

  if (!Array.isArray(config.containerDirs)) {
    throw new Error('Config "containerDirs" must be an array of directory names');
  }
}
