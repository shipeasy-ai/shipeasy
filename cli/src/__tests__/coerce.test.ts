import { describe, it, expect } from "vitest";
import { makeCoercer, scalarType } from "../../scripts/coerce.mjs";
import { list } from "../commands/_gen-runtime";

/** Stand-in for the generator's spec-aware $ref resolver. */
const SCHEMAS: Record<string, unknown> = {
  OpsItemStatus: { type: "string", enum: ["open", "fixed", "wont_fix"] },
};
const deref = (o: any) =>
  o && o.$ref ? SCHEMAS[String(o.$ref).split("/").pop()!] : o;
const coerce = makeCoercer(deref);

describe("scalarType", () => {
  it("reads the declared type, normalizing integer to number", () => {
    expect(scalarType({ type: "string" })).toBe("string");
    expect(scalarType({ type: "integer" })).toBe("number");
    expect(scalarType({ type: ["string", "null"] })).toBe("string");
  });

  it("infers from const/enum values when no type is declared", () => {
    expect(scalarType({ const: "all" })).toBe("string");
    expect(scalarType({ enum: ["a", "b"] })).toBe("string");
    expect(scalarType({ enum: [1, 2] })).toBe("number");
  });

  it("gives up on mixed or empty value sets", () => {
    expect(scalarType({ enum: ["a", 1] })).toBeNull();
    expect(scalarType({ enum: [] })).toBeNull();
    expect(scalarType({})).toBeNull();
  });
});

describe("coercer", () => {
  it("maps plain scalars to their helper", () => {
    expect(coerce({ type: "string" })).toBe("str");
    expect(coerce({ type: "integer" })).toBe("num");
    expect(coerce({ type: "number" })).toBe("num");
    expect(coerce({ type: "boolean" })).toBe("bool");
    expect(coerce({ type: "object" })).toBe("json");
    expect(coerce({ type: "array" })).toBe("json");
  });

  it("gives an array of short tokens the comma-list helper", () => {
    const tagName = { type: "string", minLength: 1, maxLength: 64 };
    expect(coerce({ type: "array", items: tagName })).toBe("list");
    expect(coerce({ type: "array", items: { type: "string", format: "email" } })).toBe("list");
    expect(coerce({ type: "array", items: { $ref: "#/OpsItemStatus" } })).toBe("list");
  });

  it("keeps free-text and non-string arrays JSON-only (their items can hold commas)", () => {
    expect(coerce({ type: "array", items: { type: "string" } })).toBe("json");
    expect(coerce({ type: "array", items: { type: "string", maxLength: 120 } })).toBe("json");
    expect(coerce({ type: "array", items: { type: "object" } })).toBe("json");
    expect(coerce({ type: "array", items: { type: "integer" } })).toBe("json");
  });

  it("unwraps a nullable union to its single real branch", () => {
    expect(coerce({ anyOf: [{ type: "string" }, { type: "null" }] })).toBe("str");
    expect(coerce({ anyOf: [{ type: "integer" }, { type: "null" }] })).toBe("num");
  });

  // The `ops list --type bug` regression: `enum | const "all"` is two real
  // branches, but both are strings, so the flag value must stay a string. It
  // used to fall through to json() and die with `expected JSON, got "bug"`.
  it("keeps a same-scalar union as that scalar", () => {
    expect(
      coerce({
        anyOf: [
          { type: "string", enum: ["bug", "feature_request", "error", "alert"] },
          { type: "string", const: "all" },
        ],
      }),
    ).toBe("str");
  });

  it("resolves $ref branches before judging the union", () => {
    expect(
      coerce({
        anyOf: [{ $ref: "#/components/schemas/OpsItemStatus" }, { type: "string", const: "all" }],
      }),
    ).toBe("str");
  });

  it("keeps a same-scalar numeric union numeric", () => {
    expect(coerce({ anyOf: [{ type: "integer" }, { type: "number" }] })).toBe("num");
  });

  it("falls back to json for genuinely mixed or non-scalar unions", () => {
    expect(coerce({ anyOf: [{ type: "string" }, { type: "integer" }] })).toBe("json");
    expect(coerce({ anyOf: [{ type: "object" }, { type: "object" }] })).toBe("json");
    expect(coerce({ allOf: [{ type: "string" }] })).toBe("json");
  });
});

describe("list (runtime)", () => {
  it("splits a comma list, trimming and dropping blanks", () => {
    expect(list("ios, Checkout ,,")).toEqual(["ios", "Checkout"]);
    expect(list("ios")).toEqual(["ios"]);
  });

  it("still takes a JSON array and null", () => {
    expect(list('["a,b", "c"]')).toEqual(["a,b", "c"]);
    expect(list("null")).toBeNull();
    expect(list(undefined)).toBeUndefined();
  });
});
