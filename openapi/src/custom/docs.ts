import { type CustomOp, CustomOpError } from "./types.js";

/**
 * SDK-docs operations — `docs list/get/skill`. A generic fetcher over each SDK
 * repo's `/docs/` folder published to plain GitHub Pages (latest only, no
 * backend, no version arg). The `run`s do outbound `fetch` (worker-safe — not
 * the fs/AST boundary) and fall back to a built-in default doc set for repos
 * that haven't adopted the doc standard yet.
 */
const SDK_REPOS: Record<string, { owner: string; repo: string }> = {
  typescript: { owner: "shipeasy-ai", repo: "sdk" },
  javascript: { owner: "shipeasy-ai", repo: "sdk" },
  node: { owner: "shipeasy-ai", repo: "sdk" },
  ts: { owner: "shipeasy-ai", repo: "sdk" },
  python: { owner: "shipeasy-ai", repo: "sdk-python" },
  go: { owner: "shipeasy-ai", repo: "sdk-go" },
  java: { owner: "shipeasy-ai", repo: "sdk-java" },
  kotlin: { owner: "shipeasy-ai", repo: "sdk-kotlin" },
  php: { owner: "shipeasy-ai", repo: "sdk-php" },
  swift: { owner: "shipeasy-ai", repo: "sdk-swift" },
  ruby: { owner: "shipeasy-ai", repo: "sdk-ruby" },
};
const SDK_ENUM = Object.keys(SDK_REPOS);

interface DocManifest {
  schemaVersion: number;
  sdk: string;
  placeholders?: string[];
  skill?: string;
  pages?: Record<string, string>;
  snippets?: Record<string, Record<string, string>>;
}

const DEFAULT_MANIFEST: DocManifest = {
  schemaVersion: 2,
  sdk: "default",
  placeholders: ["RESOURCE_NAME"],
  skill: "skill/SKILL.md",
  pages: { overview: "pages/overview.md", installation: "pages/installation.md" },
  snippets: { release: { flags: "snippets/release/flags.md" } },
};
const DEFAULT_CONTENT: Record<string, string> = {
  "pages/overview.md":
    "# Shipeasy SDK\n\nThis SDK has not published its `/docs/` folder yet. See https://docs.shipeasy.ai for the full reference.",
  "pages/installation.md":
    "# Installation\n\nInstall the Shipeasy SDK for your language, then call `shipeasy({ serverKey })` (server) or `shipeasy({ clientKey })` (browser).",
  "snippets/release/flags.md": "```\nconst on = await client.checkGate(user, '{{RESOURCE_NAME}}');\n```",
  "skill/SKILL.md":
    "---\nname: shipeasy-sdk\ndescription: Use the Shipeasy SDK for flags, experiments, configs, and i18n.\n---\n\nThis SDK has not published a skill yet. See https://docs.shipeasy.ai.",
};

function repoFor(sdk: string): { owner: string; repo: string } {
  const r = SDK_REPOS[sdk.toLowerCase()];
  if (!r) throw new CustomOpError(`Unknown SDK '${sdk}'. One of: ${SDK_ENUM.join(", ")}`, 400);
  return r;
}
function pagesBase(sdk: string): string {
  const { owner, repo } = repoFor(sdk);
  return `https://${owner}.github.io/${repo}`;
}
async function fetchText(url: string): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.text();
}
async function loadManifest(sdk: string): Promise<{ manifest: DocManifest; fallback: boolean }> {
  const text = await fetchText(`${pagesBase(sdk)}/manifest.json`);
  if (!text) return { manifest: DEFAULT_MANIFEST, fallback: true };
  try {
    return { manifest: JSON.parse(text) as DocManifest, fallback: false };
  } catch {
    return { manifest: DEFAULT_MANIFEST, fallback: true };
  }
}
function resolvePath(manifest: DocManifest, handle: string): string {
  if (handle.endsWith(".md")) return handle;
  if (manifest.pages?.[handle]) return manifest.pages[handle];
  if (handle.includes("/")) {
    const [group, resource] = handle.split("/", 2);
    const p = manifest.snippets?.[group]?.[resource];
    if (p) return p;
  }
  throw new CustomOpError(
    `Doc '${handle}' not found. Run 'docs list --sdk <lang>' to see available pages and snippets.`,
    404,
  );
}
function substitute(body: string, manifest: DocManifest, args: Record<string, unknown>): string {
  let out = body;
  for (const ph of manifest.placeholders ?? []) {
    const value =
      (args[ph] as string | undefined) ??
      (ph === "RESOURCE_NAME" ? (args.name as string | undefined) : undefined) ??
      (ph === "FRAMEWORK" ? (args.framework as string | undefined) : undefined);
    if (value !== undefined) out = out.replaceAll(`{{${ph}}}`, value);
  }
  return out;
}

export const docsOps: CustomOp[] = [
  {
    group: ["docs"],
    name: "list",
    summary: "List an SDK's documentation tree",
    description:
      "Fetch an SDK's `/docs/manifest.json` and return the doc tree — feature pages, nested snippet groups, and whether an installable skill exists.",
    params: [{ name: "sdk", type: "string", description: "SDK language.", required: true, enum: SDK_ENUM }],
    examples: [{ run: "shipeasy docs list --sdk python" }],
    run: async (args) => {
      const { manifest, fallback } = await loadManifest(args.sdk as string);
      return {
        sdk: args.sdk,
        fallback,
        pages: Object.keys(manifest.pages ?? {}),
        snippets: Object.fromEntries(
          Object.entries(manifest.snippets ?? {}).map(([g, r]) => [g, Object.keys(r)]),
        ),
        skill: Boolean(manifest.skill),
      };
    },
  },
  {
    group: ["docs"],
    name: "get",
    summary: "Fetch one SDK doc page or snippet",
    description:
      "Fetch one feature page (`flags`, `experiments`, …) or nested snippet (`release/experiments`, …), substituting declared {{placeholders}} from caller args.",
    params: [
      { name: "sdk", type: "string", description: "SDK language.", required: true, enum: SDK_ENUM },
      { name: "path", type: "string", description: "Page key or snippet 'group/resource'.", required: true, positional: true },
      { name: "framework", type: "string", description: "Framework hint (substitutes {{FRAMEWORK}})." },
      { name: "name", type: "string", description: "Resource name (substitutes {{RESOURCE_NAME}})." },
    ],
    examples: [
      { note: "A feature page", run: "shipeasy docs get --sdk python experiments" },
      { note: "A nested snippet", run: "shipeasy docs get --sdk typescript release/flags --name checkout_v2" },
    ],
    run: async (args) => {
      const sdk = args.sdk as string;
      const { manifest, fallback } = await loadManifest(sdk);
      const path = resolvePath(manifest, args.path as string);
      const body = fallback ? DEFAULT_CONTENT[path] : ((await fetchText(`${pagesBase(sdk)}/${path}`)) ?? undefined);
      if (body === undefined) throw new CustomOpError(`Doc '${path}' could not be fetched for '${sdk}'.`, 404);
      return { sdk, path, fallback, content: substitute(body, manifest, args) };
    },
  },
  {
    group: ["docs"],
    name: "skill",
    summary: "Fetch an SDK's installable LLM skill",
    description:
      "Fetch the SDK's `skill/SKILL.md` (frontmatter intact) so an agent can install it verbatim. The CLI `--install` writes it locally (a consumer fs side-effect).",
    params: [
      { name: "sdk", type: "string", description: "SDK language.", required: true, enum: SDK_ENUM },
      { name: "install", type: "boolean", description: "CLI only: write the skill to the local agent skills dir." },
    ],
    examples: [{ run: "shipeasy docs skill --sdk python" }],
    run: async (args) => {
      const sdk = args.sdk as string;
      const { manifest, fallback } = await loadManifest(sdk);
      const skillPath = manifest.skill ?? "skill/SKILL.md";
      const content = fallback ? DEFAULT_CONTENT[skillPath] : ((await fetchText(`${pagesBase(sdk)}/${skillPath}`)) ?? undefined);
      if (content === undefined) throw new CustomOpError(`No skill published for '${sdk}'.`, 404);
      return { sdk, skillPath, fallback, content };
    },
  },
];
