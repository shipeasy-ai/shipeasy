---
description: Run the Shipeasy base install — SDK, auth, project bind, keys, root-layout init, MCP registration.
argument-hint: "[--domain <production-domain>]"
---

Run end-to-end Shipeasy base onboarding. Follow the `shipeasy-setup` skill
step by step. Do not skip the verification gates.

Steps in brief (full detail in the skill):

1. Preconditions: Node ≥20, inside a git repo. Detect framework.
2. `pnpm add @shipeasy/sdk @shipeasy/react`.
3. `shipeasy login` → `shipeasy projects upsert --domain <domain>` (writes
   `.shipeasy`; commit it).
4. `shipeasy keys create --type server` + `--type client`.
5. Persist keys to the right secret store (`.env.local`, Wrangler secret,
   Vercel env, etc.). Never commit the server key.
6. Edit `app/layout.tsx` to call `shipeasy({...})` and render
   `getBootstrapHtml()` into `<head>`.
7. Verify: `shipeasy whoami`, `shipeasy keys list`, `pnpm build`.
8. Print the hand-off report and stop. **Do not run `git commit`.**

When done, tell the user which feature plugins to install next:

```
claude plugin install shipeasy@experiments-metrics
claude plugin install shipeasy@configs-gates
claude plugin install shipeasy@polylang
claude plugin install shipeasy@bugs
```
