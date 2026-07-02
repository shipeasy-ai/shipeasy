# Keys and profiles: the admin surface

Admin (pure-API) operations work over the MCP tools **or** the CLI. Argument
semantics live in the tool descriptions — this reference carries which verb
fits which job and the call shapes the workflow uses.

## The verbs

- Push a batch of NEW keys (insert-only) → `i18n_keys_push`
  (or `shipeasy i18n push <file>`).
- Set one key's value (upsert) and ship it live in a single call →
  `i18n_keys_set`.
- Overwrite one existing key's value (needs the key's id) →
  `i18n_keys_update { id, value }` (or `shipeasy i18n update <key> <value>`).
- Manage locale profiles → `i18n_profiles_list`, `i18n_profiles_create`
  (or `shipeasy i18n profiles list/create`).
- Publish a profile → `i18n_profiles_publish { profileId }`
  (or `shipeasy i18n publish`).
- List staged translation drafts → `i18n_drafts_list`.

## One-shot "change a string and ship it"

To change one string's value AND make it live in a single step, use the
**set-and-publish** tool `i18n_keys_set`:

```
mcp tool: i18n_keys_set { "key": "home.cta", "value": "Get started" }                     # → default profile, published live
mcp tool: i18n_keys_set { "key": "home.cta", "value": "Commencer", "profile": "fr:prod" } # → a named profile
```

Prefer this over `push` + a separate `publish` when you just want to
correct/replace one live string. Upsert/publish semantics and the `profile`
default are in the tool description — single-key edits ship themselves; a
separate `publish` is only needed after a batch `push`.

## Find a key by its value

`i18n_keys_list` searches **both key name and value** via `q`:

```
mcp tool: i18n_keys_list { "q": "Get started" }                            # any profile
mcp tool: i18n_keys_list { "profile_id": "<id>", "q": "Commencer" }        # one profile
```

Use it to locate the key behind a piece of on-screen copy before changing it.

## Pushing and publishing a batch

For one key that should also go **live immediately** (upsert + publish):

```
mcp tool: i18n_keys_set {
  "key": "landing.hero.title",
  "value": "Ship faster with Shipeasy",
  "profile": "en:prod",
  "description": "Hero headline"
}
```

For a batch of NEW keys (insert-only; publish separately), push a flat
`{ "<key>": "<value>" }` JSON file:

```bash
echo '{"landing.hero.title":"Ship faster with Shipeasy"}' > /tmp/keys.json
shipeasy i18n push /tmp/keys.json --profile en:prod --chunk landing
```

(MCP equivalent: `i18n_keys_push { profile_id, chunk, keys: [{ key, value }] }`.)

Then publish the profile:

```
mcp tool: i18n_profiles_publish { "profileId": "<profile id>", "chunk": "landing" }
```

(Or `shipeasy i18n publish --profile en:prod --chunk landing`.) This rebuilds
the KV manifest and purges the CDN cache. Skip this if you used
`i18n_keys_set`, which already publishes.
