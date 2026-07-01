#!/usr/bin/env node
// Deterministic validator for one host's plugin wiring in this marketplace repo.
// Usage: node scripts/validate-plugin.mjs <claude|codex|copilot|all>
//
// Asserts, for the given host:
//   - its marketplace manifest + plugin manifest are well-formed JSON
//   - the marketplace entry's `source` resolves to the plugin root (./shipeasy)
//   - the plugin's skills dir contains every expected skill, each with a
//     SKILL.md whose frontmatter `name` matches its directory and has a
//     non-empty `description`
//   - the plugin's MCP file parses and registers the `shipeasy` server
//     (Copilot additionally requires `type: "local"`)
//
// No network, no auth — this is the working-tree gate that runs on every push.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = process.cwd();
// ALL skills — 9 area guides + 8 workflow skills. They are the whole cross-host
// surface (there is no separate commands/ dir); all CRUD is delegated to the
// `shipeasy` MCP server or the `shipeasy` CLI.
const EXPECTED_SKILLS = [
  "shipeasy-alerts",
  "shipeasy-common",
  "shipeasy-experiments",
  "shipeasy-flags",
  "shipeasy-flags-install",
  "shipeasy-i18n",
  "shipeasy-i18n-extract",
  "shipeasy-i18n-install",
  "shipeasy-i18n-migrate",
  "shipeasy-i18n-translate",
  "shipeasy-metrics",
  "shipeasy-ops",
  "shipeasy-ops-install",
  "shipeasy-ops-trigger",
  "shipeasy-ops-work",
  "shipeasy-see",
  "shipeasy-setup",
];

const HOSTS = {
  claude: {
    label: "Claude Code",
    marketplace: ".claude-plugin/marketplace.json",
    plugin: "shipeasy/.claude-plugin/plugin.json",
    mcpType: null, // bare mcpServers, no transport field
  },
  codex: {
    label: "Codex",
    marketplace: ".agents/plugins/marketplace.json",
    plugin: "shipeasy/.codex-plugin/plugin.json",
    mcpType: null,
  },
  copilot: {
    label: "GitHub Copilot CLI",
    marketplace: ".github/plugin/marketplace.json",
    plugin: "shipeasy/.plugin/plugin.json",
    mcpType: "local",
  },
};

let failures = 0;
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  failures++;
};
const ok = (msg) => console.log(`  ✓ ${msg}`);

function readJson(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) throw new Error(`missing file: ${rel}`);
  return JSON.parse(readFileSync(abs, "utf8"));
}

// Minimal YAML frontmatter reader (name/description only — enough to validate).
function frontmatter(skillMdPath) {
  const text = readFileSync(skillMdPath, "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

function validateHost(key) {
  const h = HOSTS[key];
  console.log(`\n[${key}] ${h.label}`);

  // 1) manifests parse
  let market, plugin;
  try {
    market = readJson(h.marketplace);
    ok(`marketplace manifest parses (${h.marketplace})`);
  } catch (e) {
    fail(`marketplace manifest: ${e.message}`);
    return;
  }
  try {
    plugin = readJson(h.plugin);
    ok(`plugin manifest parses (${h.plugin})`);
  } catch (e) {
    fail(`plugin manifest: ${e.message}`);
    return;
  }

  // 2) marketplace entry source resolves to the plugin root
  const pluginRoot = dirname(dirname(join(ROOT, h.plugin))); // .../shipeasy
  const entry = (market.plugins || []).find((p) => p.name === "shipeasy");
  if (!entry) {
    fail(`marketplace lists no plugin named "shipeasy"`);
  } else {
    // source is a plain string (Claude/Copilot) or a nested object (Codex: { source, path })
    const srcSpec = typeof entry.source === "string" ? entry.source : entry.source?.path;
    if (!srcSpec) {
      fail(`marketplace entry has no resolvable source path`);
    } else {
      const src = resolve(ROOT, srcSpec);
      if (src === pluginRoot) ok(`marketplace source "${srcSpec}" → plugin root`);
      else fail(`marketplace source "${srcSpec}" resolves to ${src}, expected ${pluginRoot}`);
    }
  }

  // 3) skills dir: from plugin.skills field, else default ./skills/
  const skillsDir = resolve(pluginRoot, plugin.skills || "skills");
  if (!existsSync(skillsDir) || !statSync(skillsDir).isDirectory()) {
    fail(`skills dir not found: ${skillsDir}`);
  } else {
    const found = readdirSync(skillsDir).filter((d) =>
      existsSync(join(skillsDir, d, "SKILL.md")),
    );
    for (const want of EXPECTED_SKILLS) {
      if (!found.includes(want)) {
        fail(`missing skill "${want}"`);
        continue;
      }
      const fm = frontmatter(join(skillsDir, want, "SKILL.md"));
      if (fm.name !== want) fail(`skill "${want}": frontmatter name "${fm.name}" ≠ dir`);
      else if (!fm.description) fail(`skill "${want}": empty description`);
    }
    const extra = found.filter((d) => !EXPECTED_SKILLS.includes(d));
    ok(`skills present: ${found.length} (${found.sort().join(", ")})${extra.length ? " [+extra]" : ""}`);
  }

  // 4) MCP file
  const mcpRel = plugin.mcpServers || ".mcp.json";
  const mcpAbs = resolve(pluginRoot, mcpRel);
  if (!existsSync(mcpAbs)) {
    fail(`MCP file not found: ${mcpAbs}`);
  } else {
    let mcp;
    try {
      mcp = JSON.parse(readFileSync(mcpAbs, "utf8"));
    } catch (e) {
      fail(`MCP file does not parse: ${e.message}`);
      return;
    }
    const servers = mcp.mcpServers || mcp.mcp_servers || mcp;
    const se = servers.shipeasy;
    if (!se) fail(`MCP file registers no "shipeasy" server`);
    else {
      ok(`MCP file registers "shipeasy" (${mcpRel})`);
      if (h.mcpType && se.type !== h.mcpType)
        fail(`MCP "shipeasy".type is "${se.type}", ${h.label} requires "${h.mcpType}"`);
      else if (h.mcpType) ok(`MCP type "${se.type}" matches ${h.label} requirement`);
    }
  }
}

const arg = (process.argv[2] || "all").toLowerCase();
const keys = arg === "all" ? Object.keys(HOSTS) : [arg];
for (const k of keys) {
  if (!HOSTS[k]) {
    console.error(`unknown host "${k}" — expected one of: ${Object.keys(HOSTS).join(", ")}, all`);
    process.exit(2);
  }
  validateHost(k);
}

console.log("");
if (failures) {
  console.error(`FAILED: ${failures} problem(s)`);
  process.exit(1);
}
console.log("OK: plugin wiring is valid");
