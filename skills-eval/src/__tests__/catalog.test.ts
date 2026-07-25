import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { KNOWN_TOOLS } from "../catalog.js";

const require = createRequire(import.meta.url);

/** The live MCP surface, or null when `@shipeasy/mcp` hasn't been built yet. */
async function liveToolNames(): Promise<string[] | null> {
  let entry: string;
  try {
    entry = require.resolve("@shipeasy/mcp/tools-manifest");
  } catch {
    return null; // dist not built (fast local run) — nothing to verify against
  }
  const { ALL_TOOLS } = (await import(entry)) as { ALL_TOOLS: { name: string }[] };
  return [...new Set(ALL_TOOLS.map((t) => t.name))].sort();
}

/**
 * Drift guard on the GENERATED catalogue (`src/generated/tools.ts`). Equality in
 * BOTH directions, because either half is a real bug: a stale name means a tool
 * was renamed or hidden under our feet, and a MISSING name means the eval
 * silently drops a legitimate tool reference while scraping a skill — which is
 * how the snapshot quietly fell 26 tools behind the surface.
 *
 * On failure: `pnpm --filter @shipeasy/skills-eval gen:catalog`.
 */
describe("KNOWN_TOOLS === live MCP tool catalogue", () => {
  it("matches the manifest exactly", async () => {
    const live = await liveToolNames();
    if (!live) {
      console.warn("skip: @shipeasy/mcp not built — cannot verify the tool catalogue");
      return;
    }
    const known = new Set(KNOWN_TOOLS);
    const stale = KNOWN_TOOLS.filter((t) => !live.includes(t));
    const missing = live.filter((t) => !known.has(t));
    expect(
      { stale, missing },
      "src/generated/tools.ts is out of date — run `pnpm --filter @shipeasy/skills-eval gen:catalog`",
    ).toEqual({ stale: [], missing: [] });
  });

  it("is sorted and deduplicated, as the generator emits it", () => {
    expect([...KNOWN_TOOLS]).toEqual([...new Set(KNOWN_TOOLS)].sort());
  });
});
