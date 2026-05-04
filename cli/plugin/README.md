# Shipeasy Claude Code plugin

Installed via `shipeasy plugin install` (recommended) or by copying this
directory to `.claude/plugins/shipeasy/` (project) or
`~/.claude/plugins/shipeasy/` (user).

## Contents

- `.claude-plugin/plugin.json` — plugin manifest.
- `.mcp.json` — registers the `@shipeasy/mcp` MCP server with Claude Code.
- `commands/` — slash commands (`/shipeasy-setup`, `/shipeasy-i18n-extract`,
  `/shipeasy-i18n-migrate`, `/shipeasy-flag`, `/shipeasy-experiment`).
- `skills/` — agent skills (`shipeasy-setup`, `shipeasy-i18n`,
  `shipeasy-flags`, `shipeasy-experiments`) Claude loads on demand.

The codemods themselves (`packages/cli/codemods/`) ship with the
`@shipeasy/cli` npm package; the plugin's slash commands shell out to
`shipeasy codemod …` rather than duplicating the AST runner.

## After installation

Restart Claude Code (or reload its plugin/skill index). The new slash
commands appear in `/`-completion. Skills load automatically when their
trigger phrases appear in user messages.

## Removing

```bash
rm -rf .claude/plugins/shipeasy            # project scope
rm -rf ~/.claude/plugins/shipeasy           # user scope
shipeasy mcp uninstall                       # also drop the MCP entry
```
