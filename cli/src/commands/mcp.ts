import { Command } from "commander";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadCredentials } from "../auth/storage";
import { mergeMcpServer, readJsonConfig, writeJsonConfig } from "../util/json-config";

type ClientName = "claude" | "claude-project" | "cursor" | "cursor-project" | "windsurf";

interface ClientTarget {
  name: ClientName;
  label: string;
  path: string;
}

const SERVER_SPEC = {
  command: "npx",
  args: ["-y", "@shipeasy/mcp@latest"],
};

function targetsForScope(scope: "user" | "project", cwd: string): ClientTarget[] {
  if (scope === "user") {
    return [
      {
        name: "claude",
        label: "Claude Code (user)",
        path: join(homedir(), ".claude", "settings.json"),
      },
      { name: "cursor", label: "Cursor (user)", path: join(homedir(), ".cursor", "mcp.json") },
    ];
  }
  return [
    { name: "claude-project", label: "Claude Code (project)", path: join(cwd, ".mcp.json") },
    { name: "cursor-project", label: "Cursor (project)", path: join(cwd, ".cursor", "mcp.json") },
    { name: "windsurf", label: "Windsurf (project)", path: join(cwd, ".windsurf", "mcp.json") },
  ];
}

function filterByClient(targets: ClientTarget[], client: string | undefined): ClientTarget[] {
  if (!client || client === "all") return targets;
  return targets.filter((t) => t.name === client || t.name.startsWith(client + "-"));
}

export function mcpCommand(parent: Command): void {
  const mcp = parent
    .command("mcp")
    .description("Manage the Shipeasy MCP server in AI-assistant configs");

  mcp
    .command("install")
    .description("Register the Shipeasy MCP server with installed AI assistants")
    .option("--client <name>", "Restrict to one client (claude | cursor | windsurf | all)", "all")
    .option("--scope <scope>", "user | project", "user")
    .option("--force", "Replace an existing 'shipeasy' MCP entry without prompting")
    .option("--dry-run", "Print what would change without writing files")
    .action(
      (opts: {
        client?: string;
        scope?: "user" | "project";
        force?: boolean;
        dryRun?: boolean;
      }) => {
        const scope = opts.scope === "project" ? "project" : "user";
        const targets = filterByClient(targetsForScope(scope, process.cwd()), opts.client);
        if (targets.length === 0) {
          console.error(
            `No matching client targets for --client=${opts.client ?? "all"} --scope=${scope}`,
          );
          process.exit(1);
        }

        let wrote = 0;
        let skipped = 0;
        for (const t of targets) {
          const existing = readJsonConfig(t.path);
          if (existing === null && scope === "user") {
            // For user-scope, only write to clients whose config dir exists.
            const dir = t.path.replace(/\/[^/]+$/, "");
            if (!existsSync(dir)) {
              console.log(
                `• ${t.label}: skipped (${dir} does not exist — assistant not installed?)`,
              );
              skipped++;
              continue;
            }
          }
          const { config, replaced } = mergeMcpServer(
            existing,
            "shipeasy",
            SERVER_SPEC,
            !!opts.force,
          );
          if (replaced && !opts.force) {
            console.log(
              `• ${t.label}: ${t.path} already has a 'shipeasy' entry — pass --force to replace.`,
            );
            skipped++;
            continue;
          }
          if (opts.dryRun) {
            console.log(`• ${t.label}: would write ${t.path}`);
            wrote++;
            continue;
          }
          writeJsonConfig(t.path, config);
          console.log(`✓ ${t.label}: ${replaced ? "updated" : "added"} ${t.path}`);
          wrote++;
        }

        console.log(`\nDone. ${wrote} written, ${skipped} skipped.`);
        const creds = loadCredentials();
        if (!creds) {
          console.log("\nNext: run `shipeasy login` so the MCP server has credentials.");
        } else {
          console.log("\nAuth: OK — restart your AI assistant to pick up the new MCP server.");
        }
      },
    );

  mcp
    .command("status")
    .description("Show which AI-assistant configs have a Shipeasy MCP entry")
    .action(() => {
      const targets = [
        ...targetsForScope("user", process.cwd()),
        ...targetsForScope("project", process.cwd()),
      ];
      const rows: { label: string; path: string; present: string }[] = [];
      for (const t of targets) {
        const cfg = (() => {
          try {
            return readJsonConfig<{ mcpServers?: Record<string, unknown> }>(t.path);
          } catch {
            return null;
          }
        })();
        const present =
          cfg && cfg.mcpServers && "shipeasy" in cfg.mcpServers ? "yes" : cfg ? "no" : "—";
        rows.push({ label: t.label, path: t.path, present });
      }
      for (const r of rows)
        console.log(`  ${r.present.padEnd(4)}  ${r.label.padEnd(28)}  ${r.path}`);
      const creds = loadCredentials();
      console.log(
        `\nAuth: ${creds ? `OK (project ${creds.project_id})` : "not logged in — run `shipeasy login`"}`,
      );
    });

  mcp
    .command("start")
    .description("Run the Shipeasy MCP stdio server (forwards to @shipeasy/mcp)")
    .allowUnknownOption()
    .action(() => {
      const args = process.argv.slice(process.argv.indexOf("start") + 1);
      const child = spawn("npx", ["-y", "@shipeasy/mcp@latest", ...args], {
        stdio: "inherit",
      });
      child.on("exit", (code) => process.exit(code ?? 0));
      child.on("error", (err) => {
        console.error(`Failed to launch @shipeasy/mcp: ${String(err)}`);
        process.exit(1);
      });
    });

  // Convenience: `shipeasy mcp uninstall` removes the entry.
  mcp
    .command("uninstall")
    .description("Remove the 'shipeasy' MCP entry from AI-assistant configs")
    .option("--client <name>", "Restrict to one client", "all")
    .option("--scope <scope>", "user | project | both", "both")
    .action((opts: { client?: string; scope?: "user" | "project" | "both" }) => {
      const scopes: ("user" | "project")[] =
        opts.scope === "user"
          ? ["user"]
          : opts.scope === "project"
            ? ["project"]
            : ["user", "project"];
      const targets = scopes.flatMap((s) =>
        filterByClient(targetsForScope(s, process.cwd()), opts.client),
      );
      let removed = 0;
      for (const t of targets) {
        const cfg = (() => {
          try {
            return readJsonConfig<{ mcpServers?: Record<string, unknown> }>(t.path);
          } catch {
            return null;
          }
        })();
        if (!cfg || !cfg.mcpServers || !("shipeasy" in cfg.mcpServers)) continue;
        delete cfg.mcpServers.shipeasy;
        writeJsonConfig(t.path, cfg);
        console.log(`✓ removed shipeasy entry from ${resolve(t.path)}`);
        removed++;
      }
      console.log(`\nDone. ${removed} removed.`);
    });
}
