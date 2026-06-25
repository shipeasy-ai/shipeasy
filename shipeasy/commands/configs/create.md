---
name: configs-create
description: Create a Shipeasy dynamic config (typed JSON value with targeting)
argument-hint: "<config-name> [json-default]"
user-invocable: true
---

Create or update a Shipeasy dynamic config. Follow the `flags` skill.

A config returns a **typed JSON object** (object-only — top-level
must be `{}`). For boolean on/off, use a feature gate
(`/shipeasy:flags:create`) instead.

Defaults:

- `value`: initial JSON object the SDK returns. Defaults to `{}` if
  omitted, which is rarely what you want.
- `schema`: JSON Schema (must have top-level `type=object`) the admin
  API validates updates against. Defaults to a permissive object schema.
- No targeting unless the user specifies attributes.

Steps:

1. Decide the **shape** of the value first. The shape is contract; once
   call sites consume it, changing keys/types is a breaking change.
   Example: `{ "max_items": 10, "show_banner": false }`.

2. If MCP is registered, use `exp_create_config` for typed errors.
   **Both `value` and `schema` are JSON-encoded strings**, not raw JSON
   objects:

   ```
   mcp tool: exp_create_config {
     "name":   "<name>",
     "value":  "{\"max_items\":10,\"show_banner\":false}",
     "schema": "{\"type\":\"object\",\"properties\":{...}}"   // optional
   }
   ```

3. Otherwise the CLI (positional `<name>`):

   ```bash
   shipeasy configs create <name> \
     --value  '<json-value>' \
     [--schema '<json-schema>']
   ```

4. Show the user the SDK call sites they need to add:

   ```ts
   import { configs } from "@shipeasy/sdk/server"; // or /client
   const value = await configs.get("<name>", <same-shape fallback>);
   //         ^ value is typed by the fallback you pass — the second arg
   //           also doubles as the runtime default if KV is unreachable.
   ```

5. Remind: configs are **read-many, write-rare**. They're not a runtime
   API — every read goes through KV; updates trigger an explicit purge.
   Don't reach for a config when a boolean gate or a code-side constant
   does the job.
