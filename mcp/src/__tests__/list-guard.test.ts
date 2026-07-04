import { describe, it, expect } from "vitest";
import { REGISTRY_TOOLS } from "../tools/registry.js";
import {
  LIST_TOKEN_PARAM,
  bucketAt,
  guardedCreateFamily,
  listFamily,
  listMintsToken,
  mintListToken,
  verifyToken,
  withListTokenParam,
} from "../tools/list-guard.js";

const NOW = 1_800_000_000_000; // fixed epoch-ms; guard is time-bucketed
const WINDOW_MS = 10 * 60 * 1000;

describe("list-guard family detection", () => {
  it("guards creates that have a `*_list` sibling", () => {
    expect(guardedCreateFamily("release_flags_create")).toBe("release_flags");
    expect(guardedCreateFamily("metrics_create")).toBe("metrics");
    expect(guardedCreateFamily("metrics_events_create")).toBe("metrics_events");
    expect(guardedCreateFamily("release_experiments_universes_create")).toBe(
      "release_experiments_universes",
    );
    expect(guardedCreateFamily("ops_alerts_create")).toBe("ops_alerts");
  });

  it("exempts creates with no list sibling and non-`_create` tools", () => {
    // ends in `_claude`, not `_create` → not a create at all
    expect(guardedCreateFamily("ops_trigger_create_claude")).toBeNull();
    // insert-only push, not a create verb
    expect(guardedCreateFamily("i18n_keys_push")).toBeNull();
    // set/update on an existing killswitch, not a create
    expect(guardedCreateFamily("release_killswitch_set")).toBeNull();
    // reads are never guarded
    expect(guardedCreateFamily("release_flags_list")).toBeNull();
    expect(guardedCreateFamily("release_flags_get")).toBeNull();
  });

  it("maps list tools to the family they mint for", () => {
    expect(listFamily("release_flags_list")).toBe("release_flags");
    expect(listFamily("release_flags_create")).toBeNull();
    expect(listMintsToken("release_flags_list")).toBe(true);
    // errors_list has no `errors_create`, so it mints nothing
    expect(listMintsToken("errors_list")).toBe(false);
  });
});

describe("token mint / verify", () => {
  it("accepts a freshly minted token for its family", () => {
    const tok = mintListToken("release_flags", NOW);
    expect(verifyToken("release_flags", tok, NOW)).toBe("ok");
  });

  it("accepts a token minted in the previous window (slop)", () => {
    const tok = mintListToken("metrics", NOW);
    expect(verifyToken("metrics", tok, NOW + WINDOW_MS)).toBe("ok");
  });

  it("rejects a token once two windows have passed (stale → forces re-list)", () => {
    const tok = mintListToken("metrics", NOW);
    expect(verifyToken("metrics", tok, NOW + 2 * WINDOW_MS)).toBe("invalid");
  });

  it("rejects a token minted for a different family", () => {
    const tok = mintListToken("release_flags", NOW);
    expect(verifyToken("metrics", tok, NOW)).toBe("invalid");
  });

  it("reports a missing / non-string token distinctly", () => {
    expect(verifyToken("metrics", undefined, NOW)).toBe("missing");
    expect(verifyToken("metrics", "", NOW)).toBe("missing");
    expect(verifyToken("metrics", 42, NOW)).toBe("missing");
    expect(verifyToken("metrics", "totally-made-up", NOW)).toBe("invalid");
  });

  it("buckets time at the window boundary", () => {
    expect(bucketAt(NOW) + 1).toBe(bucketAt(NOW + WINDOW_MS));
  });
});

describe("schema advertisement", () => {
  const byName = (name: string) => REGISTRY_TOOLS.find((t) => t.name === name)!;

  it("adds an optional `listToken` input to guarded create tools", () => {
    const create = byName("release_flags_create");
    const props = (create.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props[LIST_TOKEN_PARAM]).toBeDefined();
    // optional — the server owns the friendly refusal, so it is NOT in `required`
    const required = (create.inputSchema as { required?: string[] }).required ?? [];
    expect(required).not.toContain(LIST_TOKEN_PARAM);
  });

  it("leaves non-guarded tools' schemas untouched", () => {
    const list = byName("release_flags_list");
    const props = (list.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(props[LIST_TOKEN_PARAM]).toBeUndefined();
  });

  it("does not mutate the input tools", () => {
    const src = [
      { name: "release_flags_create", description: "", inputSchema: { type: "object", properties: {} } },
    ];
    const out = withListTokenParam(src as never);
    expect((src[0].inputSchema as { properties: Record<string, unknown> }).properties).toEqual({});
    expect(
      (out[0].inputSchema as { properties: Record<string, unknown> }).properties[LIST_TOKEN_PARAM],
    ).toBeDefined();
  });
});
