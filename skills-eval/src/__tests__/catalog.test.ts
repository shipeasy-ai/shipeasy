import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KNOWN_TOOLS } from "../catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Sibling package's generated tool source is the source of truth for the
// snapshot in catalog.ts. Read it directly (no build/dep needed).
const GEN = resolve(__dirname, "../../../mcp/src/generated/tools.gen.ts");

/**
 * Drift guard: every KNOWN_TOOLS entry must still exist as a real generated
 * tool. Catches the exact class of bug we just hit — a tool renamed under the
 * feet of the snapshot (events_* → metrics_events_*, release_flags_rollout gone).
 * On drift, the failure lists the stale names to remove/rename in catalog.ts.
 */
describe("KNOWN_TOOLS snapshot ⊆ live MCP tool catalogue", () => {
  it("has no stale tool names", () => {
    let src: string;
    try {
      src = readFileSync(GEN, "utf8");
    } catch {
      // MCP source not present (shallow checkout) — nothing to verify against.
      console.warn(`skip: ${GEN} not found`);
      return;
    }
    const live = new Set(
      [...src.matchAll(/name:\s*"([a-z][a-z0-9_-]+)"/g)].map((m) => m[1]!),
    );
    const stale = KNOWN_TOOLS.filter((t) => !live.has(t));
    expect(stale, `stale tool names in catalog.ts — remove or rename: ${stale.join(", ")}`).toEqual([]);
  });
});
