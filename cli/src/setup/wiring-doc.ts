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

import type { TargetSurface } from "../commands/scan";
import {
  DOCS_DIRNAME,
  docFile,
  docPointer,
  type DocTopic,
  type ReferenceDocs,
} from "./doc-bundle";
import { headTagsSection } from "./head-tags";

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
  /** Native app (React Native) → the client SDK is the ONLY runtime here. */
  native?: boolean;
  /**
   * Shipeasy `<script>` tags the scan already found in this target's HTML
   * shell. `legacy` names deleted endpoints (`/sdk/loader.js`,
   * `/sdk/bootstrap.js`) that now 404 — a page carrying one is broken, so the
   * head-tags section turns it into a replace step.
   */
  existingScripts?: { current: string[]; legacy: string[]; file?: string };
}

/** The surface the user accepted devtools on — a page, or a native app. */
export type DevtoolsSurface = Exclude<TargetSurface, "none">;

export type { ReferenceDocs } from "./doc-bundle";

export interface WiringDocInput {
  projectId: string;
  targets: WiringTarget[];
  /**
   * The public identifiers every browser tag needs. Separate from `devtools`
   * because the head tags are wanted whenever this repo serves a page — the
   * overlay is only one of the tags, and the least load-bearing one. Falls back
   * to `devtools`'s copies when omitted.
   */
  publicIds?: {
    /** Literal client key minted this run; null → reference the env var name. */
    clientKey: string | null;
    clientKeyVar: string;
    projectIdVar: string;
  };
  devtools: {
    /** Which overlay(s) to wire; `["browser"]` when omitted. */
    surfaces?: DevtoolsSurface[];
    clientKeyVar: string;
    projectIdVar: string;
    /** Literal client key minted this run — null if the target was already
     * onboarded and the key wasn't re-minted (fall back to the env var name). */
    clientKey: string | null;
    /** React Native only: where the overlay package landed, and what the CLI
     *  could not run itself. */
    native?: {
      relPath: string;
      /** Install command still to run, null when the CLI already ran it. */
      installCmd: string | null;
      /** `expo install …` for the optional peers; null for a bare RN app. */
      expoPeersCmd: string | null;
      /** The SDK's `react-native-devtools` doc, embedded inline. */
      doc: string | null;
    } | null;
  } | null;
  /** Module groups already enabled server-side by the CLI (flags/i18n/ops). */
  enabledFeatures: string[];
  /**
   * Language-correct doc snippets fetched at setup time for the primary SDK, so
   * the feature sections embed real example calls/interfaces instead of any
   * framework-specific guess. Null when the SDK doesn't publish that page.
   */
  featureDocs?: { i18n?: string | null; errorReporting?: string | null };
  /**
   * Every doc page pulled for this run's selections, already on disk. Sections
   * below link the page that answers them; the index section lists the rest.
   */
  referenceDocs?: ReferenceDocs;
  /** JS/TS targets to build-verify at the end. */
  buildTargets: string[];
  /**
   * Coding agents/harnesses the CLI just registered the `@shipeasy/mcp` server
   * into this run. Drives the reload notice — a harness reading this file was
   * already running when its MCP config changed, so it must reload to see the
   * `shipeasy-mcp` tools. Empty → no MCP was wired, notice is omitted.
   */
  agents?: string[];
  /**
   * The subset of {@link agents} whose shipeasy MCP connection setup verified as
   * live (step 10 asked the client to list the server's tools). Named in the
   * opening gate so a session that can't find the tools knows the server itself
   * is fine and the fix is a restart — not a CLI fallback.
   */
  mcpVerified?: string[];
}

/** Harness-specific "reload so the new MCP server loads" instruction. */
const RELOAD_BY_AGENT: Record<string, string> = {
  claude:
    "**Claude Code** — restart Claude Code (project-scoped MCP servers load on startup; approve `shipeasy` when prompted). Check with `/mcp`.",
  // Two surfaces, two different reloads: the CLI (`cursor-agent`) loads its MCP
  // servers once at session start, so only a NEW session picks them up — telling
  // a terminal session to reload an IDE window it doesn't have is a dead end.
  cursor:
    "**Cursor** — CLI (`cursor-agent`): exit and start a new session; it reads its MCP servers once at startup. IDE: reload the window (Command Palette → *Developer: Reload Window*), then enable the `shipeasy` server under Settings → MCP.",
  copilot:
    "**VS Code / Copilot** — reload the window (Command Palette → *Developer: Reload Window*), then start `shipeasy` from the MCP servers view (trust it when prompted).",
  codex: "**Codex CLI** — restart the Codex session so it re-reads the MCP config.",
  jules: "**Jules** — start a fresh task; the MCP server is picked up per session.",
};

/**
 * How to obtain a token when the tools are present but the call comes back
 * Unauthorized — a different failure from "no tools", and the common one.
 *
 * mcp.shipeasy.ai answers discovery anonymously and 401s only on `tools/call`,
 * so a client can connect, list all its tools, and report itself ready while
 * holding no credential at all.
 *
 * Cursor needs both of its surfaces spelled out, because the obvious remedies
 * are surface-specific and each is a dead end on the other:
 *  - the IDE exposes an `mcp_auth` tool the agent can call in-session;
 *  - `cursor-agent` (CLI) has no such tool — `cursor-agent mcp` offers only
 *    login/list/list-tools/enable/disable — and `cursor-agent mcp login` prints
 *    "✓ MCP login successful" against our anonymous discovery WITHOUT storing a
 *    token, so it is not a remedy either. From the CLI the only honest move is
 *    to hand it to the user.
 * An agent told to "call `mcp_auth`" in a `cursor-agent` session hunts for a
 * tool that isn't there and falls back to the CLI, which is what happened.
 */
const AUTHORIZE_BY_AGENT: Record<string, string> = {
  cursor:
    "**Cursor** — in the IDE: call the `mcp_auth` tool for server `shipeasy` and approve in the browser. In a `cursor-agent` (CLI) session there is no in-session authorize and `cursor-agent mcp login` reports success without storing a token — ask the user to log in from Cursor: Settings → Tools & MCP → `shipeasy` → Login.",
  claude: "**Claude Code** — run `/mcp`, select `shipeasy`, choose Authenticate, then approve in the browser.",
  codex: "**Codex CLI** — run `codex mcp login shipeasy` and approve in the browser.",
  copilot: "**VS Code / Copilot** — start `shipeasy` from the MCP servers view and approve in the browser.",
  jules: "**Jules** — open MCP settings, authorize `shipeasy`, then approve in the browser.",
};

/**
 * How to put a question back to the user on each harness.
 *
 * The doc asks the user exactly one question (Cleanup), and that question gates
 * two irreversible-feeling actions, with an explicit "no clear answer → change
 * nothing" branch. That branch exists because a free-text reply has to be
 * interpreted; a structured picker removes the interpretation entirely, so use
 * the harness's own question tool wherever one exists.
 *
 * Only the harnesses that actually have one are listed — a missing entry falls
 * through to the plain-text ask, which is always correct:
 *  - Claude Code: `AskUserQuestion`, always available.
 *  - Cursor: the interactive Q&A tool, which since 2.4 works in any conversation
 *    (not just Plan/Debug). Cursor's own docs say custom skills reach it by
 *    being told to "use the ask question tool" — hence that exact phrasing.
 *  - Codex CLI: has `request_user_input`, but it is Plan-mode only
 *    (openai/codex#11536, closed) and a session reading this file is normally in
 *    Default mode, so it is deliberately NOT listed — an agent sent after a tool
 *    it cannot call improvises, and improvising is what this section prevents.
 */
const ASK_BY_AGENT: Record<string, string> = {
  claude: "Ask with the `AskUserQuestion` tool — one question, options **Yes** and **No**.",
  cursor: "Use the ask question tool — one question, options **Yes** and **No**.",
};

/**
 * The opening gate: does THIS session have the MCP tools?
 *
 * It used to assert that it doesn't — "registered while this session was already
 * running" — which is only true for a session that predates setup. When setup
 * launches the agent itself (step 11), or the user starts a fresh one after it,
 * the tools ARE live, and a flat assertion talked those sessions into a CLI
 * fallback they never needed. So: probe, don't assert. One `whoami` call settles
 * it, and the instructions only matter on the branch where it fails.
 *
 * Two distinct failures, deliberately kept apart, because the fixes have nothing
 * in common and an agent that conflates them gives up on the wrong one:
 *  - no tools at all → the session predates the wiring → restart it;
 *  - tools present, call returns Unauthorized → the client never completed OAuth
 *    (our discovery is anonymous, so it can connect and list tools without a
 *    token) → authorize it. This is the one that sent a Cursor session to the
 *    CLI with "MCP auth failed (stale session)" when nothing was stale.
 */
function reloadSection(agents: string[], verified: string[] = []): string {
  const known = agents.filter((a) => RELOAD_BY_AGENT[a]);
  const lines = known.length
    ? known.map((a) => `- ${RELOAD_BY_AGENT[a]}`)
    : ["- Restart your coding agent / reload its window so it re-reads the MCP config."];
  const authKnown = agents.filter((a) => AUTHORIZE_BY_AGENT[a]);
  const authLines = authKnown.length
    ? authKnown.map((a) => `- ${AUTHORIZE_BY_AGENT[a]}`)
    : ["- Authorize the `shipeasy` MCP server from your client's MCP settings."];
  const verifiedLine = verified.length
    ? `\n\`shipeasy setup\` **verified authorization** for ${verified.join(", ")} before writing this\nfile — that client holds a token, so a failure there is a stale session, not a\nmissing sign-in.\n`
    : "";
  return `## First: check whether the Shipeasy MCP tools are live here

\`shipeasy setup\` registered the \`@shipeasy/mcp\` server. Every client loads its MCP
servers **when the session starts**, so whether this session has them depends on
whether it started before or after that write — **check, don't assume**:
${verifiedLine}

- [ ] Call the \`whoami\` MCP tool (or \`projects_current\`) and read the result:

- [ ] **It resolves** → the tools are live. Use them for every step below and skip
  the rest of this section.

- [ ] **The tools aren't there at all** → this session predates the wiring. A
  harness cannot reload itself, so **ask the user to restart it** and re-run this
  brief:

${lines.join("\n")}

- [ ] **The tools ARE there but the call returns \`Unauthorized\` / a 401** → this is
  NOT a stale session. mcp.shipeasy.ai answers discovery anonymously and rejects
  only tool calls, so your client connected and listed every tool without ever
  completing the browser sign-in. Restarting will not fix it — **authorize**:

${authLines.join("\n")}

- [ ] Only once the step above is done or declined: use the \`shipeasy\` CLI instead
  (\`shipeasy --help\`) — it authenticates separately and covers the same operations,
  so the wiring can proceed either way. Say which one you're using.`;
}

/**
 * The index of everything pulled. Sits high in the file because it changes how
 * the agent should treat every snippet below it: the pages are newer than the
 * CLI that wrote these instructions, so they win.
 */
function referenceDocsSection(refs: ReferenceDocs): string {
  const bySdk = new Map<string, ReferenceDocs["pages"]>();
  for (const p of refs.pages) bySdk.set(p.sdk, [...(bySdk.get(p.sdk) ?? []), p]);

  const lines = [
    `## Reference docs pulled for your setup`,
    "",
    `\`shipeasy setup\` fetched the SDK documentation for exactly what you turned on`,
    `and wrote it to \`${refs.dir}/\`. These pages come from the SDK's live docs, not`,
    `from this file's generator — **when a page below disagrees with a snippet in`,
    `this file, the page is right.** Read the one that covers a step before you do`,
    `that step; do not wire from memory.`,
    "",
  ];
  for (const [sdk, pages] of bySdk) {
    lines.push(`**${sdk}**`, "");
    for (const p of pages) lines.push(`- \`${p.file}\` — ${p.title}: ${p.why}`);
    lines.push("");
  }
  if (refs.missing.length) {
    const byTopic = refs.missing.map((m) => `\`${m.topic}\` (${m.sdk})`).join(", ");
    lines.push(
      `Not published by the SDK, so nothing was pulled: ${byTopic}. If you need one,`,
      `check \`shipeasy docs list --sdk <lang>\` for what the page is called there, or`,
      `fall back to https://docs.shipeasy.ai`,
      "",
    );
  }
  lines.push(
    `Anything not covered here: \`shipeasy docs list --sdk <lang>\` then`,
    `\`shipeasy docs get --sdk <lang> <page>\`. Delete \`${refs.dir}/\` along with this`,
    `file when every gate passes — it is a setup-time snapshot, not part of the repo.`,
  );
  return lines.join("\n");
}

/**
 * Embed a fetched doc snippet under a marker. With nothing to embed, point at
 * the copy pulled into the docs folder — and only when that is missing too, at
 * the command that fetches it.
 */
function embeddedDocOr(
  label: string,
  sdk: string,
  page: string,
  doc: string | null | undefined,
  file?: string | null,
): string {
  if (doc && doc.trim()) {
    return [
      `<!-- BEGIN ${label} doc (sdk: ${sdk}) — source of truth; copy calls from here -->`,
      doc.trim(),
      `<!-- END ${label} doc -->`,
    ].join("\n");
  }
  if (file) {
    return `The language-correct example is in \`${file}\`, pulled for you at setup. Copy the exact calls from there.`;
  }
  return `Pull the language-correct example: \`shipeasy docs get --sdk ${sdk} ${page}\` (or \`docs list --sdk ${sdk}\` if the page name differs). Copy the exact calls from there.`;
}

const OPERATING_RULES = `## Operating rules (follow exactly)

1. Run every shell command yourself; do not ask the user to run commands. One
   exception: a browser sign-in (see the final gate) — you cannot click a link,
   so that one goes to the user.
2. **Never print, log, echo, or commit a key value** — anything matching
   \`sdk_server_*\` or \`sdk_client_*\`. Reference env var NAMES only. The values
   are already persisted in each target's gitignored env file.
3. **Never \`git push\` or publish.** Do not \`git commit\` either, with exactly one
   exception: the final **Cleanup** step below, where you ask the user first and
   commit only on an explicit yes. Until then, stop at "ready to commit" and hand
   the exact \`git add\` file list to the user.
4. **Initialise the SDK once per runtime, at the app's entry point.** Do not
   create wrapper/helper/util files to hold SDK initialisation — the SDK owns
   its own init. (The exact init call is language-specific — take it from the
   embedded installation doc, not from memory.)
5. **These notes are framework-agnostic on purpose.** Copy every concrete call,
   import, class, and interface from the embedded docs below and the pages pulled
   into \`${DOCS_DIRNAME}/\` (or fetch more with \`shipeasy docs get --sdk <lang> <page>\`
   / \`docs list --sdk <lang>\`) — the per-language docs are the source of truth and
   **win on any conflict**, including with anything you already know about this SDK.
6. Each step has a verification gate — do not advance past a failing gate.
   Self-heal once, then stop and report the failure.
7. If a \`shipeasy\` command fails with \`unknown command\`/\`400\`/\`404\`, suspect
   version drift: \`npm i -g @shipeasy/cli@latest\` and retry once before
   treating it as a bug.
8. **If a step fails and you cannot recover it, offer to report it — but ASK THE
   USER FIRST.** In plain language, ask whether to send a bug report to Shipeasy,
   and say exactly what it includes (OS/Node/CLI version, the failing step + error,
   the project id, detected language/framework, your description). ONLY on an
   explicit yes, run \`shipeasy report-issue --consent …\` (see the last section).
   Never send anything to Shipeasy without the user's consent.`;

function targetSection(i: number, t: WiringTarget, refs?: ReferenceDocs): string {
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

  const installFile = docFile(refs, t.sdk, "installation");
  if (t.installationDoc) {
    lines.push(
      `- [ ] Follow this target's installation doc — **pulled for you below** (sdk: \`${t.sdk}\`)` +
        (installFile ? `, also on disk at \`${installFile}\`` : "") +
        `. The \`shipeasy-${t.sdk}\` SDK skill was also installed into your agent(s).`,
      "",
      `<!-- BEGIN installation doc (sdk: ${t.sdk}) — source of truth for this target -->`,
      t.installationDoc.trim(),
      `<!-- END installation doc -->`,
      "",
    );
  } else if (installFile) {
    lines.push(
      `- [ ] Follow this target's installation doc — pulled for you at setup:` +
        ` **\`${installFile}\`** (sdk: \`${t.sdk}\`). It is the current published page;` +
        ` prefer it over anything you remember about this SDK.`,
    );
  } else {
    lines.push(
      `- [ ] Pull this target's version-correct installation doc and follow it:`,
      `      \`cd ${t.relPath} && shipeasy docs get --sdk ${t.sdk} installation\``,
    );
  }
  lines.push(
    t.native
      ? `- [ ] Initialise the SDK once at the app's root, reading the PUBLIC client key` +
          ` from \`${t.envVars.find((v) => v.includes("CLIENT")) ?? "SHIPEASY_CLIENT_KEY"}\`.` +
          ` This app ships to devices, so it gets the client key and **never** a` +
          ` \`sdk_server_*\` one — a server key in an app bundle is a leaked secret.` +
          ` Copy the exact init call and imports from the doc above.`
      : `- [ ] Initialise the SDK once at the app's startup entry point, reading the` +
          ` server key from \`SHIPEASY_SERVER_KEY\`; then create a per-user client for each` +
          ` evaluation. Copy the exact init call, class, and imports from the doc above` +
          ` (prefer a framework generator when the doc lists one).`,
  );
  if (t.entryPoints.length) {
    lines.push(
      `      Detected entry point(s): ${t.entryPoints.map((e) => `\`${e}\``).join(", ")}.`,
    );
  }
  lines.push(
    `- [ ] **Wire user identity + targeting attributes** — do NOT skip. With no` +
      ` attributes every evaluation sees an empty context, so only default rules and` +
      ` 100% rollouts fire and experiments cannot bucket. First READ this codebase to` +
      ` find the best targeting attributes: inspect the auth / session / user model` +
      ` (login, middleware, the request \`user\`/session object, the ORM user schema)` +
      ` and pick the stable, high-signal keys this app can actually supply — a stable` +
      ` \`user_id\` (the bucketing unit; fall back to a persisted \`anonymous_id\` for` +
      ` logged-out visitors), plus whatever exists here: plan/tier, country/region,` +
      ` locale, org/company id, role, signup cohort. Do NOT invent attributes the app` +
      ` can't provide. Then wire them through the SDK's OWN identity mechanism — the` +
      ` \`attributes\`/identify transform registered on the init call — mapping YOUR` +
      ` user object → the attribute bag. Use the exact signature from the installation` +
      ` doc above (full reference: ${docPointer(refs, t.sdk, "configuration", "configuration")}).` +
      ` Never hard-code a single user; the transform runs per bound client.`,
  );
  if (t.browser && !t.native) {
    const clientVar = t.envVars.find((v) => v.includes("CLIENT")) ?? "SHIPEASY_CLIENT_KEY";
    // Only a JS/TS target has a browser bundle to initialise — the npm client
    // SDK hydrates from the same bootstrap tag. Everywhere else the browser is
    // served entirely by the `<head>` tag this target's SDK emits, and telling
    // it to "initialise the browser SDK" sends the agent looking for an npm
    // client that does not exist in this language.
    const bundled = t.sdk === "typescript" || t.sdk === "javascript";
    lines.push(
      bundled
        ? `- [ ] Also initialise the browser SDK once at client startup with the PUBLIC client` +
            ` key (\`${clientVar}\`), per the same doc, and give it the SAME identity transform` +
            ` so the browser \`identify()\`s the visitor with the attributes chosen above.` +
            ` Never pass the server key to the client entrypoint (or vice versa).`
        : `- [ ] The browser side of this target is served by a \`<head>\` tag, not a second` +
            ` init — see **Browser head tags** below. Pass the same identified user into the` +
            ` bootstrap tag helper that you evaluate with, so the browser adopts the identity` +
            ` the server already bucketed (no anonymous → identified flip on first paint).` +
            ` The PUBLIC key it needs (\`${clientVar}\`) belongs on the \`configure()\` call,` +
            ` never the server key.`,
    );
  }
  lines.push(
    `- [ ] Gate: the app builds/boots cleanly with the SDK wired` +
      ` (${buildHint(t)}, or the project's usual dev command).`,
    `- [ ] Gate: the attribute bag carries a stable identifier plus the targeting keys you` +
      ` found. Once the SDK evaluates, the platform auto-infers this schema from the` +
      ` evaluation calls — confirm the keys surface via \`shipeasy release flags attributes list\`.`,
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

/**
 * The React Native overlay: a real package mount, not a `<script>` tag. The
 * two judgement calls a harness must make here are the deep-link scheme (it has
 * to be one the app actually registers, or sign-in can never return) and where
 * the single root mount goes — everything mechanical the CLI already did.
 */
function nativeDevtoolsSection(
  d: NonNullable<WiringDocInput["devtools"]>,
  n: NonNullable<NonNullable<WiringDocInput["devtools"]>["native"]>,
  projectId: string,
  sdk: string,
  refs?: ReferenceDocs,
): string {
  const file = docFile(refs, sdk, "react-native-devtools");
  // Expo inlines EXPO_PUBLIC_* at build time, so read it from env there; a bare
  // RN app has no env channel, so the (public) key is inlined literally.
  const keyExpr = d.clientKeyVar.startsWith("EXPO_PUBLIC_")
    ? `process.env.${d.clientKeyVar} ?? ""`
    : JSON.stringify(d.clientKey ?? `<value of ${d.clientKeyVar} in env>`);
  const lines = [
    `## Devtools overlay — React Native (user accepted — wire it)`,
    "",
    `Shake-to-open, on-device: every gate/config/experiment with live overrides`,
    `(no reload), the identified user, the SDK event stream, the ops queue, and`,
    `the in-app bug/feature report form. It ships as its own package so an app`,
    `that only reads flags never pulls a UI toolchain into its bundle.`,
    "",
    n.installCmd
      ? `- [ ] Install it (the CLI could not run this one): in \`${n.relPath}/\`, \`${n.installCmd}\``
      : `- [x] \`@shipeasy/react-native-devtools\` + its form peers installed in \`${n.relPath}/\` (done by \`shipeasy setup\`).`,
  ];
  if (n.expoPeersCmd) {
    lines.push(
      `- [x] Optional Expo peers offered: \`${n.expoPeersCmd}\` — shake-to-open,` +
        ` login, session persistence, screenshots, icons. Re-run it in \`${n.relPath}/\`` +
        ` if any were skipped; each degrades gracefully when absent.`,
    );
  } else {
    lines.push(
      `- [ ] Bare React Native (no Expo): the optional \`expo-*\` peers are skipped, so` +
        ` shake-to-open and the login round-trip are unavailable until you add them.` +
        ` Open the panel imperatively instead — \`ref.current?.open()\` from your dev menu.`,
    );
  }
  lines.push(
    `- [ ] Mount it **once** at the app root (below your providers, above nothing else` +
      ` — it renders its own modal):`,
    "",
    "  ```tsx",
    `  import { ShipeasyDevtools } from "@shipeasy/react-native-devtools";`,
    "",
    `  <ShipeasyDevtools`,
    `    scheme="<a URL scheme THIS app registers>://se-auth"`,
    `    clientKey={${keyExpr}}`,
    `    projectId=${JSON.stringify(projectId || `<${d.projectIdVar}>`)}`,
    `  />`,
    "  ```",
    "",
    `  Detected root(s) are listed in this target's section above. The client key is` +
      ` public by design and the project id is not a secret, so both may be inlined.`,
    `- [ ] \`scheme\` must be a scheme the app really registers (Expo: \`expo.scheme\`` +
      ` in \`app.json\`; bare RN: the iOS \`CFBundleURLTypes\` entry + the Android` +
      ` \`intent-filter\`). Sign-in deep-links back through it — a scheme the app does` +
      ` not own means the round-trip never returns. READ the app config and use its` +
      ` existing scheme; do not invent one.`,
    `- [ ] Decide the build gate: wrap the mount in \`__DEV__\` for an internal-only` +
      ` tool, or leave it mounted in production if you want the end-user bug/feature` +
      ` report path (that path needs the client key to carry \`tickets:public_create\`).`,
    `- [ ] Gate: shake the device several times quickly (iOS simulator: Ctrl+Cmd+Z)` +
      ` and the panel opens; **Connect to Shipeasy** completes the login round-trip.`,
    "",
    embeddedDocOr("react-native-devtools", sdk, "react-native-devtools", n.doc, file),
    "",
  );
  if (n.doc && file) {
    lines.push(
      `Full published page: \`${file}\` — check the prop list there before` +
        ` hand-writing the mount above; it is newer than this file.`,
      "",
    );
  }
  return lines.join("\n");
}

function opsSection(sdk: string, doc: string | null | undefined, refs?: ReferenceDocs): string {
  const file = docFile(refs, sdk, "error-reporting");
  const track = docFile(refs, sdk, "metrics");
  return `## Ops wiring — error reporting (ops module enabled)

The \`shipeasy-ops\` and \`shipeasy-see\` skills were installed into your agent(s)
— use them for the full walkthrough (\`shipeasy-see\` is the error-reporting
grammar). In brief:

- [ ] Report errors through the SDK's error primitive at meaningful failure
      points. Use the exact call from the doc for this target's language:

${embeddedDocOr("error-reporting", sdk, "error-reporting", doc, file)}
${doc && file ? `\n      Full published page: \`${file}\`.\n` : ""}${
    track
      ? `- [ ] Events feed the alert rules that watch these errors — the \`track()\`\n      reference is at \`${track}\`.\n`
      : ""
  }- [ ] Gate: \`shipeasy ops list --type bug\` succeeds (queue reachable).
`;
}

/**
 * The read side of the release module. There is nothing to wire up-front here —
 * the SDK is already configured — so this section is purely the pointer set: the
 * four evaluation calls, each in its published spelling for this language.
 */
function flagsSection(sdk: string, refs?: ReferenceDocs): string {
  const rows: [DocTopic, string, string][] = [
    ["flags", "flags", "gates — `getFlag`-style reads and the default on failure"],
    ["configs", "configs", "dynamic configs — typed remote values"],
    ["killswitches", "killswitches", "kill switches — the one-flip off switch"],
    ["experiments", "experiments", "experiments — variant + exposure"],
    ["metrics", "metrics/track", "`track()` — the events metrics and readouts are built from"],
  ];
  return `## Flags, configs, experiments — the read calls (release module enabled)

The \`shipeasy-flags\`, \`shipeasy-experiments\` and \`shipeasy-metrics\` skills were
installed into your agent(s) for the full workflows. Nothing here needs wiring
beyond the configured SDK — but when you write a first read, take the call from
this language's published page, not from a remembered signature:

${rows.map(([t, h, what]) => `- ${what} → ${docPointer(refs, sdk, t, h)}`).join("\n")}

- [ ] Do NOT create flags/experiments speculatively. Add a read when a real
      branch in this codebase needs one, and create the flag first
      (\`shipeasy release flags create\`, or the equivalent \`release_flags_create\`
      tool) so the key exists before anything evaluates it.
`;
}

function i18nSection(sdk: string, doc: string | null | undefined, refs?: ReferenceDocs): string {
  const file = docFile(refs, sdk, "i18n");
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

${embeddedDocOr("i18n", sdk, "i18n", doc, file)}
${doc && file ? `\n      Full published page: \`${file}\`.\n` : ""}
- [ ] Delivering strings to the browser is a \`<head>\` tag, not a second install —
      the i18n loader is already part of the block in **Browser head tags** (skip
      this if nothing here renders a page). Emitted server-side it carries the
      strings on \`data-strings\`, so there is no round trip and no flash of
      untranslated copy.
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
  ];
  const refs = input.referenceDocs?.pages.length ? input.referenceDocs : undefined;

  // Whether the reader has the shipeasy-mcp tools depends on when its session
  // started, so this gate goes first: one probe decides it before any step below
  // needs a tool call.
  if (input.agents?.length) sections.push(reloadSection(input.agents, input.mcpVerified));

  sections.push(OPERATING_RULES);

  // The pulled-docs index goes above every wiring section, because it changes
  // how those sections should be read: the pages are fresher than this file.
  if (refs) sections.push(referenceDocsSection(refs));

  sections.push(
    `## Per-target SDK wiring`,
    ...input.targets.map((t, i) => targetSection(i, t, refs)),
  );

  // Module-dependent sections — only what was actually enabled. `sdk` for the
  // doc handles comes from the first target (falls back to a placeholder).
  const primarySdk = input.targets[0]?.sdk ?? "<lang>";
  const surfaces = input.devtools?.surfaces ?? (input.devtools ? ["browser"] : []);

  // The `<head>` block. Wanted whenever this repo serves a page at all — the
  // runtime tag is how a browser sees flags, with or without the overlay — so
  // it is NOT gated on the devtools answer, only widened by it.
  const ids = input.publicIds ?? input.devtools;
  const servesPages =
    input.targets.some((t) => t.browser && !t.native) || surfaces.includes("browser");
  if (ids && servesPages) {
    sections.push(
      headTagsSection({
        projectId: input.projectId,
        clientKey: ids.clientKey,
        clientKeyVar: ids.clientKeyVar,
        projectIdVar: ids.projectIdVar,
        targets: input.targets,
        i18n: input.enabledFeatures.includes("i18n"),
        devtools: surfaces.includes("browser"),
        docs: refs,
      }),
    );
  }

  if (input.devtools?.native && surfaces.includes("react-native")) {
    sections.push(
      nativeDevtoolsSection(
        input.devtools,
        input.devtools.native,
        input.projectId,
        primarySdk,
        refs,
      ),
    );
  }
  if (input.enabledFeatures.includes("ops"))
    sections.push(opsSection(primarySdk, input.featureDocs?.errorReporting, refs));
  if (input.enabledFeatures.includes("i18n"))
    sections.push(i18nSection(primarySdk, input.featureDocs?.i18n, refs));
  if (input.enabledFeatures.includes("flags")) sections.push(flagsSection(primarySdk, refs));

  sections.push(`## Final verification gate (all must pass)

\`\`\`bash
shipeasy whoami && shipeasy sdk keys list && shipeasy projects current
${input.targets.map((t) => `( cd ${t.relPath} && shipeasy root )   # must print this dir + project + sdk`).join("\n")}
${input.buildTargets.map((p) => `( cd ${p} && (pnpm build || npm run build) )`).join("\n")}
\`\`\`

If the first line fails with missing credentials, the **CLI** is not signed in.
That is separate from your MCP connection — the \`shipeasy_*\` tools can be fully
authorized while the CLI has no session, because the two sign in differently. It is
the one thing here you cannot fix yourself: run \`shipeasy login\`, show the user
the URL it prints, and let the command finish while they approve it in the
browser. Then re-run the gate. Do not substitute MCP calls for these three
commands — they are checking the CLI.

## Hand-off

Report a short summary (project id, targets wired, entry files touched), then
give the user the exact \`git add <files>\` list — each target's \`.shipeasy\`,
manifests + lockfiles, entry files, \`.claude/skills/shipeasy-onboarded/\`.
Confirm every \`.env*\` file is gitignored before listing anything. Do not include
this file in the list${refs ? ` or \`${refs.dir}/\`` : ""} — ${
    refs ? "both are setup artifacts and get deleted" : "it is a setup artifact and gets deleted"
  }, not committed. Then go to Cleanup.`);

  sections.push(cleanupSection(refs, input.agents));

  sections.push(bugReportingSection());

  return sections.join("\n\n") + "\n";
}

/**
 * The last step of the happy path: bin the setup artifacts and commit the real
 * change. Both halves are the user's call, not the agent's — deleting files and
 * writing a commit are the two irreversible-feeling things in this whole file —
 * so it is one plain question, asked once, and a no leaves everything in place.
 */
function cleanupSection(refs: ReferenceDocs | undefined, agents: string[] = []): string {
  const artifacts = [
    "`shipeasy-wiring.md` (this file)",
    ...(refs ? [`\`${refs.dir}/\` (the SDK doc pages pulled for this run)`] : []),
  ];
  const rm = ["shipeasy-wiring.md", ...(refs ? [`${refs.dir}/`] : [])];
  const ask = agents.map((a) => ASK_BY_AGENT[a]).find(Boolean);
  return `## Cleanup — ask the user, then finish

Everything above is done. Two things are left, and **both need the user's
answer** — ask once, in one message, in plain language:

> Setup is complete. Want me to clean up the installation artifacts (${rm.join(", ")})
> and commit the wiring changes?
${ask ? `\n${ask}\nIf that tool is not available in this session, ask in plain text — never skip\nthe question.\n` : ""}
These are the setup artifacts — scaffolding for this one-time onboarding, not
part of the codebase:

${artifacts.map((a) => `- ${a}`).join("\n")}

- [ ] **On an explicit yes**, do both halves, in this order:

      1. Delete the artifacts: \`rm -rf ${rm.join(" ")}\`
      2. Stage ONLY the files you actually changed — the \`git add <files>\` list
         from the hand-off above, path by path. Never \`git add -A\` or \`git add .\`:
         this repo may hold unrelated work in progress, and sweeping it into a
         setup commit is not yours to do.
      3. Verify what you staged before writing the commit: \`git diff --cached --stat\`,
         and \`git diff --cached\` over any env/config file. If a key value
         (\`sdk_server_*\` / \`sdk_client_*\`) or an untracked \`.env*\` appears, STOP,
         unstage it, and tell the user — a leaked server key is the one mistake
         here that cannot be undone by a revert.
      4. Commit with a conventional message, e.g.
         \`chore: wire up the Shipeasy SDK\` (or \`feat:\` if this run added
         user-visible behaviour). Describe what was wired, in the body.
      5. **Do not push.** Pushing is the user's call and they have not made it.
         Report the commit sha and stop.

- [ ] **On a no, or no clear answer**, change nothing: leave the artifacts on
      disk, leave the working tree unstaged, and hand back the \`git add\` list so
      the user can commit it themselves. Do not delete and do not commit "to be
      helpful" — an unasked-for commit is harder to undo than an extra file.
- [ ] Either way, say which it was, so the user knows the state they are in.
`;
}

/**
 * Final section: how the agent reports a setup failure back to Shipeasy — always
 * consent-gated. Appended to every wiring doc so the escape hatch is right where
 * the agent lands if something above breaks.
 */
function bugReportingSection(): string {
  return `## If setup breaks: report it to Shipeasy (with the user's consent)

If any step above fails and you cannot recover it, you can file a bug straight to
the Shipeasy team so we can fix it. This is **opt-in and consent-gated** — treat
consent as mandatory:

- [ ] **Ask the user first.** In plain language, ask whether to send a bug report
      to Shipeasy, and tell them exactly what it includes: OS/arch, Node, and CLI
      version; the failing step and the error message; the Shipeasy project id;
      the detected language + frameworks; and your description of the problem.
- [ ] **Only on an explicit "yes"**, run (fill in the real details):

      shipeasy report-issue --consent \\
        --title "Setup failed at <step>" \\
        --step "<step>" \\
        --error "<the error message>" \\
        --description "<what you tried and what happened>" \\
        --language "<lang>" --frameworks "<comma,list>"

  It files a **pending-approval** bug (a human reviews it before anyone acts on
  it) and prints the exact payload before sending. \`--consent\` is required — it
  records that the user agreed. Preview the payload without sending using \`--json\`.
- [ ] If the user declines, do nothing — never send a report without consent.`;
}
