# Shipeasy — Claude Code marketplace

This directory is the source-of-truth for the Shipeasy plugin marketplace
that Claude Code consumers install via:

```bash
claude plugin marketplace add shipeasy-ai/shipeasy
claude plugin install base@shipeasy
# pick any combination of features:
claude plugin install experiments-metrics@shipeasy
claude plugin install configs-gates@shipeasy
claude plugin install polylang@shipeasy
claude plugin install bugs@shipeasy
```

`base` is required first. The four feature plugins are independent and
can be installed in any combination, in any order.

## Layout

```
marketplace/
├── .claude-plugin/marketplace.json     # lists all 5 plugins
├── README.md                            # this file
├── base/                                # @base — required
├── experiments-metrics/                 # @experiments-metrics
├── configs-gates/                       # @configs-gates
├── polylang/                            # @polylang (i18n / translations)
└── bugs/                                # @bugs (bug reports + feature requests)
```

Each plugin directory contains:

```
<plugin>/
├── .claude-plugin/plugin.json           # plugin manifest
├── .mcp.json                            # (base only) MCP server registration
├── skills/<skill-name>/SKILL.md         # agent skill(s)
└── commands/<command-name>.md           # slash command(s)
```

## After install

Plugin install registers slash commands + skills with Claude Code. It does
**not** run shell commands. To complete the setup:

1. After `base@shipeasy`: run `/shipeasy-setup` in Claude Code (or follow
   the `shipeasy-setup` skill). This installs the SDK, authenticates,
   binds the repo to a project, mints keys, and wires the SDK into the
   root layout.
2. After each feature plugin: run the matching setup slash command
   (`/shipeasy-experiments-setup`, `/shipeasy-flags-setup`,
   `/shipeasy-polylang-setup`, `/shipeasy-bugs-setup`). Each one enables
   the corresponding per-project module and verifies the wiring.

## Publishing to GitHub

This tree is intended to live at `shipeasy-ai/shipeasy` on GitHub (the
public marketplace repo). See [`../PUBLISH-MIGRATION.md`](../PUBLISH-MIGRATION.md)
for the runbook that creates the repo, subtree-splits this directory
into it, and configures the `claude plugin marketplace add` URL.

## Relationship to the in-monorepo install guides

The agent-facing runbooks under [`../install/`](../install/) (general,
experiments-metrics, configs-gates-killswitches, translations,
bugs-feature-requests) are the long-form documentation each skill
references. The skills in this directory deliberately mirror the steps
those runbooks describe — keep them in sync. The runbooks are the canonical
source if there's ever a conflict.

## Relationship to `packages/cli/plugin/`

`packages/cli/plugin/` is the **legacy** single-plugin layout that the CLI's
`shipeasy plugin install` command writes into `.claude/`. It remains for
non-Claude-Code assistants (Cursor, Windsurf) and for users who can't reach
the public marketplace. Treat both directories as fungible until the CLI
is updated to consume `marketplace/` directly — then `packages/cli/plugin/`
can be deleted.
