# @shipeasy/sdk i18n Codemod

Modular codemod system for extracting hardcoded strings and wrapping them with `i18n.t()` from `@shipeasy/sdk/client`. Designed for AI-assisted configuration — an AI reads this doc, scans the target project, and generates a `.i18n-codemod.json` config.

## Quick Start

```bash
# 1. Create .i18n-codemod.json (or let AI generate it)
# 2. Run:
node packages/@shipeasy/sdk/codemods/bin.mjs

# Options:
node packages/@shipeasy/sdk/codemods/bin.mjs --dry-run          # preview
node packages/@shipeasy/sdk/codemods/bin.mjs --verbose           # detailed output
node packages/@shipeasy/sdk/codemods/bin.mjs --type jsx-text     # single type
node packages/@shipeasy/sdk/codemods/bin.mjs --migrate react-i18next  # migration
node packages/@shipeasy/sdk/codemods/bin.mjs src/pages/          # target dir
```

## How It Works

1. **Extract** — AST visitors from enabled types find translatable strings with source positions
2. **Deduplicate** — Strings in 2+ files → `common.*` keys; strings differing only by digits → parameterized
3. **Transform** — Position-based replacement preserves formatting; imports injected
4. **Output** — `en.json` translation file (merge mode — safe to re-run)

Converges in ≤2 passes. Fully idempotent on re-run.

---

## Extraction Types

Each type handles one pattern. Enable/configure in `.i18n-codemod.json` under `"types"`.

### `jsx-text`

JSX text children.

| Param              | Type    | Default | Description                           |
| ------------------ | ------- | ------- | ------------------------------------- |
| `skipMixedContent` | boolean | `false` | Skip text nodes with element siblings |

```
Before: <h1>Patients</h1>
After:  <h1>{i18n.t('patients.heading', 'Patients')}</h1>
```

### `jsx-attr`

String attributes on JSX elements.

| Param       | Type     | Default                                                                                                           | Description                |
| ----------- | -------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `attrs`     | string[] | `["label","title","description","placeholder","alt","aria-label","helperText","hint","tooltip"]`                  | Attribute names to extract |
| `skipAttrs` | string[] | `["className","name","key","id","to","href","src","type","variant","size","color","icon","value","role","style"]` | Attribute names to skip    |

```
Before: <TextField label='First name' placeholder='Enter name' />
After:  <TextField label={i18n.t('scope.firstName', 'First name')} placeholder={i18n.t('scope.enterNamePlaceholder', 'Enter name')} />
```

### `call-arg`

String arguments from any `object.method()` call pattern — toast, notification, alert, dialog, or any custom API.

| Param        | Type     | Default                                                    | Description                                                               |
| ------------ | -------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `callee`     | string   | `"toast"`                                                  | Object name (e.g. `"toast"`, `"notification"`, `"Alert"`, `"Dialog"`)     |
| `methods`    | string[] | `["success","error","info","message","loading","warning"]` | Method names whose args contain user-visible text                         |
| `argIndex`   | number   | `0`                                                        | Which argument to extract (0-based)                                       |
| `optionKeys` | string[] | `["description"]`                                          | Keys in the options object (next arg) that also contain translatable text |

```
Before: toast.success('Saved your changes')
After:  toast.success(i18n.t('common.savedYourChanges', 'Saved your changes'))

Before: notification.show('Hello', { body: 'World' })   # callee='notification', methods=['show'], optionKeys=['body']
After:  notification.show(i18n.t('key', 'Hello'), { body: i18n.t('key2', 'World') })
```

### `object-prop`

Object literal values with known translatable keys.

| Param  | Type     | Default                                         | Description                          |
| ------ | -------- | ----------------------------------------------- | ------------------------------------ |
| `keys` | string[] | `["label","title","description","placeholder"]` | Property names to extract values for |

```
Before: { label: 'Dashboard', icon: Home }
After:  { label: i18n.t('common.dashboard', 'Dashboard'), icon: Home }
```

### `default-param`

Default values in destructured parameters.

| Param   | Type     | Default                                                   | Description                                                         |
| ------- | -------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| `names` | string[] | `["label","title","description","text","message","hint"]` | Parameter names (also matches `*Label`, `*Text`, `*Title` suffixes) |

```
Before: function Foo({ label = 'Save changes' }) { ... }
After:  function Foo({ label = i18n.t('common.saveChanges', 'Save changes') }) { ... }
```

### `ternary`

String branches in ternary expressions (both StringLiteral and TemplateLiteral).

| Param  | Type | Default | Description                                                       |
| ------ | ---- | ------- | ----------------------------------------------------------------- |
| (none) |      |         | Extracts both `consequent` and `alternate` branches independently |

```
Before: isNew ? 'Create' : 'Update'
After:  isNew ? i18n.t('common.create', 'Create') : i18n.t('common.update', 'Update')
```

Only extracts when the ternary is in a translatable context (JSX, toast, known variable, object prop).

### `template-literal`

Template literals with interpolated expressions.

| Param  | Type | Default | Description                                                                                       |
| ------ | ---- | ------- | ------------------------------------------------------------------------------------------------- |
| (none) |      |         | Auto-names variables from expressions, wraps member access with `String()`, coalesces `?.` chains |

```
Before: toast.loading(`${actionName}…`)
After:  toast.loading(i18n.t('scope.actionname', '{{actionName}}…', { actionName }))

Before: `Saved ${count} sections`
After:  i18n.t('scope.savedCountSections', 'Saved {{count}} sections', { count })
```

### `fallback`

Nullish coalescing and OR fallback strings.

| Param       | Type     | Default   | Description |
| ----------- | -------- | --------- | ----------- | --- | ------------------- |
| `operators` | string[] | `["??", " |             | "]` | Operators to detect |

```
Before: name ?? 'Unknown patient'
After:  name ?? i18n.t('common.unknownPatient', 'Unknown patient')
```

### `chain-method-arg`

String arguments from chained method calls — works with any validation/builder API (Zod, Yup, Joi, Valibot, custom).

| Param         | Type     | Default                                                                                                  | Description                                                                   |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `methods`     | string[] | `["min","max","length","email","url","regex","uuid","nonempty","trim","startsWith","endsWith","refine"]` | Method names whose trailing string arg is a message                           |
| `argIndex`    | number   | `-1`                                                                                                     | Argument index (-1 = last string arg after non-string args)                   |
| `skipObjects` | string[] | `[]`                                                                                                     | Object names to skip for skipMethods (e.g. `["z"]`)                           |
| `skipMethods` | string[] | `["literal","enum","discriminatedUnion","nativeEnum"]`                                                   | Methods that define schema shape — their string args are values, not messages |

```
Before: z.string().min(1, 'Email is required')
After:  z.string().min(1, i18n.t('scope.emailIsRequired', 'Email is required'))

Before: yup.string().email('Invalid email')     # same type, no config change needed
After:  yup.string().email(i18n.t('key', 'Invalid email'))
```

### `variable-init`

Variable initializers with text-like names.

| Param     | Type           | Default                                                                 | Description                   |
| --------- | -------------- | ----------------------------------------------------------------------- | ----------------------------- |
| `pattern` | string (regex) | `"[Ll]abel\|[Tt]ext\|[Tt]itle\|[Mm]essage\|[Dd]escription\|[Hh]eading"` | Regex to match variable names |

```
Before: const errorMessage = 'Something went wrong'
After:  const errorMessage = i18n.t('scope.somethingWentWrong', 'Something went wrong')
```

### `array-element`

String elements in named arrays.

| Param     | Type           | Default                                                  | Description                         |
| --------- | -------------- | -------------------------------------------------------- | ----------------------------------- |
| `pattern` | string (regex) | `"headers?\|columns?\|labels?\|options?\|items?\|tabs?"` | Regex to match array variable names |

```
Before: const CSV_HEADERS = ['Name', 'Email', 'Phone']
After:  const CSV_HEADERS = [i18n.t('common.name', 'Name'), i18n.t('common.email', 'Email'), i18n.t('common.phone', 'Phone')]
```

---

## Migration Plugins

Convert existing i18n library usage to `@shipeasy/sdk`. Enable in config: `"migrate": { "from": "react-i18next" }`.

### `react-i18next`

| Source                                        | Target                                  |
| --------------------------------------------- | --------------------------------------- |
| `const { t } = useTranslation()` + `t('key')` | `i18n.t('key', fallback)`               |
| `t('key', { defaultValue: '...' })`           | `i18n.t('key', '...')`                  |
| `t('key', { count: n })`                      | `i18n.t('key', fallback, { count: n })` |
| `<Trans i18nKey="key">fallback</Trans>`       | `{i18n.t('key', 'fallback')}`           |

Removes `useTranslation` import and hook call. Reads existing `public/locales/en/*.json` for fallback text.

### `react-intl`

| Source                                                               | Target                           |
| -------------------------------------------------------------------- | -------------------------------- |
| `<FormattedMessage id="key" defaultMessage="text" />`                | `{i18n.t('key', 'text')}`        |
| `<FormattedMessage id="key" defaultMessage="text" values={{ n }} />` | `{i18n.t('key', 'text', { n })}` |
| `intl.formatMessage({ id: 'key', defaultMessage: 'text' })`          | `i18n.t('key', 'text')`          |

Removes `useIntl`/`injectIntl` and `FormattedMessage` imports.

### `lingui`

| Source                     | Target                                      |
| -------------------------- | ------------------------------------------- |
| `` t`Hello ${name}` ``     | `i18n.t('key', 'Hello {{name}}', { name })` |
| `<Trans>Some text</Trans>` | `{i18n.t('key', 'Some text')}`              |
| `i18n._(msg)`              | `i18n.t(msg.id, msg.message)`               |

Auto-generates keys from content when Lingui used content-based keys.

### `next-intl`

| Source                                         | Target                                         |
| ---------------------------------------------- | ---------------------------------------------- |
| `const t = useTranslations('ns')` + `t('key')` | `i18n.t('ns.key', fallback)`                   |
| `t('key', { name })`                           | `i18n.t('ns.key', fallback, { name })`         |
| `t.rich('key', { bold: ... })`                 | `i18n.rich('ns.key', fallback, { bold: ... })` |

Reads `messages/en.json` for fallback text. Preserves namespace prefixes.

### `raw-i18next`

| Source                                      | Target                    |
| ------------------------------------------- | ------------------------- |
| `i18next.t('key')`                          | `i18n.t('key', fallback)` |
| `i18next.t('key', { defaultValue: '...' })` | `i18n.t('key', '...')`    |

Reads existing i18next translation files for fallback text.

---

## Config Schema (`.i18n-codemod.json`)

```jsonc
{
  // Import path for the i18n module
  "sdk": "@shipeasy/sdk/client",

  // Function name to use in generated code
  "function": "i18n.t",

  // Source directory to scan
  "srcDir": "src",

  // Output translation JSON file (merged on each run)
  "outputJson": "src/i18n/en.json",

  // Glob patterns of files to skip
  "skipFiles": [
    "**/*.test.*",
    "**/*.spec.*",
    "**/__tests__/**",
    "**/__generated__/**",
    "**/*.d.ts",
  ],

  // Enable/configure extraction types (true = defaults, object = custom params)
  "types": {
    "jsx-text": true,
    "jsx-attr": { "attrs": ["label", "title", "description", "placeholder"] },
    "call-arg": { "callee": "toast", "methods": ["success", "error", "info"] },
    "object-prop": true,
    "default-param": true,
    "ternary": true,
    "template-literal": true,
    "fallback": true,
    "chain-method-arg": { "methods": ["min", "max", "email"] },
    "variable-init": true,
    "array-element": true,
  },

  // JSX attributes to skip (never extract)
  "skipAttrs": [
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
    "role",
    "style",
  ],

  // Function calls to skip — keys are object names, values are method lists
  "skipCalls": {
    "i18n": ["t", "rich"], // already translated (idempotency)
    "console": ["log", "warn", "error"], // debug output
  },

  // Standalone functions to skip — their string args are not user text
  "skipFunctions": ["cn", "clsx", "require", "navigate", "redirect"],

  // String/array methods to skip — args are patterns, not text
  "skipMethods": ["includes", "indexOf", "replace", "split", "match"],

  // Strings to never translate
  "skipStrings": ["GET", "POST", "PUT", "DELETE"],

  // Deduplication settings
  "dedup": {
    "threshold": 2,
    "predefined": ["Save", "Cancel", "Delete", "Close", "Edit", "Done"],
  },

  // Directories treated as containers (stripped from scope path)
  "containerDirs": ["pages", "components", "features"],

  // Migration from another framework (null = no migration)
  "migrate": {
    "from": "react-i18next",
    "translationFiles": ["public/locales/en/translation.json"],
  },
}
```

---

## AI Integration Guide

To generate a config for a new project, an AI should:

1. **Read `package.json`** — detect installed i18n libraries (react-i18next, react-intl, etc.)
2. **Read directory structure** — identify `src/` layout, route patterns, component structure
3. **Sample 5-10 component files** — identify string patterns (toast library, form props, etc.)
4. **Generate `.i18n-codemod.json`** — enable relevant types with project-specific params
5. **If migrating** — set `"migrate"` with the source framework and translation file paths

### Example: React + Tailwind + sonner + Zod

```json
{
  "types": {
    "jsx-text": true,
    "jsx-attr": { "attrs": ["label", "title", "description", "placeholder", "alt", "aria-label"] },
    "call-arg": { "callee": "toast", "methods": ["success", "error", "info", "loading"] },
    "chain-method-arg": {
      "methods": ["min", "max", "email", "url"],
      "skipMethods": ["literal", "enum"]
    },
    "object-prop": true,
    "default-param": true,
    "ternary": true,
    "template-literal": true,
    "fallback": true
  },
  "skipFunctions": ["cn", "clsx", "navigate", "redirect"]
}
```

### Example: Vue + Vuetify + vue-toastification + Yup

```json
{
  "srcDir": "src",
  "types": {
    "jsx-text": false,
    "jsx-attr": false,
    "call-arg": { "callee": "toast", "methods": ["success", "error", "warning", "info"] },
    "chain-method-arg": {
      "methods": ["min", "max", "email", "required", "matches"],
      "skipMethods": []
    },
    "object-prop": { "keys": ["label", "title", "text", "message", "placeholder"] },
    "template-literal": true,
    "fallback": true,
    "variable-init": { "pattern": "label|text|title|message|hint|placeholder" }
  },
  "skipFunctions": ["h", "createVNode", "resolveComponent"]
}
```

### Example: Next.js migrating from next-intl

```json
{
  "srcDir": "app",
  "outputJson": "messages/en.json",
  "types": { "jsx-text": true, "jsx-attr": true, "template-literal": true },
  "migrate": { "from": "next-intl", "translationFiles": ["messages/en.json"] }
}
```

### Example: Vanilla JS dashboard (no JSX)

```json
{
  "srcDir": "src",
  "types": {
    "jsx-text": false,
    "jsx-attr": false,
    "call-arg": { "callee": "notify", "methods": ["show", "alert"], "argIndex": 0 },
    "object-prop": { "keys": ["label", "title", "message", "text", "placeholder"] },
    "template-literal": true,
    "variable-init": true,
    "array-element": true
  },
  "skipFunctions": ["document.querySelector", "fetch", "addEventListener"]
}
```

---

## SDK API Reference

The codemod generates calls to these `@shipeasy/sdk/client` functions:

```ts
import { i18n } from '@shipeasy/sdk/client'

// Basic translation — returns string, preserves literal type via generic
i18n.t<F extends string>(key: string, fallback: F, variables?: Record<string, string | number | null | undefined>): F

// Rich text — parses <tag>content</tag> in the value, calls component renderers
// Returns string (all renderers return strings) or Array<string | T> (mixed)
i18n.rich(key: string, fallback: string, components?: Record<string, (content: string) => any>, variables?: I18nVariables): any

// Global config — override default HTML tag renderers
i18n.configure({ components: { a: (text) => <Link>{text}</Link> } })
```

Built-in HTML tag renderers (browser: `document.createElement`, SSR: HTML strings):
`b`, `i`, `u`, `s`, `em`, `strong`, `del`, `ins`, `mark`, `small`, `code`, `pre`, `kbd`, `sub`, `sup`, `span`, `a`, `p`, `br`, `hr`
