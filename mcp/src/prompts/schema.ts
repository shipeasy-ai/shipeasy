import type { Prompt } from "@modelcontextprotocol/sdk/types.js";

/**
 * Workflow playbooks exposed via MCP `prompts`. See packages/mcp/README.md
 * § "Prompts" for the full list.
 */
export const PROMPTS: Prompt[] = [
  {
    name: "setup_experimentation",
    description: "Install the SDK, add env keys, wire a provider, verify with a sample gate.",
  },
  {
    name: "create_experiment",
    description: "Propose → create → inject code → start → monitor an A/B experiment.",
  },
  {
    name: "analyze_experiment",
    description: "Pull results, compute lift + significance, emit ship/hold/wait verdict.",
  },
  {
    name: "cleanup_winner",
    description: "Remove losing branches + dead gate code after shipping a winner.",
  },
  {
    name: "setup_i18n",
    description: "Install SDK + loader script, create en:prod, run codemod, wire hooks, validate.",
  },
  {
    name: "translate_site",
    description: "Given a URL: discover, add target locale, translate, review, publish.",
  },
  {
    name: "i18n_health",
    description: "Report missing keys, unused keys, drift between profiles.",
  },
  {
    name: "rotate_sdk_keys",
    description: "Revoke + re-issue client/server keys and update env vars.",
  },
];

const SETUP_I18N_BODY = `# setup_i18n

End-to-end shipeasy i18n onboarding for a codebase. Run these steps in order. If any step errors, surface it to the user before continuing.

## 1. Detect + auth
- Call \`detect_project\` on the target app path. Note the framework (nextjs/react/etc), whether the loader script is installed, and whether the i18n SDK is already present.
- Call \`auth_check\`. If not authenticated, tell the user to run \`shipeasy auth login\` and stop.

## 2. Source profile
- Call \`list_resources(kind="profiles")\`. If \`en:prod\` is missing, call \`i18n_create_profile(name="en:prod")\`.

## 3. Loader script
- If \`detect_project\` says the loader script is not installed, call \`i18n_install_loader(profile="en:prod")\` and apply the returned snippet to the framework's root HTML / layout.

## 4. Scan + codemod preview
- Call \`i18n_scan_code(paths=[<src root>])\` and report \`total_candidates\`.
- Call \`i18n_codemod_preview(framework=<detected>, files=[<src root>])\`. The response summarizes \`files_changed\`, \`total_strings\`, and a \`chunks\` map (e.g. \`common: 40, app.dashboard.gates: 25\`).
- Confirm with the user before applying. If they approve:

## 5. Apply codemod
- Call \`i18n_codemod_apply(framework=<detected>, files=[<src root>], confirm=true)\`.

The codemod does three things per file:
1. Replaces translatable strings with \`{t("<chunk>.<slug>")}\`. Chunks are auto-assigned: repeated strings (≥3 files) go to \`common\`; the rest go to a per-folder chunk named after the deepest ancestor folder that accumulates ≥10 keys.
2. Adds \`import { useShipEasyI18n } from "@shipeasy/i18n-react"\`.
3. Inserts a marker comment: \`// TODO: add \\\`const { t } = useShipEasyI18n();\\\` inside your component\`.

It also writes \`i18n-codemod-review.json\` with the shape \`{ version: 2, chunks: { <chunk>: { <key>: <value> } } }\`.

## 6. Wire the \`t\` hook (REQUIRED — do not skip)

For every file the codemod touched, the \`// TODO: add \`const { t } = useShipEasyI18n();\`\` marker must be resolved before the app will compile. Grep for that marker across the repo and process each hit:

1. Decide client vs. server component for the file:
   - **Client**: the file (or an ancestor layout) has \`"use client"\` at the top, or the component uses hooks / event handlers.
   - **Server**: no \`"use client"\`, component may be \`async\`, rendered on the server (common in Next.js App Router \`page.tsx\` / \`layout.tsx\`).

2. For each component function inside the file that contains \`t(...)\` calls:
   - **Client component**: insert \`const { t } = useShipEasyI18n();\` as the first statement of the function body (after any early-return guards that don't touch \`t\`).
   - **Server component**: replace the \`useShipEasyI18n\` import with \`import { getShipEasyI18n } from "@shipeasy/i18n-react/server";\` and use \`const t = await getShipEasyI18n();\` as the first statement. Make the function \`async\` if it isn't already.
   - If a file mixes both (rare — a server component renders an inline client helper), split the helper into a \`"use client"\` file.

3. Delete the \`// TODO: add ...\` comment line once \`t\` is wired.

4. Run \`pnpm --filter <workspace> type-check\` after wiring a batch of files to catch missed components early.

## 7. Sweep for strings the codemod missed

The AST walker only picks up JSX text and a fixed list of string attributes (\`label\`, \`title\`, \`placeholder\`, \`description\`, \`alt\`, \`aria-label\`, \`caption\`, \`heading\`, \`tooltip\`, \`helperText\`, \`errorMessage\`). Everything else is your problem. Grep the repo for:

- Toast / notification calls: \`toast(\`, \`notify(\`, \`message.success(\`, etc. with string literals.
- Thrown errors and validation messages: \`throw new Error("...")\`, \`z.string().min(1, "...")\`, Conform form error strings.
- Template literals with user-visible text: \`\\\`Welcome, \${name}!\\\`\` — extract the static parts.
- String props not in the codemod list: \`<Tooltip content="...">\`, \`<Select.Item>…</Select.Item>\`, \`<Badge>…</Badge>\`, confirmation dialog copy.
- \`console.warn\` / \`console.error\` strings that end up in a UI surface (e.g. dev-tools banners).

For each missed string:
- Decide its chunk: \`common.<slug>\` if it repeats across files, otherwise match the chunk the enclosing page already uses (look at the other \`t(\`...\`)\` calls in the same file).
- Call \`i18n_create_key(profile="en:prod", chunk=<chunk>, key=<chunk>.<slug>, value=<text>)\`.
- Replace the literal in code with \`t("<chunk>.<slug>")\`.

Do not stop this sweep at "looks done" — do one full pass of \`grep -rn '"[A-Z][a-z].*[a-z]"' <src>\` over the source root and triage every hit before moving on.

## 8. Push to shipeasy

- Call \`i18n_push_keys(profile="en:prod", source="codemod")\`. It reads \`i18n-codemod-review.json\` and uploads each chunk in one batch. The response includes a \`chunks\` summary.
- For any keys you created via \`i18n_create_key\` in step 7, those are already server-side — no extra push needed.

## 9. Validate

- Call \`i18n_validate_keys(paths=[<src root>], profile="en:prod")\`. If it reports missing keys, those are \`t("...")\` references that have no server-side row yet. Create them with \`i18n_create_key\` and re-run. Repeat until green.

## 10. Publish

- Call \`i18n_publish_profile(profile="en:prod")\` (omit \`chunk\` to publish every chunk). This rebuilds the KV manifest and purges the CDN.

## 11. Verify

- Reload the app. Confirm translations render. Type-check and run the test suite one more time.

Onboarding is complete.
`;

export const PROMPT_BODIES: Record<string, string> = Object.fromEntries(
  PROMPTS.map((p) => [
    p.name,
    `# ${p.name}\n\nThis playbook is not implemented yet. See packages/mcp/README.md § Prompts for the planned steps.`,
  ]),
);

PROMPT_BODIES.setup_i18n = SETUP_I18N_BODY;
