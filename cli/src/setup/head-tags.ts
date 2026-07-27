/**
 * Composes the `<head>` script-tag block of `shipeasy-wiring.md`.
 *
 * Two things decide what a page needs, and the CLI knows both at setup time:
 *
 *  - **Which of the hosted tags apply.** The inventory is fixed — the anon-id
 *    preamble, `/sdk/boot.js`, `/sdk/runtime.js`, `/sdk/i18n/loader.js` and
 *    `se-devtools.js` (`experiment-platform/28-script-tags.md`) — but which
 *    ones a given target wants follows from *where the evaluation happens*:
 *    server-rendered → `runtime.js` with the payload attached, no server → the
 *    edge-evaluated `boot.js`, bundler → neither, the npm SDK owns reads.
 *
 *  - **How that target spells them.** Every server SDK ships tag helpers
 *    (`bootstrap_script_tag` / `i18n_script_tag` / `devtools_script_tag` and
 *    their per-language spellings) that read the key, profile and project id
 *    back out of `configure()`. A hand-templated tag is always the wrong
 *    answer where a helper exists: it duplicates config, and the bootstrap tag
 *    in particular carries a JSON payload nobody should be assembling by hand.
 *
 * So the doc gets real, filled-in tags for the stack that was actually
 * detected, rather than the whole inventory for the agent to choose from.
 */

import { docFile, docPointer, type ReferenceDocs } from "./doc-bundle";
import type { WiringTarget } from "./wiring-doc";

/** Where the payload the browser reads is produced. */
export type TagStrategy =
  /** A server SDK evaluated this request and emits the tags itself. */
  | "sdk-helper"
  /** Bundled app, npm SDK — no hosted runtime tag at all. */
  | "npm-client"
  /** No server evaluation and no bundler — the edge evaluates, via `boot.js`. */
  | "hosted"
  /** Not a page (native app, headless service). */
  | "none";

/** JS frameworks that render HTML on a server, so the SSR tag path applies. */
const SSR_JS_FRAMEWORKS = new Set(["nextjs", "nuxt", "sveltekit", "remix"]);

/** SDKs whose language always renders HTML server-side when it serves a page. */
const SERVER_SDKS = new Set(["python", "ruby", "php", "go", "java", "kotlin"]);

export function tagStrategy(t: Pick<WiringTarget, "sdk" | "frameworks" | "native">): TagStrategy {
  if (t.native) return "none";
  if (SERVER_SDKS.has(t.sdk)) return "sdk-helper";
  if (t.sdk === "typescript" || t.sdk === "javascript") {
    return t.frameworks.some((f) => SSR_JS_FRAMEWORKS.has(f)) ? "sdk-helper" : "npm-client";
  }
  return "hosted";
}

interface SnippetInput {
  /** Emit the i18n loader tag (translations module enabled). */
  i18n: boolean;
  /** Emit the devtools overlay tag (user accepted it). */
  devtools: boolean;
  clientKeyVar: string;
  projectIdVar: string;
}

interface Snippet {
  /** Info-string for the fenced block. */
  fence: string;
  code: string;
  /** Rendered after the block — anything the code can't say for itself. */
  notes?: string[];
}

/**
 * Per-SDK spelling of the three tag helpers, with the pieces the run actually
 * enabled. Signatures are the published ones — `shipeasy docs get --sdk <sdk>
 * advanced` carries the full table of arguments and defaults.
 */
const HELPER_SNIPPETS: Record<string, (o: SnippetInput) => Snippet> = {
  typescript: (o) => {
    const lines = [
      `import { shipeasy } from "@shipeasy/sdk/server";`,
      "",
      `// Configure once, here — every emit call below then takes no arguments.`,
      `const se = await shipeasy({`,
      `  serverKey: process.env.SHIPEASY_SERVER_KEY ?? "",`,
      `  clientKey: process.env.${o.clientKeyVar}, // PUBLIC key — powers the tags`,
    ];
    if (o.devtools) lines.push(`  projectId: process.env.${o.projectIdVar}, // for the devtools tag`);
    lines.push(`});`, `const boot = se.getBootstrapData();`);
    if (o.devtools) lines.push(`const dev = se.getDevtoolsData();`);
    lines.push(
      "",
      `// Render REAL <script> elements — scripts set via dangerouslySetInnerHTML never run.`,
      `<script src={boot.bootstrap.src} {...boot.bootstrap.attrs} />`,
    );
    if (o.i18n)
      lines.push(`{boot.i18nLoader && <script src={boot.i18nLoader.src} {...boot.i18nLoader.attrs} />}`);
    if (o.devtools) lines.push(`<script src={dev.src} {...dev.attrs} />`);
    return {
      fence: "tsx",
      code: lines.join("\n"),
      notes: [
        "Non-React SSR (Express, raw templates) wants the HTML-string form instead:" +
          " `se.getBootstrapTags()` returns the bootstrap (+ i18n) tags and" +
          " `se.getDevtoolsTag()` the overlay tag, both already filled in from the config.",
      ],
    };
  },

  python: (o) => {
    const lines = [
      `import shipeasy`,
      "",
      `# The client key, i18n profile and project id all come from configure(),`,
      `# so these callsites repeat none of them.`,
      `head = shipeasy.bootstrap_script_tag(user, anon_id=anon_id)  # evaluated flags, no key`,
    ];
    if (o.i18n) lines.push(`head += shipeasy.i18n_script_tag()          # translations`);
    if (o.devtools) lines.push(`head += shipeasy.devtools_script_tag()      # devtools overlay`);
    return { fence: "python", code: lines.join("\n") };
  },

  ruby: (o) => {
    const lines = [
      `<%# The document <head>. Every value comes from Shipeasy.configure. %>`,
      `<%= Shipeasy.bootstrap_script_tag(user, anon_id: anon_id) %>`,
    ];
    if (o.i18n) lines.push(`<%= Shipeasy.i18n_script_tag %>`);
    if (o.devtools)
      lines.push(`<%= Shipeasy.devtools_script_tag %>`);
    return {
      fence: "erb",
      code: lines.join("\n"),
      notes: [
        "In Rails these are package-level helpers, callable straight from the layout —" +
          " `app/views/layouts/application.html.erb`.",
      ],
    };
  },

  php: (o) => {
    const uses = [`use function Shipeasy\\bootstrapScriptTag;`];
    if (o.i18n) uses.push(`use function Shipeasy\\i18nScriptTag;`);
    if (o.devtools) uses.push(`use function Shipeasy\\devtoolsScriptTag;`);
    const calls = [`$head = bootstrapScriptTag($user, ['anonId' => $anonId])`];
    if (o.i18n) calls.push(`      . i18nScriptTag()`);
    if (o.devtools) calls.push(`      . devtoolsScriptTag()`);
    return { fence: "php", code: [...uses, "", `${calls.join("\n")};`].join("\n") };
  },

  go: (o) => {
    const lines = [`head := shipeasy.BootstrapScriptTag(user, shipeasy.TagOptions{AnonID: anonID})`];
    if (o.i18n) lines.push(`head += shipeasy.I18nScriptTag()`);
    if (o.devtools) lines.push(`head += shipeasy.DevtoolsScriptTag()`);
    return {
      fence: "go",
      code: lines.join("\n"),
      notes: [
        "The helpers take variadic `TagOptions`: pass none and every value comes from" +
          " `Configure`, or pass one to override a single field for that tag.",
      ],
    };
  },

  java: (o) => {
    const calls = [`String head = Shipeasy.bootstrapScriptTag(user, anonId)`];
    if (o.i18n) calls.push(`            + Shipeasy.i18nScriptTag()`);
    if (o.devtools) calls.push(`            + Shipeasy.devtoolsScriptTag()`);
    return { fence: "java", code: `${calls.join("\n")};` };
  },

  kotlin: (o) => {
    const imports = [`import ai.shipeasy.bootstrapScriptTag`];
    if (o.i18n) imports.push(`import ai.shipeasy.i18nScriptTag`);
    if (o.devtools) imports.push(`import ai.shipeasy.devtoolsScriptTag`);
    const calls = [`val head = bootstrapScriptTag(user, anonId = anonId)`];
    if (o.i18n) calls.push(`    i18nScriptTag()`);
    if (o.devtools) calls.push(`    devtoolsScriptTag()`);
    return { fence: "kotlin", code: [...imports, "", calls.join(" +\n")].join("\n") };
  },
};

/**
 * The overlay's own doc, whichever SDK published it. Not keyed by target sdk:
 * the overlay is one hosted bundle shared by every language, so the first pulled
 * copy describes it for all of them.
 */
function devtoolsDocLines(refs: ReferenceDocs | undefined): string[] {
  const page = refs?.pages.find((p) => p.topic === "browser-devtools");
  if (!page) return [];
  return [
    `- [ ] Before pasting the overlay tag, read \`${page.file}\` — pulled at setup, so it` +
      ` lists the attributes and build gates the overlay supports **today**. Anything it` +
      ` says about the tag overrides the snippet above.`,
  ];
}

/** The devtools overlay tag as raw HTML, for the paths with no SDK helper. */
function devtoolsHtml(clientVal: string, idVal: string): string {
  return [
    `<script src="https://cdn.shipeasy.ai/se-devtools.js"`,
    `  data-client-api-key="${clientVal}" data-project-id="${idVal}" defer></script>`,
  ].join("\n");
}

/**
 * Tags 1 + 2: mint the bucketing unit in the page, then let the edge evaluate.
 * `document.write` is what keeps `boot.js` parser-blocking, which is the only
 * way `window.shipeasy` is readable before first paint.
 */
function hostedBootHtml(projectId: string, clientVal: string): string {
  return [
    `<script>`,
    `  (function () {`,
    `    var m = document.cookie.match(/(?:^|; )__se_anon_id=([^;]*)/),`,
    `      a = m ? m[1] : crypto.randomUUID();`,
    `    if (!m)`,
    `      document.cookie =`,
    `        "__se_anon_id=" + a + ";path=/;max-age=31536000;samesite=lax" +`,
    `        (location.protocol === "https:" ? ";secure" : "");`,
    `    document.write(`,
    `      '<script src="https://cdn.shipeasy.ai/sdk/boot.js?p=${projectId}&k=${clientVal}&a=' +`,
    `        encodeURIComponent(a) + '"><\\/script>',`,
    `    );`,
    `  })();`,
    `</script>`,
  ].join("\n");
}

function i18nLoaderHtml(clientVal: string): string {
  return [
    `<script src="https://cdn.shipeasy.ai/sdk/i18n/loader.js"`,
    `  data-key="${clientVal}" data-profile="en:prod"></script>`,
  ].join("\n");
}

export interface HeadTagsInput {
  projectId: string;
  /** Literal public client key minted this run; null → reference the env var. */
  clientKey: string | null;
  clientKeyVar: string;
  projectIdVar: string;
  /** Browser-facing, non-native targets. May be empty (static site). */
  targets: WiringTarget[];
  /** Translations module enabled → the i18n loader tag joins the block. */
  i18n: boolean;
  /** User accepted the in-page overlay → the devtools tag joins the block. */
  devtools: boolean;
  /** Doc pages pulled at setup — the helper signatures below link into them. */
  docs?: ReferenceDocs;
}

const RULES = `Rules that decide whether the block is correct:

- **Exactly one runtime tag per page.** \`boot.js\` and \`runtime.js\` both install
  \`window.shipeasy\` and both bail out if that global already exists, so a page
  carrying both silently ignores the second. Which one you want is settled by a
  single question — *did a server already evaluate this request?*
- **Order matters.** Anything that must be readable on first paint goes before
  your app's own scripts, in source order. The runtime tag is parser-blocking on
  purpose; the i18n loader and the overlay are not.
- **Only \`sdk_client_…\` keys belong in HTML.** They are public by construction.
  A \`sdk_server_…\` key on any tag is a leaked secret — and the SSR bootstrap tag
  carries no key at all, by design.
- **Never emit a user id into a full-page HTML cache.** \`boot.js?u=…\` (or the
  bootstrap tag's \`data-user\`) is per-visitor; caching that page serves one
  visitor's assignments to everyone.`;

function sdkHelperBlock(t: WiringTarget, o: SnippetInput, refs?: ReferenceDocs): string[] {
  const build = HELPER_SNIPPETS[t.sdk];
  if (!build) {
    return [
      `This SDK has no tag-helper spelling baked into these notes. Take the helpers` +
        ` from ${docPointer(refs, t.sdk, "head-tags", "advanced")} and emit the tags` +
        ` from there, keeping the rules above.`,
    ];
  }
  const snip = build(o);
  const parts = [
    `Your server evaluates this request, so the browser must not evaluate it` +
      ` again: emit \`/sdk/runtime.js\` with the payload already attached. The SDK` +
      ` builds that tag — never hand-template it, the payload is JSON nobody should` +
      ` be assembling by hand and the helper also mints the \`__se_anon_id\` cookie` +
      ` so the browser buckets identically to the server.`,
    "",
    "```" + snip.fence,
    snip.code,
    "```",
  ];
  if (snip.notes) parts.push("", ...snip.notes.map((n) => `- ${n}`));
  parts.push(
    "",
    `- [ ] Add the block to this target's HTML shell / root layout.` +
      (t.entryPoints.length
        ? ` Detected entry point(s): ${t.entryPoints.map((e) => `\`${e}\``).join(", ")}.`
        : ""),
    `- [ ] The snippet above is a shape, not a signature. Full argument lists and` +
      ` every default each helper falls back to:` +
      ` ${docPointer(refs, t.sdk, "head-tags", "advanced")} — if it spells a helper` +
      ` differently than the snippet does, the doc is right.`,
  );
  return parts;
}

function npmClientBlock(t: WiringTarget, o: SnippetInput, clientVal: string, idVal: string): string[] {
  const parts = [
    `This target has a bundler, so it takes **no hosted runtime tag** — \`@shipeasy/sdk\`` +
      ` is already installed and owns flag reads, translations and \`track()\` in the` +
      ` browser. Adding \`boot.js\` or \`runtime.js\` alongside it would put two things` +
      ` in charge of \`window.shipeasy\`.`,
  ];
  if (o.devtools) {
    parts.push(
      "",
      `The one tag it does want is the overlay, in the HTML shell (\`index.html\`) —` +
        ` it is a hosted bundle, so none of it lands in your build:`,
      "",
      "```html",
      devtoolsHtml(clientVal, idVal),
      "```",
    );
  }
  if (o.i18n) {
    parts.push(
      "",
      `- Translations come through the client SDK here, not the hosted loader —` +
        ` see the translations section below.`,
    );
  }
  return parts;
}

function hostedBlock(o: SnippetInput, projectId: string, clientVal: string, idVal: string): string[] {
  const parts = [
    `Nothing evaluates this page server-side and there is no bundler, so the edge` +
      ` does the work: the preamble mints the bucketing unit and \`boot.js\` returns` +
      ` the runtime with this visitor's payload already inside it — one request from` +
      ` nothing to a populated \`window.shipeasy\`, before first paint.`,
    "",
    "```html",
    hostedBootHtml(projectId, clientVal),
    "```",
    "",
    `- If something on the page already knows who the visitor is (auth, an edge` +
      ` layer, your own session), drop the preamble and pass that id as \`u=<user id>\`` +
      ` instead — the anon cookie is only there because a static page has no server` +
      ` to put an id in the URL.`,
    `- A silent no-op almost always means the origin allowlist: a client key is` +
      ` scoped to the project's domains, and a classic \`<script>\` request is opaque,` +
      ` so the 403 never reaches the console. Re-request it from the page with` +
      ` \`fetch(url, { mode: "cors" })\` to see the real status, then add the origin in` +
      ` the project's domain settings.`,
  ];
  if (o.i18n) {
    parts.push(
      "",
      `Translations (independent of the tag above — combine freely):`,
      "",
      "```html",
      i18nLoaderHtml(clientVal),
      "```",
      "",
      `- Both \`data-key\` and \`data-profile\` are required or the loader silently` +
        ` no-ops. It installs \`window.i18n\` with \`t(key, vars)\` and fires` +
        ` \`se:i18n:ready\`.`,
    );
  }
  if (o.devtools) {
    parts.push("", `The devtools overlay:`, "", "```html", devtoolsHtml(clientVal, idVal), "```");
  }
  return parts;
}

/** Steps for tags the scan found that no longer exist server-side. */
function legacyTagSteps(targets: WiringTarget[]): string[] {
  const hits = targets.filter((t) => t.existingScripts?.legacy?.length);
  if (!hits.length) return [];
  const names: Record<string, string> = {
    loader: "`/sdk/loader.js`",
    bootstrap: "`/sdk/bootstrap.js`",
  };
  return [
    "",
    `### Dead tags already in this repo — replace them`,
    "",
    `\`/sdk/loader.js\` and \`/sdk/bootstrap.js\` were **deleted**; both URLs now 404.` +
      ` Any page still carrying one has no working Shipeasy runtime at all, so this is` +
      ` a fix, not a cleanup:`,
    "",
    ...hits.map((t) => {
      const found = (t.existingScripts?.legacy ?? []).map((l) => names[l] ?? `\`${l}\``).join(", ");
      const where = t.existingScripts?.file
        ? `\`${t.relPath === "." ? "" : `${t.relPath}/`}${t.existingScripts.file}\``
        : `${t.relPath === "." ? "the repo root" : `\`${t.relPath}/\``}`;
      return `- [ ] ${where} carries ${found} — delete that tag and use the block above instead.`;
    }),
    "",
    `\`bootstrap.js\` only copied \`data-*\` attributes into a global that \`runtime.js\`` +
      ` now reads directly, and \`loader.js\` was the pre-\`boot.js\` async client — the` +
      ` replacements above cover both read surfaces. The one thing that did not carry` +
      ` over is \`see()\`: structured error reporting needs the npm SDK on a bundled page.`,
  ];
}

/**
 * The whole `<head>` section. Whether this repo has a page to put tags on at
 * all is the caller's call — a native-only or headless repo never asks for it,
 * and a static site asks for it with no page target to attribute the tags to.
 */
export function headTagsSection(input: HeadTagsInput): string {
  const refs = input.docs;
  const pages = input.targets.filter((t) => t.browser && !t.native);
  const clientVal = input.clientKey ?? `<value of ${input.clientKeyVar} in env>`;
  const idVal = input.projectId || `<value of ${input.projectIdVar} in env>`;
  const o: SnippetInput = {
    i18n: input.i18n,
    devtools: input.devtools,
    clientKeyVar: input.clientKeyVar,
    projectIdVar: input.projectIdVar,
  };

  const lines: string[] = [
    `## Browser head tags`,
    "",
    `The tags below are collected for this repo's actual stack and already carry` +
      ` this project's public identifiers — the client key is public by design and` +
      ` the project id is not a secret, so both are inlined ready to paste.`,
    `Reference: https://docs.shipeasy.ai/sdks/script-loader`,
    "",
    RULES,
  ];

  if (!pages.length) {
    // No target renders a page, but the user accepted a browser surface — a
    // static site, a CMS template, or an HTML shell the scan couldn't attribute.
    lines.push("", `### The page (no server-side evaluation detected)`, "");
    lines.push(...hostedBlock(o, input.projectId, clientVal, idVal));
    lines.push("", `- [ ] Gate: load the page and \`window.shipeasy\` is defined before first paint.`);
    if (input.devtools) {
      lines.push(...devtoolsDocLines(refs));
      lines.push(`- [ ] Gate: load the app with \`?se=1\` and confirm the overlay mounts.`);
    }
    lines.push(...legacyTagSteps(input.targets));
    return lines.join("\n");
  }

  for (const t of pages) {
    const dir = t.relPath === "." ? "the repo root" : `\`${t.relPath}/\``;
    const fw = t.frameworks.length ? ` · ${t.frameworks.join(", ")}` : "";
    const strategy = tagStrategy(t);
    lines.push("", `### ${dir} (${t.language}${fw})`, "");
    if (strategy === "sdk-helper") lines.push(...sdkHelperBlock(t, o, refs));
    else if (strategy === "npm-client") lines.push(...npmClientBlock(t, o, clientVal, idVal));
    else lines.push(...hostedBlock(o, input.projectId, clientVal, idVal));
  }

  lines.push(
    "",
    `- [ ] Gate: load a page and \`window.shipeasy\` is defined before first paint` +
      ` (\`document.readyState\` still \`"loading"\` when it appears).`,
  );
  if (input.devtools) {
    lines.push(
      ...devtoolsDocLines(refs),
      `- [ ] Gate: load the app with \`?se=1\` (or Shift+Alt+S) and confirm the overlay mounts.`,
      `- [ ] The overlay tag can ship unconditionally — the panel only opens for someone` +
        ` with a signed-in Shipeasy session, so it renders nothing for an end user who has` +
        ` never authenticated. Gating it on your own staff or environment check is optional,` +
        ` and only worth it if you'd rather the bundle not load for end users at all.`,
    );
  }
  lines.push(...legacyTagSteps(input.targets));
  return lines.join("\n");
}
