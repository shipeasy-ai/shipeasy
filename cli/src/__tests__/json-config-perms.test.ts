import { mkdtempSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeJsonConfig } from "../util/json-config";

const mode = (p: string) => statSync(p).mode & 0o777;

describe("writeJsonConfig permissions", () => {
  it("creates bearer-carrying configs 0600 in a 0700 dir", () => {
    const root = mkdtempSync(join(tmpdir(), "se-"));
    const p = join(root, "a", "mcp.json");
    writeJsonConfig(p, { servers: { s: { headers: { Authorization: "Bearer abc" } } } });
    expect(mode(p)).toBe(0o600);
    expect(mode(join(root, "a"))).toBe(0o700);
  });
  it("tightens an existing 0644 file when a bearer is written", () => {
    const p = join(mkdtempSync(join(tmpdir(), "se-")), "mcp.json");
    writeFileSync(p, "{}");
    chmodSync(p, 0o644);
    writeJsonConfig(p, { headers: { Authorization: "Bearer abc" } });
    expect(mode(p)).toBe(0o600);
  });
});
