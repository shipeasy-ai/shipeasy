import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, errorCodeOf, isApiErrorBody } from "../src/index.js";

const spec = parseYaml(
  readFileSync(fileURLToPath(new URL("../openapi.yaml", import.meta.url)), "utf8"),
) as {
  openapi: string;
  tags: Array<{ name: string; parent?: string; kind?: string }>;
  paths: Record<string, Record<string, { operationId?: string; "x-error-codes"?: string[] }>>;
  components: { schemas: Record<string, { enum?: string[] }> };
};

const METHODS = ["get", "post", "put", "patch", "delete"];
const operations = () =>
  Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([m]) => METHODS.includes(m))
      .map(([method, op]) => ({ path, method, op })),
  );

describe("spec shape", () => {
  it("is OpenAPI 3.2", () => {
    expect(spec.openapi).toBe("3.2.0");
  });

  it("defines the Error envelope + ErrorCode enum", () => {
    expect(spec.components.schemas.Error).toBeDefined();
    expect(spec.components.schemas.ErrorCode?.enum).toEqual([...ERROR_CODES]);
  });
});

describe("hierarchical tags (3.2)", () => {
  it("every tag parent resolves to a declared nav tag", () => {
    const names = new Set(spec.tags.map((t) => t.name));
    for (const t of spec.tags) {
      if (t.parent) expect(names.has(t.parent), `parent ${t.parent} of ${t.name}`).toBe(true);
    }
  });
});

describe("error model parity", () => {
  const codes = new Set<string>(ERROR_CODES);

  it("every operation declares x-error-codes", () => {
    for (const { path, method, op } of operations()) {
      expect(op["x-error-codes"], `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(op["x-error-codes"]!.length).toBeGreaterThan(0);
    }
  });

  it("every x-error-codes entry is a catalogued ErrorCode", () => {
    for (const { path, method, op } of operations()) {
      for (const c of op["x-error-codes"] ?? []) {
        expect(codes.has(c), `${method.toUpperCase()} ${path} → ${c}`).toBe(true);
      }
    }
  });

  it("every catalogued ErrorCode is used by at least one operation", () => {
    const used = new Set(operations().flatMap(({ op }) => op["x-error-codes"] ?? []));
    for (const c of ERROR_CODES) {
      // INTERNAL (500) is the catch-all, intentionally not per-operation.
      if (c === "INTERNAL") continue;
      expect(used.has(c), `unused ErrorCode ${c}`).toBe(true);
    }
  });
});

describe("error helpers", () => {
  it("recognises a well-formed error body", () => {
    expect(isApiErrorBody({ error: "nope", code: "ALREADY_EXISTS" })).toBe(true);
    expect(isApiErrorBody({ message: "nope" })).toBe(false);
  });

  it("narrows known codes only", () => {
    expect(errorCodeOf({ error: "x", code: "PLAN_REQUIRED" })).toBe("PLAN_REQUIRED");
    expect(errorCodeOf({ error: "x", code: "NOT_A_CODE" })).toBeUndefined();
    expect(errorCodeOf({ error: "x" })).toBeUndefined();
  });
});
