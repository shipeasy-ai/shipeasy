---
name: i18n-translate
description: Machine-translate a project into a new locale — seed a target profile from the source, run Anthropic translation on the draft, then publish
argument-hint: "<target-profile> [--from <source-profile>] [--glossary <term=translation,...>]"
user-invocable: true
---

Stand up a new locale end-to-end: create the target profile seeded from the
source, run Anthropic translation over the draft key-by-key, then publish to
the CDN. This is the only path that exposes the platform's machine-translation
engine — no CLI verb covers it, so it runs through the i18n MCP tools.

Prereq: `.shipeasy` bound; `translations` module enabled
(`/shipeasy:i18n:install`); a populated source profile (default `en:prod`);
an Anthropic API key in the operator's environment (`ANTHROPIC_API_KEY`) —
the key is read locally and **never sent to Shipeasy**.

`<target-profile>` from `$ARGUMENTS` (e.g. `fr:prod`). `--from` sets the
source profile (default `en:prod`).

## Steps

1. **Create the target profile, seeded from the source** (gives you a draft
   of untranslated keys to work on):

   ```
   mcp tool: i18n_create_profile { "name": "<target>", "source_profile": "<source>" }
   ```

   CLI fallback creates the profile but does not seed keys — prefer the MCP
   tool here so there's a draft to translate:

   ```bash
   shipeasy i18n profiles create <target> --locales <locale-of-target>
   ```

2. **Find the draft id** for the target (the seed produced one):

   ```
   mcp tool: i18n_drafts_list
   ```

   If no draft exists (e.g. the profile was created without seeding), create
   one in the dashboard's String Manager for `<target>` — draft creation is a
   dashboard step today — then re-list.

3. **Run the translation** over the draft, key by key:

   ```
   mcp tool: i18n_translate_draft {
     "draft_id":       "<id from step 2>",
     "source_profile": "<source>",
     "target_profile": "<target>",
     "glossary":       [ /* optional: terms to keep verbatim or force */ ],
     "max_parallel":   8
   }
   ```

   `glossary` (from `--glossary term=translation,...`) pins brand names and
   domain terms so the model doesn't paraphrase them.

4. **Review, then publish.** Skim a sample of translated values for obvious
   misses (placeholders like `{count}` preserved, no English left in). Then:

   ```
   mcp tool: i18n_publish_profile { "profile": "<target>" }
   ```

   CLI fallback: `shipeasy i18n publish --profile <target>`.

5. **Wire the locale up** so the app can request it — the loader picks the
   profile via `data-profile` (or the SSR fetch). Point the user at where the
   active profile is selected for their framework; this command does not
   change runtime locale selection.

## Notes

- Translation drafts are **insert-only** at the key level — re-running won't
  clobber human edits made in the dashboard. To change a single translated
  value, use `/shipeasy:i18n:update <key> <value> --profile <target>`.
- Cost + latency scale with key count × locales; `max_parallel` trades speed
  for rate-limit headroom.
- No deletion here — removing a locale/profile is a dashboard action.
