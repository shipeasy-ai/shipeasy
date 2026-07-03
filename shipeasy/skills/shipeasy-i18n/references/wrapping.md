# Wrapping user-visible strings

Every user-facing string becomes an i18n translate call — e.g. in JSX,
`<button>Install with Claude</button>` becomes
`<button>{i18n.t("landing.nav.cta", "Install with Claude")}</button>`. The
exact, version-correct call form for this project's SDK language:

{{SDK_SNIPPET:i18n/render}}

## Signature

```ts
i18n.t(
  key: string,
  fallback: string,
  variables?: Record<string, string | number>,
  description?: string,
);
```

## Key naming

`<chunk>.<component>.<element>`

- **chunk** groups related keys so they load in a single CDN fetch (e.g. `landing`, `auth`, `dashboard`, `pricing`).
- **component** is the section or component name (e.g. `hero`, `nav`, `footer`).
- **element** is the specific piece (e.g. `cta`, `title`, `badge`).

Examples: `landing.nav.cta`, `landing.hero.title`, `auth.signin.button`.

## Variables

```tsx
i18n.t("landing.hero.meta_install", "{{seconds}}s install", { seconds: "8" });
```

Stored value: `"{{seconds}}s install"`. Curly braces are placeholders.

## Call `t()` at render time — never at module load

> Applies to component/UI frameworks (React, Vue, Svelte, …). The trap is the
> same in any language with module-level evaluation; the JSX below is the JS/TS
> shape — use the call form from the snippet above for your SDK.

`i18n.t()` must run **during render**, not when a module is first imported.
A call evaluated at import time bakes into a frozen string before translations
have loaded and before the edit-labels devtools can patch `t()` — so the string
**never picks up a live translation** (it's stuck on the fallback / first locale)
**and is not editable** in the click-to-edit devtools overlay.

The classic trap is a module-level config array (sidebar/nav/menu/tab
definitions, command-palette entries, schema field titles):

```tsx
// ❌ WRONG — evaluated once at import, frozen, not translatable/editable
const NAV = [{ to: "/dashboard", label: i18n.t("nav.dashboard", "Dashboard") }];

// ✅ RIGHT — store a thunk, call it during render
const NAV = [{ to: "/dashboard", label: () => i18n.t("nav.dashboard", "Dashboard") }];
// type: label: string | (() => string)
function resolveLabel(l: string | (() => string)) {
  return typeof l === "function" ? l() : l;
}
// in the component: <Item label={resolveLabel(item.label)} />
```

Strings written directly in JSX (`<h1>{i18n.t("page.title", "Title")}</h1>`) are
already render-time and need no change — this only bites pre-computed constants.

## Attributes: only translate what the user reads

> Applies to HTML/JSX templates (web SDKs). Native UI toolkits have the same
> split between user-visible labels and structural identifiers — wrap only the
> former.

Wrap translatable **user-visible** attributes — `aria-label`, `title`,
`placeholder`, `alt`. **Never** wrap structural / reference attributes:
`aria-controls`, `aria-describedby`, `aria-labelledby`, `id`, `for`, `name`,
`role`, `href`, `data-*`. Their values are IDs/relationships, not copy —
translating one breaks the control (a renamed `aria-controls` no longer matches
its panel `id`) and surfaces a junk "label" in the edit-labels overlay.

```tsx
// ❌ aria-controls is an ID reference, not copy
<button aria-controls={i18n.t("nav.submenuId", "submenu-{{id}}", { id })}>
// ✅ leave structural attributes as plain values
<button aria-controls={`submenu-${id}`} aria-label={i18n.t("nav.openMenu", "Open menu")}>
```
