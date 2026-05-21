import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Command } from "commander";
import { getApiClient, ApiError } from "../api/client";
import { printTable, printJson } from "../util/output";

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

interface Bug {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  pageUrl: string | null;
  createdAt: string;
}

const BUG_STATUSES = [
  "open",
  "triaged",
  "in_progress",
  "ready_for_qa",
  "resolved",
  "wont_fix",
] as const;
type BugStatus = (typeof BUG_STATUSES)[number];

function isBugStatus(s: string): s is BugStatus {
  return (BUG_STATUSES as readonly string[]).includes(s);
}

interface Feature {
  id: string;
  title: string;
  status: string;
  importance: string;
  createdAt: string;
}

export function feedbackCommand(parent: Command): void {
  const f = parent.command("feedback").description("Manage bug reports and feature requests");

  // ── bugs ─────────────────────────────────────────────────────────────
  const bugs = f.command("bugs").description("Bug reports");

  bugs
    .command("list")
    .description("List bug reports")
    .option("--status <status>", `Filter by status: ${BUG_STATUSES.join("|")}`)
    .option("--priority <priority>", "Filter by priority: low|medium|high|critical")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        const client = getApiClient(opts.project);
        let items = await client.request<Bug[]>("GET", "/api/admin/bugs");
        if (opts.status) {
          if (!isBugStatus(opts.status))
            throw new ApiError(`Invalid status: ${opts.status}`, 400);
          items = items.filter((b) => b.status === opts.status);
        }
        if (opts.priority) {
          items = items.filter((b) => b.priority === opts.priority);
        }
        if (opts.json) return printJson(items);
        if (!items.length) return void console.log("No bugs found.");
        printTable(
          ["ID", "Title", "Status", "Priority", "Created"],
          items.map((b) => [
            b.id.slice(0, 8),
            b.title,
            b.status,
            b.priority ?? "—",
            b.createdAt,
          ]),
        );
      } catch (e) {
        handleError(e);
      }
    });

  bugs
    .command("get <id>")
    .description("Show one bug by id (or id prefix)")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (id: string, opts) => {
      try {
        const client = getApiClient(opts.project);
        const items = await client.request<Bug[]>("GET", "/api/admin/bugs");
        const match = items.find((b) => b.id === id || b.id.startsWith(id));
        if (!match) throw new ApiError(`Bug not found: ${id}`, 404);
        const full = await client.request<Record<string, unknown>>(
          "GET",
          `/api/admin/bugs/${match.id}`,
        );
        if (opts.json) return printJson(full);
        console.log(JSON.stringify(full, null, 2));
      } catch (e) {
        handleError(e);
      }
    });

  bugs
    .command("update <id>")
    .description("Update a bug — currently supports --status")
    .option("--status <status>", `New status: ${BUG_STATUSES.join("|")}`)
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (id: string, opts) => {
      try {
        if (!opts.status) throw new ApiError("Nothing to update — pass --status", 400);
        if (!isBugStatus(opts.status))
          throw new ApiError(`Invalid status: ${opts.status}`, 400);
        const client = getApiClient(opts.project, { requireBinding: true });
        const items = await client.request<Bug[]>("GET", "/api/admin/bugs");
        const match = items.find((b) => b.id === id || b.id.startsWith(id));
        if (!match) throw new ApiError(`Bug not found: ${id}`, 404);
        const updated = await client.request<Bug>("PATCH", `/api/admin/bugs/${match.id}`, {
          status: opts.status,
        });
        if (opts.json) return printJson(updated);
        console.log(`Updated ${match.id.slice(0, 8)}: status → ${opts.status}`);
      } catch (e) {
        handleError(e);
      }
    });

  bugs
    .command("create <title>")
    .description("File a bug report")
    .requiredOption("--steps <text>", "Steps to reproduce")
    .requiredOption("--actual <text>", "Actual result")
    .requiredOption("--expected <text>", "Expected result")
    .option("--page-url <url>", "Page URL where the bug was observed")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (title: string, opts) => {
      try {
        const client = getApiClient(opts.project, { requireBinding: true });
        const body: Record<string, unknown> = {
          title,
          stepsToReproduce: opts.steps,
          actualResult: opts.actual,
          expectedResult: opts.expected,
        };
        if (opts.pageUrl) body.pageUrl = opts.pageUrl;
        const data = await client.request("POST", "/api/admin/bugs", body);
        if (opts.json) return printJson(data);
        console.log(`Filed bug: ${title}`);
      } catch (e) {
        handleError(e);
      }
    });

  bugs
    .command("attachments <bug-id>")
    .description(
      "Download all attachments for a bug to a local directory. Prints one absolute path per line on stdout (suitable for piping into other tools).",
    )
    .option(
      "--out <dir>",
      "Output directory. Defaults to a tmpdir under $TMPDIR/shipeasy-bugs/<bug-id>/",
    )
    .option("--json", "Output JSON metadata instead of plain paths")
    .option("--project <id>", "Project ID override")
    .action(
      async (
        bugId: string,
        opts: { out?: string; json?: boolean; project?: string },
      ) => {
        try {
          const client = getApiClient(opts.project);
          const items = await client.request<Bug[]>("GET", "/api/admin/bugs");
          const match = items.find((b) => b.id === bugId || b.id.startsWith(bugId));
          if (!match) throw new ApiError(`Bug not found: ${bugId}`, 404);
          const detail = await client.request<{ attachments?: Attachment[] }>(
            "GET",
            `/api/admin/bugs/${match.id}`,
          );
          const attachments = detail.attachments ?? [];
          if (attachments.length === 0) {
            if (opts.json) printJson([]);
            else console.error(`No attachments for bug ${match.id}.`);
            return;
          }
          const outDir =
            opts.out ?? path.join(os.tmpdir(), "shipeasy-bugs", match.id);
          fs.mkdirSync(outDir, { recursive: true });
          const written: Array<{ id: string; kind: string; path: string; bytes: number }> = [];
          for (const a of attachments) {
            const res = await client.requestRaw(
              "GET",
              `/api/admin/reports/attachments/${a.id}`,
            );
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
      },
    );

  bugs
    .command("delete <id>")
    .description("Delete a bug by id (or id prefix)")
    .option("--project <id>", "Project ID override")
    .action(async (id: string, opts) => {
      try {
        const client = getApiClient(opts.project, { requireBinding: true });
        const items = await client.request<Bug[]>("GET", "/api/admin/bugs");
        const match = items.find((b) => b.id === id || b.id.startsWith(id));
        if (!match) throw new ApiError(`Bug not found: ${id}`, 404);
        await client.request("DELETE", `/api/admin/bugs/${match.id}`);
        console.log(`Deleted: ${match.title}`);
      } catch (e) {
        handleError(e);
      }
    });

  // ── feature requests ─────────────────────────────────────────────────
  const features = f.command("features").description("Feature requests");

  features
    .command("list")
    .description("List feature requests")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        const client = getApiClient(opts.project);
        const items = await client.request<Feature[]>("GET", "/api/admin/feature-requests");
        if (opts.json) return printJson(items);
        if (!items.length) return void console.log("No feature requests found.");
        printTable(
          ["ID", "Title", "Status", "Importance"],
          items.map((r) => [r.id.slice(0, 8), r.title, r.status, r.importance]),
        );
      } catch (e) {
        handleError(e);
      }
    });

  features
    .command("create <title>")
    .description("File a feature request")
    .requiredOption("--description <text>", "Description")
    .requiredOption("--use-case <text>", "Use case")
    .option("--importance <level>", "nice_to_have | important | critical", "nice_to_have")
    .option("--page-url <url>", "Page URL")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (title: string, opts) => {
      try {
        const client = getApiClient(opts.project, { requireBinding: true });
        const body: Record<string, unknown> = {
          title,
          description: opts.description,
          useCase: opts.useCase,
          importance: opts.importance,
        };
        if (opts.pageUrl) body.pageUrl = opts.pageUrl;
        const data = await client.request("POST", "/api/admin/feature-requests", body);
        if (opts.json) return printJson(data);
        console.log(`Filed feature request: ${title}`);
      } catch (e) {
        handleError(e);
      }
    });

  features
    .command("delete <id>")
    .description("Delete a feature request by id (or id prefix)")
    .option("--project <id>", "Project ID override")
    .action(async (id: string, opts) => {
      try {
        const client = getApiClient(opts.project, { requireBinding: true });
        const items = await client.request<Feature[]>("GET", "/api/admin/feature-requests");
        const match = items.find((r) => r.id === id || r.id.startsWith(id));
        if (!match) throw new ApiError(`Feature request not found: ${id}`, 404);
        await client.request("DELETE", `/api/admin/feature-requests/${match.id}`);
        console.log(`Deleted: ${match.title}`);
      } catch (e) {
        handleError(e);
      }
    });
}

function handleError(e: unknown): void {
  if (e instanceof ApiError) {
    console.error(`Error (${e.status}): ${e.message}`);
  } else {
    console.error(String(e));
  }
  process.exit(1);
}
