import { grammarOp } from "./grammar.js";
import { docsOps } from "./docs.js";
import type { CustomOp, CustomGroup } from "./types.js";

export type { CustomOp, CustomGroup, CustomParam, CustomParamType } from "./types.js";
export { CustomOpError, opId } from "./types.js";
export { METRIC_GRAMMAR } from "./grammar.js";

/**
 * Every custom (non-spec) operation, in surface order. The CLI and MCP each
 * project this with a thin adapter so the sugar commands stay in sync.
 */
export const customOperations: CustomOp[] = [grammarOp, ...docsOps];

/**
 * Group-level help for custom-op groups that aren't backed by an OpenAPI tag.
 * `metrics` is a spec tag (its group is created — and described — by the
 * generated tree), so only `docs` needs an entry here; without it the CLI would
 * label the group the bare `"docs commands"`.
 */
export const customGroups: CustomGroup[] = [
  {
    group: ["docs"],
    summary:
      "SDK docs: fetch a language SDK's published docs — its page tree, feature pages, code snippets, and installable agent skill.",
    description:
      "SDK docs — a read-only fetcher over each language SDK's `/docs/` folder, " +
      "published to plain GitHub Pages (latest only; no backend, no version arg). " +
      "Point it at an SDK with `--sdk <lang>` (one of: typescript, python, go, " +
      "java, kotlin, php, swift, ruby) or let it default to the `sdk` recorded in " +
      "the nearest `.shipeasy`.\n\n" +
      "**Commands.**\n" +
      "- `list` — the SDK's doc tree: feature pages, nested snippet groups, and whether an installable skill exists.\n" +
      "- `get <path>` — one feature page (`flags`, `experiments`, …) or nested snippet (`release/flags`), with `{{placeholders}}` substituted from `--name`/`--framework`.\n" +
      "- `skill` — the SDK's installable LLM skill (`SKILL.md`); `--install` writes it into your agent's skills dir.\n\n" +
      "SDKs that haven't adopted the doc standard yet fall back to a built-in " +
      "default doc set, flagged `fallback: true` in the output.",
  },
];
