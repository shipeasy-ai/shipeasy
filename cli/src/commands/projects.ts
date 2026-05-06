import { Command } from "commander";
import { getApiClient, ApiError } from "../api/client";
import { bindProject } from "../util/project-config";

interface UpsertResult {
  id: string;
  name: string;
  domain: string | null;
  owner_email: string;
  created: boolean;
}

export function projectsCommand(parent: Command): void {
  const projects = parent
    .command("projects")
    .description("Manage Shipeasy projects scoped to your account");

  projects
    .command("upsert")
    .description(
      "Find-or-create a project by domain (idempotent). Without --no-bind, " +
        "writes the result to .shipeasy in the current directory.",
    )
    .requiredOption(
      "--domain <domain>",
      "Hostname-like identifier for the project (e.g. shouks.app, acme.com)",
    )
    .option("--name <name>", "Human-readable project name (defaults to the domain on first create)")
    .option("--no-bind", "Don't write .shipeasy after upsert")
    .option("--json", "Output as JSON")
    .action(async (opts: { domain: string; name?: string; bind: boolean; json?: boolean }) => {
      try {
        // Read-only against the project the CLI session is scoped to —
        // upsert mints a *new* project under the same owner_email and is
        // therefore not gated on `.shipeasy` (you usually run it precisely
        // because no binding exists yet).
        const client = getApiClient();
        const result = await client.request<UpsertResult>("POST", "/api/admin/projects/upsert", {
          domain: opts.domain,
          ...(opts.name ? { name: opts.name } : {}),
        });

        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        } else {
          const action = result.created ? "Created" : "Found existing";
          console.log(`${action} project: ${result.name} (id ${result.id})`);
          console.log(`  domain:      ${result.domain}`);
          console.log(`  owner:       ${result.owner_email}`);
        }

        if (opts.bind) {
          const { path, created } = bindProject(process.cwd(), result.id, result.name);
          console.log(`${created ? "Wrote" : "Updated"} ${path} → project ${result.id}`);
          console.log(
            "Commit .shipeasy alongside your code so teammates and CI agree on the project.",
          );
        }
      } catch (e) {
        if (e instanceof ApiError) {
          console.error(`API error (${e.status}): ${e.message}`);
        } else {
          console.error(String(e));
        }
        process.exit(1);
      }
    });
}
