import { Command } from "commander";
import { getApiClient, ApiError } from "../api/client";
import { printTable, printJson } from "../util/output";

interface Bug {
  id: string;
  title: string;
  status: string;
  pageUrl: string | null;
  createdAt: string;
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
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        const client = getApiClient(opts.project);
        const items = await client.request<Bug[]>("GET", "/api/admin/bugs");
        if (opts.json) return printJson(items);
        if (!items.length) return void console.log("No bugs found.");
        printTable(
          ["ID", "Title", "Status", "Created"],
          items.map((b) => [b.id.slice(0, 8), b.title, b.status, b.createdAt]),
        );
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
