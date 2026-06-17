# Installing Shipeasy in your coding agent

Shipeasy ships two things to a coding agent:

1. **Seven skills** — `SKILL.md` files (`flags`, `experiments`, `metrics`,
   `i18n`, `bugs`, `see`, `setup`) that auto-trigger on natural-language
   phrasing and walk the agent through each workflow.
2. **The `shipeasy` MCP server** — `npx -y @shipeasy/mcp@latest`, the tool
   surface that actually creates gates, drafts experiments, pushes i18n keys,
   files feedback, etc.

(Claude Code additionally gets the `/shipeasy:<area>:<verb>` **slash commands**.
No other host has a plugin slash-command primitive, so everywhere else you use
the skills + MCP instead — same flows, reached by phrasing or `@shipeasy`.)

Both artifacts live **once** in this repo under [`shipeasy/`](./shipeasy) and
are *referenced* by every host's manifest — nothing is duplicated per agent.

There are two install tiers:

- **Tier 1 (native plugin)** — Claude Code, Codex, GitHub Copilot CLI. One
  command bundles skills + MCP.
- **Tier 2 (skills CLI + MCP snippet)** — OpenCode, Cursor, Windsurf, Cline,
  Gemini CLI, Continue, and 60+ other agents supported by
  [`vercel-labs/skills`](https://github.com/vercel-labs/skills).

After installing in **any** host, run the onboarding once (Tier 1 Claude Code:
`/shipeasy:setup`; everywhere else: ask the agent to *"set up shipeasy"* — the
`setup` skill drives `shipeasy login` + key minting through the MCP).

---

## Tier 1 — native plugin (skills + MCP in one install)

All three hosts read a marketplace manifest from this repo, install the
`shipeasy` plugin from `./shipeasy`, and bundle the shared skills + an MCP
file. They use **separate manifest files** so they never collide:

| Host | Marketplace manifest | Plugin manifest | MCP file |
| --- | --- | --- | --- |
| Claude Code | `.claude-plugin/marketplace.json` | `shipeasy/.claude-plugin/plugin.json` | `shipeasy/.mcp.json` |
| Codex | `.agents/plugins/marketplace.json` | `shipeasy/.codex-plugin/plugin.json` | `shipeasy/.mcp.json` |
| Copilot CLI | `.github/plugin/marketplace.json` | `shipeasy/.plugin/plugin.json` | `shipeasy/.mcp.copilot.json` |

### Claude Code

```bash
claude plugin marketplace add shipeasy-ai/shipeasy
claude plugin install shipeasy@shipeasy
```

Gets skills + MCP + the full `/shipeasy:*` slash-command set. Then run
`/shipeasy:setup`.

### Codex

In the Codex TUI (`/plugins` opens the browser, or add the source directly):

```
/plugin marketplace add shipeasy-ai/shipeasy
/plugin install shipeasy@shipeasy
```

Gets the seven skills + MCP. Invoke explicitly with `@shipeasy`, or just
describe the task and let a skill trigger. (No slash commands — Codex plugins
have no command primitive.)

### GitHub Copilot CLI

```bash
copilot plugin marketplace add shipeasy-ai/shipeasy
copilot plugin install shipeasy@shipeasy
```

Or interactively: `/plugin marketplace add shipeasy-ai/shipeasy` then
`/plugin install shipeasy@shipeasy`.

Copilot requires `type: "local"` on stdio MCP servers, so it bundles
`shipeasy/.mcp.copilot.json` (the only per-host MCP variant) instead of the
shared `.mcp.json`. Skills are the same `shipeasy/skills/`.

---

## Tier 2 — skills via the `skills` CLI (MCP self-registers)

For every other agent: install the skills, then run onboarding — the `setup`
skill registers the MCP server for you.

```bash
npx skills add https://github.com/shipeasy-ai/shipeasy/tree/main/shipeasy -a <agent>
# then, in the agent:  "set up shipeasy in this repo"
```

The `skills` CLI copies **skill text only** — it does not register MCP servers.
But you no longer have to hand-edit MCP config: the `setup` skill detects that
the `shipeasy` MCP server is missing and registers it for the current host
(step 0b of the skill), then prompts you to reload the agent so the tools load.
Base onboarding (login, bind, keys, SDK wiring) is CLI-driven and finishes in
that same session; the MCP tools come online after the reload, ready for the
feature installs.

Step 2 below is the **manual fallback** — use it only if you'd rather register
the server yourself, or if auto-registration didn't fit your host.

### Step 1 — skills

[`vercel-labs/skills`](https://github.com/vercel-labs/skills) reads `SKILL.md`
files and writes them into the target agent's skills directory. Point it at the
**plugin subpath** (`/tree/main/shipeasy`) so it re-roots discovery at our
`skills/` folder:

```bash
npx skills add https://github.com/shipeasy-ai/shipeasy/tree/main/shipeasy -a <agent>
```

Add `-g` to install into the user-global skills dir instead of the project.
`<agent>` values: `opencode`, `cursor`, `windsurf`, `cline`, `gemini-cli`,
`continue`, `openclaw`, `github-copilot`, `claude-code`, … (`--agent '*'`
targets all 70+ supported agents).

> The `skills` CLI handles **skill text only** — it does not register MCP
> servers and has no `--with-init`/rule-file emitter (those are private to other
> projects). Do Step 2 separately.

### Step 2 — MCP server

Add the `shipeasy` server to the agent's MCP config. Most agents use the
standard `mcpServers` object:

```json
{
  "mcpServers": {
    "shipeasy": {
      "command": "npx",
      "args": ["-y", "@shipeasy/mcp@latest"]
    }
  }
}
```

Per-agent config file + any required extra fields:

| Agent | `-a` value | MCP config file (project / global) | Shape / notes |
| --- | --- | --- | --- |
| **OpenCode** | `opencode` | `opencode.json` / `~/.config/opencode/opencode.json` | `mcp` key; `type:"local"` + **command as array**, see below |
| **Cursor** | `cursor` | `.cursor/mcp.json` / `~/.cursor/mcp.json` | bare `mcpServers` object |
| **Windsurf** | `windsurf` | *(global only)* `~/.codeium/windsurf/mcp_config.json` | bare `mcpServers` object |
| **Gemini CLI** | `gemini-cli` | `.gemini/settings.json` / `~/.gemini/settings.json` | bare `mcpServers`, or `gemini mcp add shipeasy npx -y @shipeasy/mcp@latest` |
| **Cline** | `cline` | *(global)* `…/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` | bare `mcpServers`; use the in-app *Configure MCP Servers* button to open it |
| **Continue** | `continue` | `.continue/config.yaml` / `~/.continue/config.yaml` | `mcpServers` is a **YAML list**, see below |
| **OpenClaw** | `openclaw` | *(skills only)* `~/.openclaw/workspace/` | instructions/skills-based; skills install via the CLI above. MCP support is unconfirmed — if available it uses the standard `mcpServers` object |

**OpenCode** — skills also auto-discover from `.claude/skills/` and
`.agents/skills/` (so `npx skills add … -a opencode` writing to `.agents/skills/`
just works). MCP block:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "shipeasy": {
      "type": "local",
      "command": ["npx", "-y", "@shipeasy/mcp@latest"],
      "enabled": true
    }
  }
}
```

**Continue** — `mcpServers` is a list, and MCP only works in Continue's *agent*
mode:

```yaml
mcpServers:
  - name: shipeasy
    type: stdio
    command: npx
    args:
      - "-y"
      - "@shipeasy/mcp@latest"
```

**Windows / Cline `spawn npx ENOENT`** — wrap the command:
`"command": "cmd", "args": ["/c", "npx", "-y", "@shipeasy/mcp@latest"]`.

---

## After install (any host)

Plugin/skill install only *registers* the skills + MCP — it runs no shell
commands. To wire Shipeasy into your app:

1. **Authenticate + bind.** Claude Code: `/shipeasy:setup`. Any other host:
   tell the agent *"set up shipeasy in this repo"* — the `setup` skill runs
   `shipeasy login`, binds the repo to a project, mints server + client keys,
   and wires the SDK into the root layout (all via the CLI). On a Tier-2
   (skills-CLI) install it also **registers the `shipeasy` MCP server** if it's
   missing, then asks you to reload the agent so the tools load before step 2.
2. **Enable the modules you want.** `/shipeasy:flags:install` (gates + configs
   + kill switches + experiments + events), `/shipeasy:ops:install` (feedback +
   errors + alerts), `/shipeasy:i18n:install` (translations) — or, on a
   command-less host, ask for the equivalent and the install skills drive it.

---

## What ports to each host

| Capability | Claude Code | Codex | Copilot CLI | Tier-2 (OpenCode, Cursor, …) |
| --- | :---: | :---: | :---: | :---: |
| Seven skills | ✅ | ✅ | ✅ | ✅ |
| `shipeasy` MCP server | ✅ | ✅ | ✅ | ✅ |
| `/shipeasy:*` slash commands | ✅ | — | — | — |
| One-command install | ✅ | ✅ | ✅ | skills CLI; MCP self-registers on setup |

Slash commands are the only Claude-Code-exclusive surface; everything that
*does* work (creating gates, drafting experiments, pushing i18n, filing
feedback) runs through the MCP, which every host has.

---

## Notes & caveats

- **Skill format is universal.** `SKILL.md` needs only `name` + `description`
  frontmatter; the extra `user-invocable` field we ship is an unknown key that
  Claude Code, Codex, and OpenCode explicitly ignore. (Copilot's handling of
  unknown frontmatter keys is undocumented but has not been a problem in
  practice.)
- **Why a second MCP file.** Claude Code and Codex accept the bare
  `mcpServers`/`command`+`args` shape (`shipeasy/.mcp.json`). Copilot, OpenCode,
  and Continue require a transport/`type` field, so Copilot bundles
  `shipeasy/.mcp.copilot.json` and the Tier-2 snippets above add `type` inline.
  These are 8-line transport adapters, not duplicated logic.
- **Updating.** Plugin hosts: re-run `marketplace update` / re-install. Skills
  CLI: re-run `npx skills add …` (symlinks by default, so it tracks the repo;
  pass `--copy` for a frozen copy). The MCP always resolves `@latest`.
- **Deletions are UI-only** on every host — the plugin/skills ship no `:delete`
  verb for any resource.
