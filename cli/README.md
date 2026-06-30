# @shipeasy/cli

The command-line companion for [Shipeasy](https://shipeasy.ai) — feature flags,
A/B experiments, dynamic configs, kill switches, i18n, and in-app feedback +
production-error tracking.

## Quick start

One command does the whole onboarding — log in, bind a project, detect your
coding agents, register the Shipeasy MCP server + skills, and hand the in-repo
SDK wiring to your agent:

```bash
npx @shipeasy/cli setup
```

`setup` walks through:

1. **Authenticate + bind** — opens the browser to pick an existing project or
   create a new one, then writes a committed `.shipeasy` file so the CLI, MCP
   server, and CI all agree on the project.
2. **Detect coding agents** — finds the agents installed in your environment and
   lets you choose which to wire up: **Claude Code**, **Cursor**, **OpenAI
   Codex**, **GitHub Copilot**, and **Google Jules**.
3. **Wire each agent** — registers the Shipeasy MCP server (`@shipeasy/mcp`) in
   the right config for each agent and drops a universal `AGENTS.md` plus
   per-agent rules (`.cursor/rules/shipeasy.mdc`,
   `.github/copilot-instructions.md`). For Claude Code it installs the
   marketplace plugin (commands + skills + MCP).
4. **Finish the SDK wiring** — hands off to Claude (`/shipeasy:setup`) to install
   `@shipeasy/sdk`, wire your entry points, and persist keys.

### Flags

| Flag                    | Description                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `--yes`                 | Non-interactive: bind the current session's project and wire all _detected_ agents. |
| `--agents <list>`       | Comma list to wire explicitly: `claude,cursor,codex,copilot,jules`.                 |
| `--domain <domain>`     | Production domain, passed to the Claude `/shipeasy:setup` step.                     |
| `--scope user\|project` | MCP config scope (default `project`).                                               |
| `--no-claude-run`       | Don't launch Claude Code for the in-repo wiring step.                               |
| `--dry-run`             | Show what would change without writing files or launching anything.                 |

`setup` is idempotent — safe to re-run. In CI (or any non-TTY) it runs
non-interactively; provide credentials via `SHIPEASY_CLI_TOKEN` +
`SHIPEASY_PROJECT_ID`.

### Per-agent wiring

| Agent          | MCP registration                                                                  | Instructions                                    |
| -------------- | --------------------------------------------------------------------------------- | ----------------------------------------------- |
| Claude Code    | marketplace plugin (`claude plugin install shipeasy@shipeasy`) → else `.mcp.json` | plugin skills + `AGENTS.md`                     |
| Cursor         | `.cursor/mcp.json`                                                                | `.cursor/rules/shipeasy.mdc` + `AGENTS.md`      |
| OpenAI Codex   | `codex mcp add` → else `~/.codex/config.toml` snippet                             | `AGENTS.md`                                     |
| GitHub Copilot | `.vscode/mcp.json` (`servers`)                                                    | `.github/copilot-instructions.md` + `AGENTS.md` |
| Google Jules   | connect `@shipeasy/mcp` in Jules settings (cloud)                                 | `AGENTS.md`                                     |

## Other commands

Run `shipeasy --help` for the full list. Common ones:

```bash
shipeasy login            # PKCE device-flow auth (no-op if already logged in)
shipeasy whoami           # show auth state + active project
shipeasy bind [id]        # bind the current directory to a project
shipeasy mcp install      # (re)register the MCP server only
shipeasy scan             # detect language, framework, and SDK state
shipeasy flags list       # gates, configs, killswitches, experiments, metrics …
```

## Full command reference

Every command, argument, flag, and usage example is documented at:

**📖 https://docs.shipeasy.ai/get-started/cli-reference**

That page is generated directly from this CLI's command definitions (the same
source that powers `--help`), so it never drifts from the installed binary. Add
`--help` to any command for the same details in your terminal, e.g.
`shipeasy experiments create --help`.

## License

MIT

<!-- ci: republish trigger — runs the publish workflow on the fixed pnpm/action-setup config; no package content change -->
