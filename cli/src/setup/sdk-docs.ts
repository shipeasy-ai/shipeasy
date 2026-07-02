import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { customOperations } from "@shipeasy/openapi/custom";
import {
  listMarketplaceSkillReferences,
  marketplaceSkillFileRawUrl,
  marketplaceSkillRawUrl,
  runSkillsAdd,
} from "./skills-registry";

/**
 * SDK-docs helpers shared by `shipeasy setup` and the `docs skill --install`
 * command. These wrap the worker-safe docs registry ops (`docs get` / `docs
 * skill`, which `fetch` from each SDK's GitHub Pages) with the consumer-side
 * fs + `skills`-CLI side effects that place a fetched skill on disk.
 */

const docsGetOp = customOperations.find((o) => o.group[0] === "docs" && o.name === "get");
const docsSkillOp = customOperations.find((o) => o.group[0] === "docs" && o.name === "skill");

/** Plain GET → text, or null on any non-OK / network failure. */
async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** Fetch one SDK doc page's content (e.g. `installation`). Null on any failure. */
export async function fetchSdkDoc(
  sdk: string,
  path: string,
  framework?: string,
): Promise<string | null> {
  if (!docsGetOp) return null;
  try {
    const res = (await docsGetOp.run({
      sdk,
      path,
      ...(framework ? { framework } : {}),
    })) as { content?: string };
    return res.content ?? null;
  } catch {
    return null;
  }
}

/** Fetch an SDK's installable skill (SKILL.md content). Null when none/failure. */
export async function fetchSdkSkill(sdk: string): Promise<string | null> {
  if (!docsSkillOp) return null;
  try {
    const res = (await docsSkillOp.run({ sdk })) as { content?: string };
    return res.content ?? null;
  } catch {
    return null;
  }
}

/**
 * Write a skill's files into `<base>/<dirName>/` — `files` maps skill-relative
 * paths (`SKILL.md`, `references/foo.md`, …) to content. Returns the SKILL.md
 * path (the skill's entry point).
 */
export function writeSkillDir(
  files: Record<string, string>,
  dirName: string,
  base: string,
): string {
  const dir = join(base, dirName);
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  return join(dir, "SKILL.md");
}

// Snippet placeholders let a skill carry a language-neutral body and get the
// right, version-correct code baked in at install time: `{{SDK_SNIPPET:handle}}`
// (e.g. `{{SDK_SNIPPET:release/flags}}`) is replaced with the fetched snippet
// for the project's SDK. Unresolved placeholders degrade to a docs-get pointer.
const SNIPPET_RE = /\{\{SDK_SNIPPET:([^}]+)\}\}/g;

/**
 * Replace every `{{SDK_SNIPPET:handle}}` in `content` with the language-correct
 * snippet fetched from the SDK's docs (`docs get --sdk <sdk> <handle>`). Fetches
 * each distinct handle once. A handle that can't be fetched degrades to a
 * `shipeasy docs get …` instruction so the skill is still actionable.
 */
export async function substituteSdkSnippets(content: string, sdk: string): Promise<string> {
  const handles = [...content.matchAll(SNIPPET_RE)].map((m) => m[1].trim());
  if (!handles.length) return content;
  const fetched = new Map<string, string | null>();
  for (const h of new Set(handles)) fetched.set(h, await fetchSdkDoc(sdk, h));
  return content.replace(SNIPPET_RE, (_, raw) => {
    const h = String(raw).trim();
    const snip = fetched.get(h);
    return snip
      ? snip.trim()
      : `_(pull the ${sdk} snippet: \`shipeasy docs get --sdk ${sdk} ${h}\`)_`;
  });
}

export interface SkillInstallResult {
  action: "delegated" | "wrote" | "failed";
  detail: string;
}

/**
 * Place a skill's files on disk by **running the `skills` CLI ourselves**
 * (`npx -y skills add <src> [-a <agent>]…`), one `add` per named agent (else
 * auto-detect). `dirName` is the installed skill folder (e.g. `shipeasy-python`
 * or `shipeasy-flags`). Explicit `dir` skips delegation (direct write); if
 * `npx`/`skills` can't run we fall back to `.claude/skills/`.
 */
function placeSkill(
  files: Record<string, string>,
  dirName: string,
  opts: { dir?: string; global?: boolean; agent?: string; agents?: string[] },
): SkillInstallResult {
  if (opts.dir) {
    return { action: "wrote", detail: writeSkillDir(files, dirName, resolve(opts.dir)) };
  }
  const src = mkdtempSync(join(tmpdir(), "se-skill-"));
  writeSkillDir(files, dirName, src);
  const results = runSkillsAdd(src, {
    agents: opts.agent ? [opts.agent] : opts.agents,
    global: opts.global,
  });
  const done = results.filter((r) => r.ok && r.agent).map((r) => r.agent as string);
  if (results.some((r) => r.ok)) {
    return {
      action: "delegated",
      detail: done.length ? `skills add → ${done.join(", ")}` : "skills add (auto-detected)",
    };
  }
  const base = opts.global
    ? join(homedir(), ".claude", "skills")
    : join(process.cwd(), ".claude", "skills");
  return { action: "wrote", detail: writeSkillDir(files, dirName, base) };
}

/**
 * Install a fetched SDK skill, first baking in the language-correct snippets
 * (any `{{SDK_SNIPPET:…}}` placeholders resolve against `sdk`'s docs).
 */
export async function installSkill(
  content: string,
  sdk: string,
  opts: { dir?: string; global?: boolean; agent?: string; agents?: string[] } = {},
): Promise<SkillInstallResult> {
  const baked = await substituteSdkSnippets(content, sdk);
  return placeSkill({ "SKILL.md": baked }, `shipeasy-${sdk}`, opts);
}

/**
 * Install a marketplace how-to skill (e.g. `shipeasy-flags`) with its snippets
 * templated for `sdk`: fetch the skill's raw SKILL.md **and its `references/`
 * files** (skills follow the router-plus-references layout, so the references
 * carry part of the surface — including snippet placeholders), substitute
 * `{{SDK_SNIPPET:…}}` from `sdk`'s docs in every file, then place the whole
 * directory. Reference fetching is best-effort (a miss installs SKILL.md
 * alone); returns `failed` only when SKILL.md itself can't be fetched
 * (offline / renamed). `ref` pins the repo branch.
 */
export async function installMarketplaceSkill(
  name: string,
  sdk: string,
  opts: { agents?: string[]; global?: boolean; ref?: string } = {},
): Promise<SkillInstallResult> {
  const ref = opts.ref ?? "main";
  const raw = await fetchText(marketplaceSkillRawUrl(name, ref));
  if (!raw) return { action: "failed", detail: `${name}: could not fetch skill` };
  const files: Record<string, string> = { "SKILL.md": raw };
  for (const rel of await listMarketplaceSkillReferences(name, ref)) {
    const content = await fetchText(marketplaceSkillFileRawUrl(name, rel, ref));
    if (content) files[rel] = content;
  }
  for (const [rel, content] of Object.entries(files)) {
    files[rel] = await substituteSdkSnippets(content, sdk);
  }
  return placeSkill(files, name, { agents: opts.agents, global: opts.global });
}
