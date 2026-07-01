---
name: shipeasy-i18n-translate
description: Machine-translate a project into a new locale — seed a target profile from the source, run Anthropic translation on the values, then publish
argument-hint: "<target-profile> [--from <source-profile>] [--glossary <term=translation,...>]"
user-invocable: true
---

Stand up a new locale end-to-end: create the target profile, pull the source
profile's keys, translate every value with Anthropic (locally, in this agent),
push the translated values, then publish to the CDN.

There is **no single MCP tool or CLI verb** for the machine-translation step —
this skill orchestrates it over the i18n MCP tools (`i18n_profiles_create`,
`i18n_keys_list`, `i18n_keys_push`, `i18n_profiles_publish`) plus an Anthropic
call you make yourself.

Prereq: `.shipeasy` bound; the `shipeasy` MCP server available (this workflow
runs through the `i18n_*` tools); a populated source profile (default `en:prod`);
an Anthropic API key in the operator's environment (`ANTHROPIC_API_KEY`) —
the key is read locally and **never sent to Shipeasy**.

`<target-profile>` from `$ARGUMENTS` (e.g. `fr:prod`). `--from` sets the
source profile (default `en:prod`).

## Steps

1. **Create the target profile** for the new locale:

   ```
   mcp tool: i18n_profiles_create { "name": "<target>" }
   ```

   The locale is encoded in the profile handle (e.g. `fr:prod`) — there are no
   separate locale fields. (CLI equivalent: `shipeasy i18n profiles create <target>`.)

2. **Pull the source keys** to translate. List the source profile and capture
   each key's `key` + `value`:

   ```
   mcp tool: i18n_profiles_list                                   # find the source profile id
   mcp tool: i18n_keys_list { "profile_id": "<source profile id>", "limit": 500 }
   ```

   Page with `prefix`/`limit` if the source has more than 500 keys.

3. **Translate the values locally.** For each source value, produce the target
   translation with Anthropic — this is your own model call, run in this agent;
   the source strings never leave the local environment. Preserve every
   placeholder verbatim (`{{count}}`, `{name}`, `%s`, etc.) and honour any
   `--glossary term=translation,...` pairs (pin brand names / domain terms so
   the model doesn't paraphrase them).

4. **Push the translated values** into the target profile (insert-only — this
   never clobbers human edits already made there):

   ```
   mcp tool: i18n_keys_push {
     "profile_id": "<target profile id>",
     "keys": [ { "key": "home.cta", "value": "Commencer" }, … ]
   }
   ```

   To overwrite a single already-translated value later, use
   `i18n_keys_set { key, value, profile: "<target>" }` (upsert + publish) or
   `shipeasy i18n update <key> <value> --profile <target>`.

5. **Review, then publish.** Skim a sample of translated values for obvious
   misses (placeholders preserved, no source-language text left in). Then
   publish profile-wide:

   ```
   mcp tool: i18n_profiles_publish { "profileId": "<target profile id>" }
   ```

   CLI fallback: `shipeasy i18n publish --profile <target>`.

6. **Wire the locale up** so the app can request it — the loader picks the
   profile via `data-profile` (or the SSR fetch). Point the user at where the
   active profile is selected for their framework; this skill does not
   change runtime locale selection.

## Notes

- `i18n_keys_push` is **insert-only** — re-running won't clobber human edits.
  To change a single translated value, use `i18n_keys_set` (upsert + publish)
  or `shipeasy i18n update <key> <value> --profile <target>`.
- Cost + latency scale with key count × locales; batch your Anthropic calls and
  cap parallelism to stay within rate limits.
- No deletion here — removing a locale/profile is a dashboard action.
