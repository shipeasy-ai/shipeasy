---
name: i18n-profiles
description: List or create i18n locale profiles (e.g. en:prod, fr:prod) for the bound project
argument-hint: "[list] | [create <name> [--locales <csv>] [--default-locale <locale>] [--from <source-profile>]]"
user-invocable: true
---

Manage the project's i18n **locale profiles** — the named buckets keys live
in (`en:prod`, `fr:prod`, `en:staging`, …). The primary profile is
`en:prod`; add more to ship additional locales.

Prereq: `.shipeasy` bound; `translations` module enabled
(`/shipeasy:i18n:install`).

## List

```bash
shipeasy i18n profiles list          # table: name, default locale, locales, id
shipeasy i18n profiles list --json
```

## Create

Default sub-action when `$ARGUMENTS` starts with `create <name>`:

```bash
shipeasy i18n profiles create <name> \
  [--locales en,fr,de] \
  [--default-locale en]
```

- `<name>` is the profile name (convention: `<locale>:<env>`, e.g.
  `fr:prod`). `--locales` defaults to `en`; `--default-locale` defaults to
  the first locale.
- MCP equivalent (clones keys from an existing profile so you have something
  to translate): `i18n_create_profile { "name": "fr:prod", "source_profile": "en:prod" }`.
  Use `--from <source-profile>` to do the same via the wizard — seed the new
  profile's keys from an existing one.

## After creating a translation target

Creating `fr:prod` from `en:prod` gives you an untranslated draft. To
machine-translate it and publish, use `/shipeasy:i18n:translate fr:prod`.

Note: this command never deletes a profile — removing a profile is a UI-only
action in the dashboard.
