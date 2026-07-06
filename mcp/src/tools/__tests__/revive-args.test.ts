import { describe, expect, it } from "vitest";

import { ApiError, reviveStructuredArgs, unwrap } from "../_gen-runtime.js";

const res = (status: number) =>
  ({ ok: status >= 200 && status < 300, status }) as Response;

describe("unwrap", () => {
  it("returns data on success", () => {
    expect(unwrap({ data: { id: "cfg_1" }, response: res(200) })).toEqual({ id: "cfg_1" });
  });

  it("folds `instructions` into the thrown message so guidance reaches the agent", () => {
    try {
      unwrap({
        error: {
          error: "Config value does not match schema: /tiers: must be array",
          code: "VALIDATION",
          instructions: "Fix `value` … Expected schema:\n{\n  \"type\": \"object\"\n}",
        },
        response: res(400),
      });
      throw new Error("expected unwrap to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as ApiError;
      expect(err.status).toBe(400);
      expect(err.code).toBe("VALIDATION");
      expect(err.message).toContain("does not match schema");
      // the expected schema (carried in instructions) is now visible
      expect(err.message).toContain("Expected schema:");
      expect(err.message).toContain('"type": "object"');
    }
  });

  it("falls back to an HTTP status line when the body has no message", () => {
    try {
      unwrap({ error: {}, response: res(500) });
      throw new Error("expected unwrap to throw");
    } catch (e) {
      expect((e as ApiError).message).toBe("HTTP 500");
    }
  });
});

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
