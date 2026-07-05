import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadCredentials } from "../auth/storage";
import {
  type AgentId,
  type InstallCtx,
  type McpResult,
  MCP_URL,
  codexConfigPath,
  installClaudePlugin,
  jsonMcpTarget,
  registerMcp,
} from "../setup/agents";
import { readJsonConfig, writeJsonConfig } from "../util/json-config";
import { getBoundProjectId } from "../util/project-config";
import { withExamples } from "../util/examples";

// The registered entry is the hosted, remote MCP server (mcp.shipeasy.ai) —
// defined once in ../setup/agents so `shipeasy setup` and `shipeasy mcp install`
// register the exact same thing, through the exact same per-agent path (native
// `claude plugin install` / `codex mcp add` where one exists, JSON-config merge
// otherwise). This file must never re-derive that wiring independently.

const ALL_AGENTS: AgentId[] = ["claude", "cursor", "codex", "copilot", "jules"];

const AGENT_LABEL: Record<AgentId, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  codex: "OpenAI Codex",
  copilot: "GitHub Copilot",
  jules: "Google Jules",
};

function resolveAgents(client: string | undefined): AgentId[] {
  if (!client || client === "all") return ALL_AGENTS;
  return ALL_AGENTS.filter((a) => a === client);
}

type McpConfigFile = { mcpServers?: Record<string, unknown>; servers?: Record<string, unknown> };

/** Read + parse an assistant's MCP config file, tolerating "doesn't exist yet". */
function readMcpConfig(path: string): McpConfigFile | null {
  try {
    return readJsonConfig<McpConfigFile>(path);
  } catch {
    return null;
  }
}

function formatMcp(agent: AgentId, r: McpResult): string {
  const label = AGENT_LABEL[agent];
  switch (r.action) {
    case "wrote":
      return `✓ ${label}: wrote ${r.detail}`;
    case "updated":
      return `✓ ${label}: updated ${r.detail}`;
    case "shell":
      return `✓ ${label}: ${r.detail}`;
    case "skipped":
      return `• ${label}: ${r.detail}`;
    case "manual":
      return `• ${label} (manual): ${r.detail}`;
    case "error":
      return `✗ ${label}: ${r.detail}`;
  }
}

export function mcpCommand(parent: Command): void {
  const mcp = parent
    .command("mcp")
    .description("Manage the Shipeasy MCP server in AI-assistant configs");

  const installMcp = mcp
    .command("install")
    .description(`Register the hosted Shipeasy MCP server (${MCP_URL}) with installed AI assistants`)
    .option("--client <name>", "Restrict to one agent (claude | cursor | codex | copilot | jules | all)", "all")
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
        const agents = resolveAgents(opts.client);
        if (opts.client && opts.client !== "all" && agents.length === 0) {
          console.error(
            `Unknown --client=${opts.client}. Choose from: claude, cursor, codex, copilot, jules, all`,
          );
          process.exit(1);
        }

        // Pin the connection to the folder's bound project (or the logged-in
        // project) via an X-Project-Id header in the written config, so tools act
        // on the right project without re-authorizing. Falls back to no header
        // (project chosen at OAuth consent) when neither is known.
        const projectId = getBoundProjectId(process.cwd()) ?? loadCredentials()?.project_id;
        const ctx: InstallCtx = {
          cwd: process.cwd(),
          scope,
          force: !!opts.force,
          dryRun: !!opts.dryRun,
          projectId,
        };

        let wrote = 0;
        let skipped = 0;
        for (const agent of agents) {
          if (agent === "claude") {
            const r = installClaudePlugin(ctx);
            const icon = r.action === "error" ? "✗" : r.action === "manual" ? "•" : "✓";
            for (const line of r.lines) console.log(`${icon} ${line}`);
            if (r.action === "installed") wrote++;
            else skipped++;
            continue;
          }
          const r = registerMcp(agent, ctx);
          console.log(formatMcp(agent, r));
          if (r.action === "wrote" || r.action === "updated" || r.action === "shell") wrote++;
          else skipped++;
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

  withExamples(installMcp, [
    { run: "shipeasy mcp install" },
    { run: "shipeasy mcp install --client claude --scope project", note: "only Claude, project config" },
    { run: "shipeasy mcp install --client codex", note: "shells out to `codex mcp add`" },
    { run: "shipeasy mcp install --force --dry-run", note: "preview a forced replace" },
  ]);

  const statusMcp = mcp
    .command("status")
    .description("Show which AI-assistant configs have a Shipeasy MCP entry")
    .action(() => {
      console.log(`Scope:`);
      console.log(`  user    = $HOME (${homedir()})`);
      console.log(`  project = cwd  (${process.cwd()})\n`);

      const cwd = process.cwd();
      for (const scope of ["user", "project"] as const) {
        const ctx: InstallCtx = { cwd, scope, force: false, dryRun: false };
        for (const agent of ALL_AGENTS) {
          // Codex and Jules aren't scoped per-project — report them once, on the user pass.
          if ((agent === "codex" || agent === "jules") && scope === "project") continue;
          const row = describeAgentStatus(agent, ctx);
          if (row) console.log(`  ${row.present.padEnd(4)}  ${row.label.padEnd(30)}  ${row.detail}`);
        }
      }

      const creds = loadCredentials();
      console.log(
        `\nAuth: ${creds ? `OK (project ${creds.project_id})` : "not logged in — run `shipeasy login`"}`,
      );
    });

  withExamples(statusMcp, [{ run: "shipeasy mcp status" }]);

  // No `mcp start`: the server is hosted at mcp.shipeasy.ai and reached over
  // HTTP, so there is no local stdio process for an assistant to launch.

  // Convenience: `shipeasy mcp uninstall` removes the entry.
  const uninstallMcp = mcp
    .command("uninstall")
    .description("Remove the 'shipeasy' MCP entry from AI-assistant configs")
    .option("--client <name>", "Restrict to one agent", "all")
    .option("--scope <scope>", "user | project | both", "both")
    .action((opts: { client?: string; scope?: "user" | "project" | "both" }) => {
      const scopes: ("user" | "project")[] =
        opts.scope === "user" ? ["user"] : opts.scope === "project" ? ["project"] : ["user", "project"];
      const agents = resolveAgents(opts.client);

      let removed = 0;
      for (const scope of scopes) {
        const ctx: InstallCtx = { cwd: process.cwd(), scope, force: false, dryRun: false };
        for (const agent of agents) {
          if (agent === "codex" || agent === "jules") continue; // no safe JSON path to edit
          const target = jsonMcpTarget(agent, ctx);
          if (!target) continue;
          const cfg = readMcpConfig(target.path);
          const servers = cfg?.[target.key];
          if (!cfg || !servers || !("shipeasy" in servers)) continue;
          delete servers.shipeasy;
          writeJsonConfig(target.path, cfg);
          console.log(`✓ removed shipeasy entry from ${target.path} (${AGENT_LABEL[agent]}, ${scope})`);
          removed++;
        }
      }

      if (agents.includes("claude")) {
        console.log(
          "• Claude Code plugin: run `claude plugin uninstall shipeasy@shipeasy` to remove the native plugin install.",
        );
      }
      if (agents.includes("codex")) {
        console.log(`• OpenAI Codex: run \`codex mcp remove shipeasy\` (or edit ${codexConfigPath()}).`);
      }

      console.log(`\nDone. ${removed} removed.`);
    });

  withExamples(uninstallMcp, [
    { run: "shipeasy mcp uninstall" },
    { run: "shipeasy mcp uninstall --client cursor --scope user" },
  ]);
}

interface StatusRow {
  label: string;
  present: string;
  detail: string;
}

/** Best-effort "is shipeasy registered" check per agent, matching how `registerMcp` writes it. */
function describeAgentStatus(agent: AgentId, ctx: InstallCtx): StatusRow | null {
  const scoped = agent !== "codex" && agent !== "jules";
  const label = scoped ? `${AGENT_LABEL[agent]} (${ctx.scope})` : AGENT_LABEL[agent];

  if (agent === "claude" && ctx.scope === "user") {
    const settings = readJsonConfig<{ enabledPlugins?: Record<string, boolean> }>(
      join(homedir(), ".claude", "settings.json"),
    );
    const pluginInstalled = !!settings?.enabledPlugins?.["shipeasy@shipeasy"];
    if (pluginInstalled) return { label, present: "yes", detail: "plugin installed (marketplace)" };
    // fall through to the JSON-config check below for the non-plugin fallback path
  }

  if (agent === "codex") {
    const path = codexConfigPath();
    if (!existsSync(path)) return { label, present: "—", detail: `${path} (not found)` };
    const present = readFileSync(path, "utf8").includes("[mcp_servers.shipeasy]");
    return { label, present: present ? "yes" : "no", detail: path };
  }

  if (agent === "jules") {
    return { label, present: "—", detail: "connected from Jules Settings (cloud, no local file)" };
  }

  const target = jsonMcpTarget(agent, ctx);
  if (!target) return null;
  const cfg = readMcpConfig(target.path);
  const servers = cfg?.[target.key];
  const present = servers && "shipeasy" in servers ? "yes" : cfg ? "no" : "—";
  return { label, present, detail: target.path };
}
