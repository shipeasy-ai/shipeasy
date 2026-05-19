# Shipeasy — Claude Code marketplace

One plugin, all features. Install it once:

```bash
claude plugin marketplace add shipeasy-ai/shipeasy
claude plugin install shipeasy@shipeasy
```

Then run the base install command first, then any feature install
commands you want:

```
/shipeasy:install                  # base — SDK, auth, project bind, keys, root-layout init
/shipeasy:experiments:install      # A/B tests + metrics
/shipeasy:flags:install            # feature gates + configs + kill switches
/shipeasy:i18n:install             # translations
/shipeasy:bugs:install             # in-app bug reports
```

Each feature install command **also drops a thin pointer skill into the
project's `.claude/skills/`** (committed to the repo), so future
contributors who clone the project can discover the workflow and
re-install the plugin without already having it loaded.

## Layout

```
marketplace/
├── .claude-plugin/marketplace.json
├── README.md
└── shipeasy/
    ├── .claude-plugin/plugin.json
    ├── .mcp.json                                 # registers @shipeasy/mcp
    ├── commands/
    │   ├── install.md                            # /shipeasy:install
    │   ├── bugs/{install,bug}.md                 # /shipeasy:bugs:*
    │   ├── flags/{install,flag}.md               # /shipeasy:flags:*
    │   ├── experiments/{install,experiment}.md   # /shipeasy:experiments:*
    │   └── i18n/{install,extract,migrate}.md     # /shipeasy:i18n:*
    └── skills/
        ├── shipeasy-setup/SKILL.md
        ├── shipeasy-bugs/SKILL.md
        ├── shipeasy-flags/SKILL.md
        ├── shipeasy-experiments/SKILL.md
        └── shipeasy-i18n/SKILL.md
```

## Project-level pointer skills

Each `install.md` command writes a small skill file into the **project's**
`.claude/skills/shipeasy-<feature>/SKILL.md` after the module is enabled.
The pointer:

- Names the trigger keywords for the workflow (so a fresh Claude Code
  session in the repo picks them up automatically).
- Tells contributors how to install the plugin from scratch
  (`claude plugin marketplace add shipeasy-ai/shipeasy && claude plugin
install shipeasy@shipeasy`), or how to use the CLI fallback for
  Cursor/Windsurf (`npx @shipeasy/cli plugin install`).
- Includes the bare CLI commands so the workflow is recoverable even
  without any AI tooling.

Commit these files. They are the breadcrumb the next contributor
follows.

## Publishing to GitHub

This tree lives at `shipeasy-ai/shipeasy` on GitHub (the public
marketplace repo). See [`../PUBLISH-MIGRATION.md`](../PUBLISH-MIGRATION.md)
for the runbook.

## Relationship to `packages/cli` plugin install

`packages/cli/src/commands/plugin.ts` ships the same skills + commands
under `shipeasy plugin install` for non-Claude-Code assistants (Cursor,
Windsurf) and air-gapped environments. Both paths consume this same
`marketplace/shipeasy/` directory.

## Relationship to the in-monorepo install guides

The long-form runbooks under [`../install/`](../install/) are the
canonical source for each workflow. The skills here mirror their
intent — keep them in sync; the runbooks win on conflict.
