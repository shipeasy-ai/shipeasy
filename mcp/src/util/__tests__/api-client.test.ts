import { describe, it, expect } from "vitest";
import { ok } from "../api-client.js";

const text = (r: ReturnType<typeof ok>) => r.content[0].text;

describe("ok() success envelope", () => {
  it("returns an explicit, non-empty success line for a void mutation", () => {
    // `undefined` must never reach `text` as a non-string (JSON.stringify(undefined)
    // is the JS value `undefined`) — a weak model reads that as a failure and retries.
    expect(typeof text(ok(undefined))).toBe("string");
    expect(text(ok(undefined))).toContain("Success");
    expect(typeof text(ok(null))).toBe("string");
    expect(text(ok(null))).toContain("Success");
  });

  it("labels an empty list as a 0-match success, not an error", () => {
    const t = text(ok([]));
    expect(t).toContain("Success");
    expect(t).toContain("0");
  });

  it("labels an empty object as a success", () => {
    expect(text(ok({}))).toContain("Success");
  });

  it("returns non-empty results as unchanged pure JSON", () => {
    const payload = [{ id: "a", name: "flag" }];
    const t = text(ok(payload));
    expect(JSON.parse(t)).toEqual(payload);
    expect(t).toBe(JSON.stringify(payload, null, 2));

    const obj = { id: "gate-1", number: 7 };
    expect(JSON.parse(text(ok(obj)))).toEqual(obj);
  });
});
