import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Command } from "commander";
import { getApiClient, ApiError } from "../api/client";
import { printTable, printJson } from "../util/output";
import { withExamples } from "../util/examples";

interface Attachment {
  id: string;
  kind: "screenshot" | "recording" | "file";
  filename: string | null;
  contentType: string | null;
  size: number | null;
  createdAt: string;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "application/pdf": "pdf",
  "application/json": "json",
  "text/plain": "txt",
};

/** Minimum shape every feedback item shares — enough to list, find, and label. */
interface FeedbackItem {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  [key: string]: unknown;
}

const BUG_STATUSES = [
  "open",
  "triaged",
  "in_progress",
  "ready_for_qa",
  "resolved",
  "wont_fix",
] as const;

// Bugs and feature requests share one status set and one priority set; only the
// `type` and the free-text fields differ. Lowest priority tier is `nice_to_have`.
const BUG_PRIORITIES = ["nice_to_have", "medium", "high", "critical"] as const;

const FEATURE_REQUEST_STATUSES = BUG_STATUSES;

interface Connector {
  id: string;
  provider: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
}

interface GithubRepo {
  owner: string;
  repo: string;
}

/** Canonical GitHub pull-request URL. Mirrors core's githubPrUrl; inlined to
 *  avoid a cross-package dependency just for one template string. */
function githubPrUrl(owner: string, repo: string, prNumber: number): string {
  return `https://github.com/${owner}/${repo}/pull/${prNumber}`;
}

function repoFromConfig(config: Record<string, unknown> | null | undefined): GithubRepo | null {
  const owner = config?.owner;
  const repo = config?.repo;
  return typeof owner === "string" && owner && typeof repo === "string" && repo
    ? { owner, repo }
    : null;
}

/**
 * Resolve the owner/repo to build a PR link against. Prefers an enabled GitHub
 * connector, then any GitHub connector with a repo configured, then the
 * owner/repo the connector stamped onto the item's `connector_data.github.issue`.
 * Returns null when none of those yield a repo.
 */
async function resolveGithubRepo(
  client: { request: <T>(method: string, path: string, body?: unknown) => Promise<T> },
  endpoint: string,
  itemId: string,
): Promise<GithubRepo | null> {
  try {
    const connectors = await client.request<Connector[]>("GET", "/api/admin/connectors");
    const github = connectors.filter((c) => c.provider === "github");
    const enabled = github.find((c) => c.enabled && repoFromConfig(c.config));
    const fromConnector = repoFromConfig(
      (enabled ?? github.find((c) => repoFromConfig(c.config)))?.config,
    );
    if (fromConnector) return fromConnector;
  } catch {
    /* connectors unreadable — fall through to the item's own connector_data */
  }
  try {
    const detail = await client.request<{
      connectorData?: { github?: { issue?: Record<string, unknown> } };
    }>("GET", `${endpoint}/${itemId}`);
    return repoFromConfig(detail.connectorData?.github?.issue);
  } catch {
    return null;
  }
}

// ── Resource descriptor ─────────────────────────────────────────────────────
//
// Bugs and feature requests are the same kind of thing — a titled, status-
// tracked piece of feedback with attachments — so they expose an identical
// command surface (list / get / update / create / delete / attachments). The
// only differences are declarative: which endpoint and which free-text fields
// `create` accepts. Status and priority are shared. Everything below is built
// once from this descriptor so the two resources can never drift apart.

/** A secondary single-value classification filter (the shared `priority`). */
interface ClassAttr {
  /** Commander option spec, e.g. "--priority <priority>". */
  flag: string;
  /** camelCased option key Commander produces, e.g. "priority". */
  optionKey: string;
  /** Item field to compare against, e.g. "priority". */
  field: string;
  /** Allowed values (also used to validate update/list input). */
  values: readonly string[];
  /** Human label used in help + error text, e.g. "priority". */
  label: string;
}

/** One `create` option → request-body field mapping. */
interface CreateField {
  /** Commander option spec, e.g. "--steps <text>". */
  flag: string;
  description: string;
  /** Request-body key this maps to, e.g. "stepsToReproduce". */
  bodyKey: string;
  /** Required vs optional. Optional fields may carry a default. */
  required?: boolean;
  default?: string;
}

export interface FeedbackResourceSpec {
  /** Subcommand name + plural noun, e.g. "bugs". */
  name: string;
  /**
   * Registered command token, when it differs from `name`. The `ops` alias
   * reuses these specs as flat dotted commands (`ops.bugs`, `ops.features`)
   * while keeping `name` as the human noun used in help + messages.
   */
  command?: string;
  /** One-line description for `--help`. */
  description: string;
  /** Admin API collection path, e.g. "/api/admin/bugs". */
  endpoint: string;
  /** Singular noun for messages, e.g. "bug" / "feature request". */
  noun: string;
  /** Capitalised singular for not-found errors, e.g. "Bug". */
  nounCap: string;
  statuses: readonly string[];
  attr: ClassAttr;
  /** Positional create arg label, almost always "<title>". */
  createTitle: string;
  createFields: CreateField[];
  /** Whether this resource supports GitHub PR linking (bugs + features). */
  supportsPr?: boolean;
}

function findByIdOrPrefix<T extends FeedbackItem>(items: T[], id: string): T | undefined {
  return items.find((i) => i.id === id || i.id.startsWith(id));
}

/**
 * Register the full, identical command surface for one feedback resource onto
 * `parent` (the `feedback` command). Called once per resource — bugs gain
 * `link-pr`, both gain everything else.
 */
export function defineFeedbackResource(parent: Command, spec: FeedbackResourceSpec): void {
  const group = parent.command(spec.command ?? spec.name).description(spec.description);
  const notFound = (id: string) => new ApiError(`${spec.nounCap} not found: ${id}`, 404);

  // Full invocation prefix for examples, e.g. "shipeasy feedback bugs" or
  // "shipeasy ops.bugs" — walk the command tree up to (but not including) the
  // root program so `feedback`/`ops.*` mountings both render correctly.
  const groupPath = (() => {
    const parts: string[] = [];
    let c: Command | null = group;
    while (c && c.parent) {
      parts.unshift(c.name());
      c = c.parent;
    }
    return `shipeasy ${parts.join(" ")}`;
  })();

  // ── list ───────────────────────────────────────────────────────────────
  const listCmd = group
    .command("list")
    .description(`List ${spec.name}`)
    .option("--status <status>", `Filter by status: ${spec.statuses.join("|")}`)
    .option(spec.attr.flag, `Filter by ${spec.attr.label}: ${spec.attr.values.join("|")}`)
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        const client = getApiClient(opts.project);
        let items = await client.request<FeedbackItem[]>("GET", spec.endpoint);
        if (opts.status) {
          if (!spec.statuses.includes(opts.status))
            throw new ApiError(`Invalid status: ${opts.status}`, 400);
          items = items.filter((i) => i.status === opts.status);
        }
        const attrValue = opts[spec.attr.optionKey] as string | undefined;
        if (attrValue) {
          if (!spec.attr.values.includes(attrValue))
            throw new ApiError(`Invalid ${spec.attr.label}: ${attrValue}`, 400);
          items = items.filter((i) => i[spec.attr.field] === attrValue);
        }
        if (opts.json) return printJson(items);
        if (!items.length) return void console.log(`No ${spec.name} found.`);
        printTable(
          ["ID", "Title", "Status", capitalize(spec.attr.label), "Created"],
          items.map((i) => [
            i.id.slice(0, 8),
            i.title,
            i.status,
            (i[spec.attr.field] as string | null | undefined) ?? "—",
            i.createdAt,
          ]),
        );
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(listCmd, [
    {
      note: `Only open ${spec.name}`,
      run: `${groupPath} list --status open`,
    },
  ]);

  // ── get ────────────────────────────────────────────────────────────────
  const getCmd = group
    .command("get <id>")
    .description(`Show one ${spec.noun} by id (or id prefix)`)
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (id: string, opts) => {
      try {
        const client = getApiClient(opts.project);
        const items = await client.request<FeedbackItem[]>("GET", spec.endpoint);
        const match = findByIdOrPrefix(items, id);
        if (!match) throw notFound(id);
        const full = await client.request<Record<string, unknown>>(
          "GET",
          `${spec.endpoint}/${match.id}`,
        );
        if (opts.json) return printJson(full);
        console.log(JSON.stringify(full, null, 2));
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(getCmd, [
    { note: "Look up by id prefix", run: `${groupPath} get a1b2c3d4` },
  ]);

  // ── update ─────────────────────────────────────────────────────────────
  const updateCmd = group
    .command("update <id>")
    .description(`Update a ${spec.noun} — supports --status and ${spec.attr.flag}`)
    .option("--status <status>", `New status: ${spec.statuses.join("|")}`)
    .option(spec.attr.flag, `New ${spec.attr.label}: ${spec.attr.values.join("|")}`)
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (id: string, opts) => {
      try {
        const patch: Record<string, unknown> = {};
        if (opts.status) {
          if (!spec.statuses.includes(opts.status))
            throw new ApiError(`Invalid status: ${opts.status}`, 400);
          patch.status = opts.status;
        }
        const attrValue = opts[spec.attr.optionKey] as string | undefined;
        if (attrValue) {
          if (!spec.attr.values.includes(attrValue))
            throw new ApiError(`Invalid ${spec.attr.label}: ${attrValue}`, 400);
          patch[spec.attr.field] = attrValue;
        }
        if (Object.keys(patch).length === 0)
          throw new ApiError(`Nothing to update — pass --status or ${spec.attr.flag}`, 400);

        const client = getApiClient(opts.project, { requireBinding: true });
        const items = await client.request<FeedbackItem[]>("GET", spec.endpoint);
        const match = findByIdOrPrefix(items, id);
        if (!match) throw notFound(id);
        const updated = await client.request<FeedbackItem>(
          "PATCH",
          `${spec.endpoint}/${match.id}`,
          patch,
        );
        if (opts.json) return printJson(updated);
        const changed = Object.entries(patch)
          .map(([k, v]) => `${k} → ${v}`)
          .join(", ");
        console.log(`Updated ${match.id.slice(0, 8)}: ${changed}`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(updateCmd, [
    { note: "Mark in progress", run: `${groupPath} update a1b2c3d4 --status in_progress` },
    {
      note: `Bump ${spec.attr.label}`,
      run: `${groupPath} update a1b2c3d4 ${spec.attr.flag.split(" ")[0]} high`,
    },
  ]);

  // ── create ─────────────────────────────────────────────────────────────
  const create = group
    .command(`create ${spec.createTitle}`)
    .description(`File a ${spec.noun}`)
    .option("--page-url <url>", "Page URL where it was observed")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override");
  for (const field of spec.createFields) {
    if (field.required) create.requiredOption(field.flag, field.description);
    else create.option(field.flag, field.description, field.default);
  }
  create.action(async (title: string, opts) => {
    try {
      const client = getApiClient(opts.project, { requireBinding: true });
      const body: Record<string, unknown> = { title };
      for (const field of spec.createFields) {
        const value = opts[optionKeyOf(field.flag)];
        if (value !== undefined) body[field.bodyKey] = value;
      }
      if (opts.pageUrl) body.pageUrl = opts.pageUrl;
      const data = await client.request("POST", spec.endpoint, body);
      if (opts.json) return printJson(data);
      console.log(`Filed ${spec.noun}: ${title}`);
    } catch (e) {
      handleError(e);
    }
  });

  // Build a create example from the spec's required fields, e.g.
  // `… create "Title" --steps "…" --actual "…" --expected "…"`.
  const createFlags = spec.createFields
    .map((f) => `${f.flag.split(" ")[0]} "…"`)
    .join(" ");
  withExamples(create, [
    {
      note: `File a ${spec.noun}`,
      run: `${groupPath} create "Short ${spec.noun} title" ${createFlags}`,
    },
  ]);

  // ── delete ─────────────────────────────────────────────────────────────
  const deleteCmd = group
    .command("delete <id>")
    .description(`Delete a ${spec.noun} by id (or id prefix)`)
    .option("--project <id>", "Project ID override")
    .action(async (id: string, opts) => {
      try {
        const client = getApiClient(opts.project, { requireBinding: true });
        const items = await client.request<FeedbackItem[]>("GET", spec.endpoint);
        const match = findByIdOrPrefix(items, id);
        if (!match) throw notFound(id);
        await client.request("DELETE", `${spec.endpoint}/${match.id}`);
        console.log(`Deleted: ${match.title}`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(deleteCmd, [
    { note: "Delete by id prefix", run: `${groupPath} delete a1b2c3d4` },
  ]);

  // ── attachments ────────────────────────────────────────────────────────
  const attachmentsCmd = group
    .command(`attachments <id>`)
    .description(
      `Download all attachments for a ${spec.noun} to a local directory. Prints one absolute path per line on stdout (suitable for piping into other tools).`,
    )
    .option(
      "--out <dir>",
      `Output directory. Defaults to a tmpdir under $TMPDIR/shipeasy-${spec.name}/<id>/`,
    )
    .option("--json", "Output JSON metadata instead of plain paths")
    .option("--project <id>", "Project ID override")
    .action(async (id: string, opts: { out?: string; json?: boolean; project?: string }) => {
      try {
        const client = getApiClient(opts.project);
        const items = await client.request<FeedbackItem[]>("GET", spec.endpoint);
        const match = findByIdOrPrefix(items, id);
        if (!match) throw notFound(id);
        const detail = await client.request<{ attachments?: Attachment[] }>(
          "GET",
          `${spec.endpoint}/${match.id}`,
        );
        const attachments = detail.attachments ?? [];
        if (attachments.length === 0) {
          if (opts.json) printJson([]);
          else console.error(`No attachments for ${spec.noun} ${match.id}.`);
          return;
        }
        const outDir = opts.out ?? path.join(os.tmpdir(), `shipeasy-${spec.name}`, match.id);
        fs.mkdirSync(outDir, { recursive: true });
        const written: Array<{ id: string; kind: string; path: string; bytes: number }> = [];
        for (const a of attachments) {
          const res = await client.requestRaw("GET", `/api/admin/reports/attachments/${a.id}`);
          const buf = Buffer.from(await res.arrayBuffer());
          const ext =
            (a.filename && path.extname(a.filename).replace(/^\./, "")) ||
            (a.contentType && EXT_BY_MIME[a.contentType.toLowerCase()]) ||
            "bin";
          const file = path.join(outDir, `${a.id}.${ext}`);
          fs.writeFileSync(file, buf);
          written.push({ id: a.id, kind: a.kind, path: file, bytes: buf.length });
        }
        if (opts.json) {
          printJson(written);
        } else {
          for (const w of written) console.log(w.path);
        }
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(attachmentsCmd, [
    {
      note: "Download attachments to a directory",
      run: `${groupPath} attachments a1b2c3d4 --out ./shots`,
    },
  ]);

  // ── link-pr (PR-linking resources only) ──────────────────────────────────
  // The connector-tracked GitHub issue (connector_data.github.issue.number) is
  // already delivered by `get`, so an automated fixer reads it from there to
  // reference the issue (e.g. "Closes #123") when opening a PR. Linking the PR
  // here also wires it to that issue server-side (Closes #N / comment).
  if (spec.supportsPr) {
    const linkPr = group
      .command("link-pr <id> <pr-number>")
      .description(
        `Link a GitHub pull request to a ${spec.noun}. When a GitHub connector is configured, prints the PR URL.`,
      )
      .option("--remove", "Unlink the PR instead of setting one")
      .option("--json", "Output as JSON")
      .option("--project <id>", "Project ID override")
      .action(async (id: string, prNumberArg: string, opts) => {
        try {
          const client = getApiClient(opts.project, { requireBinding: true });
          const list = await client.request<FeedbackItem[]>("GET", spec.endpoint);
          const match = findByIdOrPrefix(list, id);
          if (!match) throw notFound(id);

          if (opts.remove) {
            await client.request("PATCH", `${spec.endpoint}/${match.id}`, { githubPrNumber: null });
            if (opts.json) return printJson({ id: match.id, prNumber: null, url: null });
            return void console.log(`Unlinked PR from ${spec.noun} ${match.id.slice(0, 8)}.`);
          }

          const prNumber = Number(prNumberArg);
          if (!Number.isInteger(prNumber) || prNumber <= 0) {
            throw new ApiError(`Invalid PR number: ${prNumberArg}`, 400);
          }
          await client.request("PATCH", `${spec.endpoint}/${match.id}`, {
            githubPrNumber: prNumber,
          });

          const repo = await resolveGithubRepo(client, spec.endpoint, match.id);
          const url = repo ? githubPrUrl(repo.owner, repo.repo, prNumber) : null;
          if (opts.json) return printJson({ id: match.id, prNumber, url });
          console.log(`Linked PR #${prNumber} to ${spec.noun} ${match.id.slice(0, 8)}.`);
          if (url) console.log(url);
          else
            console.log(
              "(No GitHub connector with a configured repo — set one up to get a PR link.)",
            );
        } catch (e) {
          handleError(e);
        }
      });

    withExamples(linkPr, [
      { note: "Link the PR that fixed it", run: `${groupPath} link-pr a1b2c3d4 42` },
      { note: "Unlink the PR", run: `${groupPath} link-pr a1b2c3d4 0 --remove` },
    ]);
  }
}

/** "--steps <text>" → "steps"; "--page-url <url>" → "pageUrl" (Commander's key). */
function optionKeyOf(flag: string): string {
  const long = flag.replace(/^--/, "").replace(/\s+.*$/, "");
  return long.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const BUGS_SPEC: FeedbackResourceSpec = {
  name: "bugs",
  description: "Bug reports",
  endpoint: "/api/admin/bugs",
  noun: "bug",
  nounCap: "Bug",
  statuses: BUG_STATUSES,
  attr: {
    flag: "--priority <priority>",
    optionKey: "priority",
    field: "priority",
    values: BUG_PRIORITIES,
    label: "priority",
  },
  createTitle: "<title>",
  createFields: [
    {
      flag: "--steps <text>",
      description: "Steps to reproduce",
      bodyKey: "stepsToReproduce",
      required: true,
    },
    {
      flag: "--actual <text>",
      description: "Actual result",
      bodyKey: "actualResult",
      required: true,
    },
    {
      flag: "--expected <text>",
      description: "Expected result",
      bodyKey: "expectedResult",
      required: true,
    },
  ],
  supportsPr: true,
};

export const FEATURES_SPEC: FeedbackResourceSpec = {
  name: "features",
  description: "Feature requests",
  endpoint: "/api/admin/feature-requests",
  noun: "feature request",
  nounCap: "Feature request",
  statuses: FEATURE_REQUEST_STATUSES,
  // Shared with bugs (was `importance`). Set via `update --priority`, like bugs.
  attr: {
    flag: "--priority <priority>",
    optionKey: "priority",
    field: "priority",
    values: BUG_PRIORITIES,
    label: "priority",
  },
  createTitle: "<title>",
  createFields: [
    {
      flag: "--description <text>",
      description: "Description",
      bodyKey: "description",
      required: true,
    },
    { flag: "--use-case <text>", description: "Use case", bodyKey: "useCase", required: true },
  ],
  supportsPr: true,
};

export function feedbackCommand(parent: Command): void {
  const f = parent.command("feedback").description("Manage bug reports and feature requests");
  defineFeedbackResource(f, BUGS_SPEC);
  defineFeedbackResource(f, FEATURES_SPEC);
}

export function handleError(e: unknown): void {
  if (e instanceof ApiError) {
    console.error(`Error (${e.status}): ${e.message}`);
  } else {
    console.error(String(e));
  }
  process.exit(1);
}
