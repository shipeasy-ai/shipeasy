/**
 * dedup.mjs — Deduplication: frequency analysis, number parameterization,
 * and collision resolution for common i18n keys.
 *
 * Extracted from scripts/codemod-i18n.mjs for reuse across codemods.
 */

import { commonKeyFromString } from "./keys.mjs";

// ── Default predefined common strings ────────────────────────────────────

const DEFAULT_PREDEFINED_COMMON = new Set([
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
  "Loading…",
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
]);

// ── Build common keys ────────────────────────────────────────────────────

/**
 * Analyze all extracted files for strings that appear in 2+ files, belong to
 * the predefined-common set, or differ only by embedded digits. Returns a map
 * of original string -> common key, plus a parameterized-templates map for
 * number-varying strings.
 *
 * @param {Array<{ filePath: string, extractions: Array<{ original: string }> }>} allFiles
 *   — the extraction results from pass 1
 * @param {object} [config]
 * @param {Set<string>} [config.predefinedCommon] — override the default predefined-common set
 * @param {number} [config.minFileCount]          — min files a string must appear in to auto-promote (default: 2)
 * @returns {{ commonKeys: Map<string, string>, parameterizedTemplates: Map<string, string> }}
 *   - `commonKeys` — Map<originalString, commonDotKey>
 *   - `parameterizedTemplates` — Map<originalString, templateWithPlaceholders>
 */
export function buildCommonKeys(allFiles, config) {
  const predefinedCommon = config?.predefinedCommon ?? DEFAULT_PREDEFINED_COMMON;
  const minFileCount = config?.minFileCount ?? 2;

  /** Map<string, Set<filePath>> -- track which files contain each string */
  const freq = new Map();

  for (const { filePath, extractions } of allFiles) {
    for (const ext of extractions) {
      if (!freq.has(ext.original)) freq.set(ext.original, new Set());
      freq.get(ext.original).add(filePath);
    }
  }

  /** Map<string, string> -- original string -> common.* key */
  const common = new Map();

  // Predefined always-common
  for (const str of predefinedCommon) {
    common.set(str, commonKeyFromString(str));
  }

  // Auto-promote: strings in minFileCount+ files
  for (const [str, files] of freq) {
    if (files.size >= minFileCount && !common.has(str)) {
      common.set(str, commonKeyFromString(str));
    }
  }

  // Number parameterization: strings that differ only by digits should share one key.
  // Group by template (digits -> N), promote groups with 2+ variants.
  const parameterizedTemplates = new Map(); // original -> template with {{n1}} placeholders

  const byTemplate = new Map(); // template -> Set<original>
  for (const { extractions } of allFiles) {
    for (const ext of extractions) {
      if (common.has(ext.original)) continue;
      if (!/\b\d+\b/.test(ext.original)) continue;
      if (!/[a-zA-Z]/.test(ext.original)) continue;
      const tpl = ext.original.replace(/\b\d+\b/g, "N");
      if (!byTemplate.has(tpl)) byTemplate.set(tpl, new Set());
      byTemplate.get(tpl).add(ext.original);
    }
  }
  for (const [tpl, variants] of byTemplate) {
    if (variants.size < 2) continue;
    // Build a parameterized key and template from the pattern
    let varIdx = 0;
    const paramKey = commonKeyFromString(tpl.replace(/N/g, () => "n"));
    const paramTemplate = tpl.replace(/N/g, () => `{{n${++varIdx}}}`);
    for (const original of variants) {
      common.set(original, paramKey);
      // Store the parameterized template for this string
      parameterizedTemplates.set(original, paramTemplate);
    }
  }

  // Resolve key collisions within common.
  // Parameterized variants (same template, different numbers) share one key.
  const usedCommonKeys = new Map(); // key -> canonical string (template or original)
  for (const [str, key] of common) {
    const canonical = parameterizedTemplates.get(str) ?? str;
    const existingCanonical = usedCommonKeys.get(key);
    if (existingCanonical && existingCanonical !== canonical) {
      let newKey = key;
      let suffix = 2;
      while (usedCommonKeys.has(newKey)) {
        newKey = `${key}${suffix}`;
        suffix++;
      }
      common.set(str, newKey);
      usedCommonKeys.set(newKey, canonical);
    } else {
      usedCommonKeys.set(key, canonical);
    }
  }

  return { commonKeys: common, parameterizedTemplates };
}
