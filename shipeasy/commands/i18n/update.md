---
description: Change the value of one existing i18n key (the only overwrite path — push/extract are insert-only)
argument-hint: "<key> <new-value> [--profile <name>] [--description <text>]"
---

Update the value of a **single existing** key in a profile. This is the
only way to change a published string from the CLI: `push` and
`/shipeasy:i18n:extract` are **insert-only** (they add new keys and skip
any that already exist — they never overwrite). To edit copy, you change
one key at a time here.

Prereq: `.shipeasy` bound; `translations` module enabled; the key already
exists (add it first with `/shipeasy:i18n:extract` or a push if not).

Steps:

1. Update the value (profile defaults to `en:prod` if the user didn't pass
   one — confirm which profile they mean if ambiguous):

   ```bash
   shipeasy i18n update "<key>" "<new value>" \
     --profile en:prod \
     [--description "<context for translators>"]
   ```

   The CLI resolves the key by exact name within the profile and rejects if
   it doesn't exist (telling you to `push` it first).

2. **Publish** so the change reaches the CDN (update writes the value;
   publish rebuilds the KV manifest + purges cache):

   ```bash
   shipeasy i18n publish --profile en:prod
   ```

3. If the user is changing the same key across multiple locales, repeat per
   profile (`en:prod`, `fr:prod`, …) — values are per-profile.

Notes:

- One key per call. For a brand-new key, use `/shipeasy:i18n:extract`
  (wrap-and-push) instead — `update` refuses unknown keys.
- SSR caches strings briefly; an edit can take up to ~60s to show even
  after publish (the SDK's in-memory SSR cache TTL), independent of the CDN
  purge.
