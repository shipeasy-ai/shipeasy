import { describe, expect, it } from "vitest";

import { reviveStructuredArgs } from "../_gen-runtime.js";

// The config-draft tool's real shape: `value` is freeform (no `type`), which is
// exactly what makes an MCP host stringify an object argument.
const CONFIG_DRAFT_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    env: { type: "string", enum: ["dev", "staging", "prod"] },
    value: { description: "Draft value to stage on `env`." },
  },
} as const;

describe("reviveStructuredArgs", () => {
  it("parses an over-stringified freeform object value back to an object", () => {
    const out = reviveStructuredArgs(
      { id: "cfg_1", env: "prod", value: '{"tiers":["free","pro"]}' },
      CONFIG_DRAFT_SCHEMA,
    );
    expect(out.value).toEqual({ tiers: ["free", "pro"] });
    // scalar/enum params are untouched
    expect(out.id).toBe("cfg_1");
    expect(out.env).toBe("prod");
  });

  it("parses a per-env `{ env: value }` map that was stringified", () => {
    const out = reviveStructuredArgs(
      { id: "cfg_1", env: "prod", value: '{"prod":{"on":true}}' },
      CONFIG_DRAFT_SCHEMA,
    );
    expect(out.value).toEqual({ prod: { on: true } });
  });

  it("leaves an already-object value untouched (no double-parse)", () => {
    const value = { a: 1 };
    const out = reviveStructuredArgs({ value }, CONFIG_DRAFT_SCHEMA);
    expect(out.value).toBe(value);
  });

  it("does not coerce a freeform scalar string that happens to be valid JSON", () => {
    expect(reviveStructuredArgs({ value: "42" }, CONFIG_DRAFT_SCHEMA).value).toBe("42");
    expect(reviveStructuredArgs({ value: "true" }, CONFIG_DRAFT_SCHEMA).value).toBe("true");
    expect(reviveStructuredArgs({ value: "hello" }, CONFIG_DRAFT_SCHEMA).value).toBe("hello");
  });

  it("parses explicit object/array-typed params", () => {
    const schema = {
      type: "object",
      properties: {
        obj: { type: "object" },
        arr: { type: "array" },
      },
    };
    const out = reviveStructuredArgs({ obj: '{"x":1}', arr: "[1,2,3]" }, schema);
    expect(out.obj).toEqual({ x: 1 });
    expect(out.arr).toEqual([1, 2, 3]);
  });

  it("leaves a genuine string param alone even when it looks like JSON", () => {
    const schema = { type: "object", properties: { note: { type: "string" } } };
    const out = reviveStructuredArgs({ note: "{not really json}" }, schema);
    expect(out.note).toBe("{not really json}");
  });

  it("leaves malformed JSON on a structured param as-is (server rejects it)", () => {
    const out = reviveStructuredArgs({ value: "{oops" }, CONFIG_DRAFT_SCHEMA);
    expect(out.value).toBe("{oops");
  });

  it("returns the same reference when nothing needed reviving", () => {
    const args = { id: "cfg_1", env: "prod" };
    expect(reviveStructuredArgs(args, CONFIG_DRAFT_SCHEMA)).toBe(args);
  });
});
