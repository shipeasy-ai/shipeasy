/**
 * Generate server.json for the official MCP Registry from package.json.
 *
 * package.json is the single manifest — `mcpName` is the registry server name,
 * and the npm name/version/description/repository feed the rest. Regenerating
 * here means the registry metadata can never drift from what actually ships to
 * npm (a version mismatch is the most common publish rejection).
 *
 *   pnpm --filter @shipeasy/mcp registry:gen
 *
 * Output: packages/mcp/server.json  (committed; consumed by `mcp-publisher publish`)
 *
 * Publish flow (see README § "Publish to the MCP Registry"):
 *   1. ship a new npm version that carries `mcpName` (registry verifies it)
 *   2. mcp-publisher login dns --domain shipeasy.ai ...
 *   3. pnpm --filter @shipeasy/mcp registry:gen && mcp-publisher publish
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "../package.json");
const OUT = join(HERE, "../server.json");

// Pin the schema the `mcp-publisher` CLI validates against. Bump deliberately
// when the registry cuts a new dated schema.
const SCHEMA = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";

// Where the registry listing points back to us, tagged so we can attribute
// the traffic the MCP directories (Smithery, Glama, mcp.so, …) send our way.
const WEBSITE_URL =
  "https://docs.shipeasy.ai/get-started/mcp?utm_source=mcp-registry&utm_medium=referral&utm_campaign=mcp-server-listing";

const pkg = JSON.parse(readFileSync(PKG, "utf8")) as {
  name: string;
  version: string;
  description: string;
  mcpName?: string;
  repository?: { url?: string };
};

if (!pkg.mcpName) {
  throw new Error("package.json is missing `mcpName` — the MCP Registry server name (e.g. ai.shipeasy/mcp).");
}
// The registry caps description at 100 chars; npm and the directories both
// surface it, so keep it punchy and within budget.
if (pkg.description.length > 100) {
  throw new Error(`description is ${pkg.description.length} chars; the registry limit is 100.`);
}

// git+https://github.com/shipeasy-ai/mcp.git → https://github.com/shipeasy-ai/mcp
const repoUrl = (pkg.repository?.url ?? "")
  .replace(/^git\+/, "")
  .replace(/\.git$/, "");

const server = {
  $schema: SCHEMA,
  name: pkg.mcpName,
  description: pkg.description,
  ...(repoUrl ? { repository: { url: repoUrl, source: "github" } } : {}),
  websiteUrl: WEBSITE_URL,
  version: pkg.version,
  packages: [
    {
      registryType: "npm",
      registryBaseUrl: "https://registry.npmjs.org",
      identifier: pkg.name,
      version: pkg.version,
      runtimeHint: "npx",
      transport: { type: "stdio" },
    },
  ],
};

writeFileSync(OUT, `${JSON.stringify(server, null, 2)}\n`);
console.log(`Wrote ${OUT}\n  ${server.name} @ ${server.version} → npm ${pkg.name}`);
