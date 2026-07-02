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
  /** JS/TS targets to build-verify at the end. */
  buildTargets: string[];
}

const OPERATING_RULES = `## Operating rules (follow exactly)

1. Run every shell command yourself; do not ask the user to run commands.
2. **Never print, log, echo, or commit a key value** — anything matching
   \`sdk_server_*\` or \`sdk_client_*\`. Reference env var NAMES only. The values
   are already persisted in each target's gitignored env file.
3. **Never \`git commit\`, \`git push\`, or publish.** Stop at "ready to commit"
   and hand the exact \`git add\` file list to the user.
4. **One \`configure(...)\` call per runtime, at the app's entry point.** Do not
   create wrapper/helper/util files (e.g. \`src/lib/shipeasy.ts\`) to hold SDK
   initialisation — the SDK owns its own init.
5. The per-language docs are the source of truth and **win on any conflict**
   with these notes: pull them with \`shipeasy docs get --sdk <lang> <page>\`
   (inside a target folder \`--sdk\` defaults from its \`.shipeasy\`).
   \`shipeasy docs list --sdk <lang>\` shows every available page.
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

  lines.push(
    `- [ ] Pull this target's version-correct wiring doc and follow it:`,
    `      \`cd ${t.relPath} && shipeasy docs get --sdk ${t.sdk} installation\``,
    `- [ ] Wire the server SDK: one global \`configure(...)\` (reads \`SHIPEASY_SERVER_KEY\`)` +
      ` at the app's startup entry point, then a user-bound \`Client(user)\` per evaluation.` +
      ` Prefer a framework generator when the doc lists one.`,
  );
  if (t.entryPoints.length) {
    lines.push(`      Detected entry point(s): ${t.entryPoints.map((e) => `\`${e}\``).join(", ")}.`);
  }
  if (t.browser) {
    lines.push(
      `- [ ] Wire the client SDK once at browser startup with the PUBLIC client key` +
        ` (\`${t.envVars.find((v) => v.includes("CLIENT")) ?? "SHIPEASY_CLIENT_KEY"}\`) per the same doc.` +
        ` Never pass the server key to the client entrypoint (or vice versa).`,
    );
  }
  lines.push(
    `- [ ] Gate: the app builds/boots cleanly with the SDK wired` +
      ` (\`${buildHint(t)}\` or the project's usual dev command).`,
    "",
  );
  return lines.join("\n");
}

function buildHint(t: WiringTarget): string {
  if (t.language === "typescript" || t.language === "javascript") {
    const pm = t.packageManager !== "unknown" ? t.packageManager : "npm";
    return `${pm} run build`;
  }
  return "run the test suite";
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
  never hardcode them. In Next.js, source \`/se-devtools.js\` in dev and the CDN
  URL in prod. (The client key is public by design; this is not a secret leak.)
- [ ] Gate: load the app with \`?se=1\` and confirm the overlay mounts.
`;
}

function opsSection(): string {
  return `## Ops wiring (feedback + error reporting — module already enabled)

- [ ] Wire \`see()\` error reporting per the language docs:
      \`shipeasy docs get --sdk <lang> error-reporting\` (fall back to
      \`shipeasy docs list --sdk <lang>\` if the page name differs).
      Wrap meaningful \`catch\` blocks with \`see()\` from \`@shipeasy/sdk\`.
- [ ] Gate: \`shipeasy ops list --type bug\` succeeds (queue reachable).
`;
}

export function buildWiringDoc(input: WiringDocInput): string {
  const sections: string[] = [
    `# Shipeasy onboarding — remaining wiring

**Instructions for a coding agent (any AI harness) or a developer.**

\`shipeasy setup\` already completed the mechanical steps: authentication, the
per-target \`.shipeasy\` project bindings (project \`${input.projectId}\`), SDK key
minting + persistence into gitignored env files, package installs (where
marked), MCP/agent registration, and server-side module enablement${
      input.enabledFeatures.length ? ` (${input.enabledFeatures.join(", ")})` : ""
    }.

What remains requires reading this codebase and making judgement calls — that
is your job. Work top to bottom; check off items as you complete them, and
delete this file once everything passes.`,
    OPERATING_RULES,
    `## Per-target SDK wiring`,
    ...input.targets.map((t, i) => targetSection(i, t)),
  ];

  if (input.devtools) sections.push(devtoolsSection(input.devtools));
  if (input.enabledFeatures.includes("ops")) sections.push(opsSection());

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
