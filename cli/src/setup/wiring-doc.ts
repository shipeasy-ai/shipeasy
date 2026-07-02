/**
 * Generates `shipeasy-wiring.md` — the complete, self-contained instructions
 * for the NON-deterministic remainder of onboarding (entry-point SDK wiring,
 * idiomatic secret stores, devtools overlay injection, see() error reporting).
 *
 * The document is written for ANY coding agent / AI harness: it references
 * only shell commands, file paths, and the version-correct `shipeasy docs`
 * pages — no agent-specific tools, slash commands, or model assumptions. A
 * human can follow it too. Key VALUES never appear here (they live in each
 * target's gitignored env file); the doc references var names only.
 */

export interface WiringTarget {
  /** Path relative to the repo root ("." for the root itself). */
  relPath: string;
  language: string;
  /** `shipeasy docs` sdk handle (typescript, python, …). */
  sdk: string;
  frameworks: string[];
  packageManager: string;
  entryPoints: string[];
  /** Whether the CLI already ran the package install for this target. */
  sdkInstalled: boolean;
  /** Install command left to run when the CLI deferred it. */
  installCmd: string | null;
  /** The SDK's `installation` doc, fetched at setup time and embedded inline. */
  installationDoc: string | null;
  /** Env file (relative to the target) holding the minted key values. */
  envFile: string;
  /** Var NAMES persisted there (never values). */
  envVars: string[];
  /** Idiomatic secret store when it isn't the env file (move step), else null. */
  secretStoreMove: string | null;
  /** Browser-exposed target → also wire the client side. */
  browser: boolean;
}

export interface WiringDocInput {
  projectId: string;
  targets: WiringTarget[];
  devtools: { clientKeyVar: string; projectIdVar: string } | null;
  /** Module groups already enabled server-side by the CLI (flags/i18n/ops). */
  enabledFeatures: string[];
  /**
   * Language-correct doc snippets fetched at setup time for the primary SDK, so
   * the feature sections embed real example calls/interfaces instead of any
   * framework-specific guess. Null when the SDK doesn't publish that page.
   */
  featureDocs?: { i18n?: string | null; errorReporting?: string | null };
  /** JS/TS targets to build-verify at the end. */
  buildTargets: string[];
}

/** Embed a fetched doc snippet under a marker, or a `docs get` fallback line. */
function embeddedDocOr(
  label: string,
  sdk: string,
  page: string,
  doc: string | null | undefined,
): string {
  if (doc && doc.trim()) {
    return [
      `<!-- BEGIN ${label} doc (sdk: ${sdk}) — source of truth; copy calls from here -->`,
      doc.trim(),
      `<!-- END ${label} doc -->`,
    ].join("\n");
  }
  return `Pull the language-correct example: \`shipeasy docs get --sdk ${sdk} ${page}\` (or \`docs list --sdk ${sdk}\` if the page name differs). Copy the exact calls from there.`;
}

const OPERATING_RULES = `## Operating rules (follow exactly)

1. Run every shell command yourself; do not ask the user to run commands.
2. **Never print, log, echo, or commit a key value** — anything matching
   \`sdk_server_*\` or \`sdk_client_*\`. Reference env var NAMES only. The values
   are already persisted in each target's gitignored env file.
3. **Never \`git commit\`, \`git push\`, or publish.** Stop at "ready to commit"
   and hand the exact \`git add\` file list to the user.
4. **Initialise the SDK once per runtime, at the app's entry point.** Do not
   create wrapper/helper/util files to hold SDK initialisation — the SDK owns
   its own init. (The exact init call is language-specific — take it from the
   embedded installation doc, not from memory.)
5. **These notes are framework-agnostic on purpose.** Copy every concrete call,
   import, class, and interface from the embedded docs below (or fetch more with
   \`shipeasy docs get --sdk <lang> <page>\` / \`docs list --sdk <lang>\`) — the
   per-language docs are the source of truth and **win on any conflict**.
6. Each step has a verification gate — do not advance past a failing gate.
   Self-heal once, then stop and report the failure.
7. If a \`shipeasy\` command fails with \`unknown command\`/\`400\`/\`404\`, suspect
   version drift: \`npm i -g @shipeasy/cli@latest\` and retry once before
   treating it as a bug.`;

function targetSection(i: number, t: WiringTarget): string {
  const dir = t.relPath === "." ? "the repo root" : `\`${t.relPath}/\``;
  const fw = t.frameworks.length ? ` · ${t.frameworks.join(", ")}` : "";
  const lines: string[] = [`### Target ${i + 1}: ${dir} (${t.language}${fw})`, ""];

  if (!t.sdkInstalled && t.installCmd) {
    lines.push(
      `- [ ] Install the SDK (the CLI could not run this one mechanically):`,
      `      in \`${t.relPath}/\`, ${t.installCmd}`,
    );
  } else {
    lines.push(`- [x] SDK package installed (done by \`shipeasy setup\`).`);
  }

  lines.push(
    `- [x] Keys minted and persisted: ${t.envVars.map((v) => `\`${v}\``).join(", ")} in \`${t.relPath}/${t.envFile}\` (gitignored).`,
  );

  if (t.secretStoreMove) {
    lines.push(
      `- [ ] Move the key value(s) from \`${t.relPath}/${t.envFile}\` to the idiomatic store:`,
      `      ${t.secretStoreMove}`,
      `      Then delete the moved lines from \`${t.envFile}\` (keep any browser-public vars where the bundler reads them).`,
    );
  }

  if (t.installationDoc) {
    lines.push(
      `- [ ] Follow this target's installation doc — **pulled for you below** (sdk: \`${t.sdk}\`).` +
        ` The \`shipeasy-${t.sdk}\` SDK skill was also installed into your agent(s).`,
      "",
      `<!-- BEGIN installation doc (sdk: ${t.sdk}) — source of truth for this target -->`,
      t.installationDoc.trim(),
      `<!-- END installation doc -->`,
      "",
    );
  } else {
    lines.push(
      `- [ ] Pull this target's version-correct installation doc and follow it:`,
      `      \`cd ${t.relPath} && shipeasy docs get --sdk ${t.sdk} installation\``,
    );
  }
  lines.push(
    `- [ ] Initialise the SDK once at the app's startup entry point, reading the` +
      ` server key from \`SHIPEASY_SERVER_KEY\`; then create a per-user client for each` +
      ` evaluation. Copy the exact init call, class, and imports from the doc above` +
      ` (prefer a framework generator when the doc lists one).`,
  );
  if (t.entryPoints.length) {
    lines.push(`      Detected entry point(s): ${t.entryPoints.map((e) => `\`${e}\``).join(", ")}.`);
  }
  if (t.browser) {
    lines.push(
      `- [ ] Also initialise the browser SDK once at client startup with the PUBLIC client` +
        ` key (\`${t.envVars.find((v) => v.includes("CLIENT")) ?? "SHIPEASY_CLIENT_KEY"}\`), per the same doc.` +
        ` Never pass the server key to the client entrypoint (or vice versa).`,
    );
  }
  lines.push(
    `- [ ] Gate: the app builds/boots cleanly with the SDK wired` +
      ` (${buildHint(t)}, or the project's usual dev command).`,
    "",
  );
  return lines.join("\n");
}

function buildHint(t: WiringTarget): string {
  if (t.language === "typescript" || t.language === "javascript") {
    const pm = t.packageManager !== "unknown" ? t.packageManager : "npm";
    return `\`${pm} run build\``;
  }
  return "the project's build/test command";
}

function devtoolsSection(d: NonNullable<WiringDocInput["devtools"]>): string {
  return `## Devtools overlay (user accepted — wire it)

A platform-agnostic \`<script>\` tag: an in-page panel (\`?se=1\` or Shift+Alt+S)
listing every gate/config/experiment/translation with per-session overrides;
it is also the end-user bug/feature report surface.
Docs: https://docs.shipeasy.ai/feedback/devtools

- [ ] Add to every browser target's HTML shell / root layout:

  \`\`\`html
  <script src="https://cdn.shipeasy.ai/se-devtools.js"
    data-client-api-key="<value of ${d.clientKeyVar}>" data-project-id="<value of ${d.projectIdVar}>"></script>
  \`\`\`

  Read both attributes from env (\`${d.clientKeyVar}\`, \`${d.projectIdVar}\`) —
  never hardcode them. Serve the script however this app injects markup into its
  HTML shell (source it locally in dev, the CDN URL in prod). The client key is
  public by design; this is not a secret leak.
- [ ] Gate: load the app with \`?se=1\` and confirm the overlay mounts.
`;
}

function opsSection(sdk: string, doc: string | null | undefined): string {
  return `## Ops wiring — error reporting (ops module enabled)

The \`shipeasy-ops\` skill was installed into your agent(s) — use it for the full
walkthrough. In brief:

- [ ] Report errors through the SDK's error primitive at meaningful failure
      points. Use the exact call from the doc for this target's language:

${embeddedDocOr("error-reporting", sdk, "error-reporting", doc)}

- [ ] Gate: \`shipeasy ops list --type bug\` succeeds (queue reachable).
`;
}

function i18nSection(sdk: string, doc: string | null | undefined): string {
  return `## Translations (i18n) wiring — module enabled

The \`shipeasy-i18n\` skill was installed into your agent(s) — follow it for the
full flow. In brief:

- [ ] **Already using an i18n library?** (react-i18next, react-intl, lingui,
      next-intl, raw-i18next) Migrate it in one shot: \`shipeasy i18n migrate <library>\`
      (add \`--dry-run\` first). It verifies this project's language/framework is
      supported and fails with guidance if not.
- [ ] **Greenfield?** Try the extractor: \`shipeasy i18n extract\` (add \`--dry-run\`
      first). It wraps hardcoded copy with the SDK's translate call, then pushes
      + publishes keys. It self-checks the language/framework and, when there's no
      codemod for it, prints the language-correct i18n doc to wrap strings by hand.
- [ ] Reference for the exact translate call/import in this target's language:

${embeddedDocOr("i18n", sdk, "i18n", doc)}

- [ ] Gate: \`shipeasy i18n validate\` passes (every referenced key exists on the server).
`;
}

export function buildWiringDoc(input: WiringDocInput): string {
  const sections: string[] = [
    `# Shipeasy onboarding — remaining wiring

**Instructions for a coding agent (any AI harness) or a developer.**

\`shipeasy setup\` already completed the mechanical steps: authentication, the
per-target \`.shipeasy\` project bindings (project \`${input.projectId}\`), SDK key
minting + persistence into gitignored env files, package installs (where
marked), MCP/agent registration, installing the SDK + feature how-to skills into
your agent(s), and server-side module enablement${
      input.enabledFeatures.length ? ` (${input.enabledFeatures.join(", ")})` : ""
    }. Each target's installation doc is embedded inline below.

What remains requires reading this codebase and making judgement calls — that
is your job. Work top to bottom; check off items as you complete them, and
delete this file once everything passes.`,
    OPERATING_RULES,
    `## Per-target SDK wiring`,
    ...input.targets.map((t, i) => targetSection(i, t)),
  ];

  // Module-dependent sections — only what was actually enabled. `sdk` for the
  // doc handles comes from the first target (falls back to a placeholder).
  const primarySdk = input.targets[0]?.sdk ?? "<lang>";
  if (input.devtools) sections.push(devtoolsSection(input.devtools));
  if (input.enabledFeatures.includes("ops"))
    sections.push(opsSection(primarySdk, input.featureDocs?.errorReporting));
  if (input.enabledFeatures.includes("i18n"))
    sections.push(i18nSection(primarySdk, input.featureDocs?.i18n));

  sections.push(`## Final verification gate (all must pass)

\`\`\`bash
shipeasy whoami && shipeasy sdk keys list && shipeasy projects current
${input.targets.map((t) => `( cd ${t.relPath} && shipeasy root )   # must print this dir + project + sdk`).join("\n")}
${input.buildTargets.map((p) => `( cd ${p} && (pnpm build || npm run build) )`).join("\n")}
\`\`\`

## Hand-off

Report a short summary (project id, targets wired, entry files touched), then
give the user the exact \`git add <files>\` list — each target's \`.shipeasy\`,
manifests + lockfiles, entry files, \`.claude/skills/shipeasy-onboarded/\` — and
**stop**. Confirm every \`.env*\` file is gitignored before listing anything.
Do not commit. Do not include this file in the list (it gets deleted instead).`);

  return sections.join("\n\n") + "\n";
}
