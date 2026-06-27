import type { Command } from "commander";
import { projectOperations, opId, type Operation, type OpInput } from "@shipeasy/openapi";
import { getAdminClient } from "../api/client";
import { bindProject } from "../util/project-config";
import { withExamples } from "../util/examples";
import { handleError, mountResource } from "./_registry";

/**
 * The `projects` module. `current` is the registry-driven, auth-resolved
 * "which project am I on" op (also powers `whoami`). `upsert` is kept a thin
 * consumer command because it layers a `.shipeasy` BIND (an fs side-effect) on
 * top of the shared `client.projects.upsert` call — the bind never enters the
 * worker-safe registry op (doc 21 §A4.2).
 */

function printResult(op: Operation, data: unknown): void {
  if (opId(op) === "projects.current") {
    const p = data as { name: string; id: string; domain: string | null; ownerEmail: string; plan: string; status: string };
    console.log(`Project: ${p.name} (${p.id})`);
    console.log(`  domain: ${p.domain ?? "—"}`);
    console.log(`  owner:  ${p.ownerEmail}`);
    console.log(`  plan:   ${p.plan}`);
    console.log(`  status: ${p.status}`);
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

export function projectsCommand(parent: Command): Command {
  const projects = parent
    .command("projects")
    .description("Manage Shipeasy projects scoped to your account");

  // `projects current` — registry op (read-only, auth-resolved).
  mountResource(projects, projectOperations.filter((o) => o.name === "current"), printResult);

  // `projects upsert` — shared upsert call + the consumer-side `.shipeasy` bind.
  const upsert = projects
    .command("upsert")
    .description(
      "Find-or-create a project by domain (idempotent). Without --no-bind, writes the result to .shipeasy.",
    )
    .requiredOption("--domain <domain>", "Hostname-like project identifier (e.g. acme.com)")
    .option("--name <name>", "Human-readable project name")
    .option("--no-bind", "Don't write .shipeasy after upsert")
    .option("--json", "Output as JSON")
    .action(async (opts: { domain: string; name?: string; bind: boolean; json?: boolean }) => {
      try {
        // upsert mints a new project under the session owner — not the bound
        // project — so it does not require a binding.
        const client = getAdminClient();
        const result = await client.projects.upsert({ domain: opts.domain, name: opts.name });
        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        } else {
          console.log(`${result.created ? "Created" : "Found existing"} project: ${result.name} (id ${result.id})`);
          console.log(`  domain: ${result.domain}`);
          console.log(`  owner:  ${result.owner_email}`);
        }
        if (opts.bind) {
          const { path, created } = bindProject(process.cwd(), result.id, result.name);
          console.log(`${created ? "Wrote" : "Updated"} ${path} → project ${result.id}`);
          console.log("Commit .shipeasy alongside your code so teammates and CI agree on the project.");
        }
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(upsert, [
    { note: "Find-or-create and bind to .shipeasy", run: "shipeasy projects upsert --domain acme.com" },
    { note: "Name it explicitly, don't write .shipeasy", run: 'shipeasy projects upsert --domain shouks.app --name "Shouks" --no-bind' },
  ]);

  return projects;
}
