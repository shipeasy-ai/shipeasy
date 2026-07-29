import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, errorCodeOf, isApiErrorBody } from "../src/index.js";

/** As much of a JSON Schema node as the assertions below need to walk. */
type SpecSchema = {
  enum?: string[];
  const?: string;
  default?: unknown;
  anyOf?: SpecSchema[];
  items?: SpecSchema;
  properties?: Record<string, SpecSchema>;
};

type SpecOperation = {
  operationId?: string;
  "x-error-codes"?: string[];
  parameters?: Array<{ name?: string; in?: string; schema?: SpecSchema }>;
};

const spec = parseYaml(
  readFileSync(fileURLToPath(new URL("../openapi.yaml", import.meta.url)), "utf8"),
) as {
  openapi: string;
  tags: Array<{ name: string; parent?: string; kind?: string }>;
  paths: Record<string, Record<string, SpecOperation>>;
  components: { schemas: Record<string, SpecSchema> };
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

/**
 * `openapi-sdk.yaml` is the second root over the same `paths/` tree — the slice
 * the eight published server SDKs vendor and generate their `AdminClient` from
 * (see the header of `spec/openapi-sdk.yaml`). Every operation here lands in
 * four generated clients across four repos, so widening it is a deliberate act:
 * this list is exhaustive on purpose and adding a `$ref` there must move it.
 */
describe("server-SDK surface", () => {
  const sdkSpec = parseYaml(
    readFileSync(fileURLToPath(new URL("../openapi-sdk.json", import.meta.url)), "utf8"),
  ) as typeof spec;

  const sdkOperations = () =>
    Object.entries(sdkSpec.paths).flatMap(([path, item]) =>
      Object.entries(item)
        .filter(([m]) => METHODS.includes(m))
        .map(([method, op]) => ({ path, method, op })),
    );

  it("exposes exactly the three-capability keep-set", () => {
    expect(sdkOperations().map(({ op }) => op.operationId).sort()).toEqual([
      "addToGateWhitelist",
      "createPublicBug",
      "createPublicFeatureRequest",
      "getGateWhitelist",
      "removeFromGateWhitelist",
      "setGateWhitelist",
      "toggleKillswitch",
    ]);
  });

  it("every SDK operation is the same object the full spec serves", () => {
    for (const { path, method, op } of sdkOperations()) {
      // Both roots `$ref` the same `paths/*.yaml` entry, so a divergence here
      // means someone hand-edited one bundle instead of re-running `pnpm gen`.
      expect(spec.paths[path]?.[method]?.operationId, `${method.toUpperCase()} ${path}`).toBe(
        op.operationId,
      );
    }
  });

  it("carries only the schemas those operations reach", () => {
    // The bundler prunes by reachability; a jump here means an operation
    // started pulling in a large shared schema and the clients just grew.
    const count = Object.keys(sdkSpec.components.schemas).length;
    expect(count).toBeLessThanOrEqual(30);
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

/**
 * The `type` a queue item can carry is written out by hand three times — once as
 * the `listOpsItems` filter, once in each response schema — because there is no
 * `OpsItemType` component to `$ref` (extracting one would retype `type` as a TS
 * enum in every generated client, so the copies stay and this test keeps them
 * honest). They drifted once: `measure_plan` reached both responses but never the
 * filter, so the queue returned assistant-proposed measurement plans that no
 * caller could ask for by type.
 */
describe("ops queue type filter", () => {
  /** Flatten the `anyOf` of literals + enums a filter param is built from. */
  const literals = (schema: SpecSchema | undefined): string[] =>
    (schema?.anyOf ?? [schema ?? {}]).flatMap((s) => s.enum ?? (s.const ? [s.const] : []));

  const filterValues = () => {
    const param = spec.paths["/api/admin/ops"]!.get!.parameters!.find((p) => p.name === "type");
    return literals(param?.schema);
  };

  const responseValues = () => ({
    listOpsItems: spec.components.schemas.ListOpsItemsResponse?.items?.properties?.type?.enum,
    getOpsItem: spec.components.schemas.GetOpsItemResponse?.properties?.type?.enum,
  });

  it("offers every type a returned item can carry", () => {
    const filter = new Set(filterValues());
    for (const [schema, values] of Object.entries(responseValues())) {
      expect(values, `${schema} declares a type enum`).toBeDefined();
      for (const v of values!) expect(filter.has(v), `${schema} returns ${v}`).toBe(true);
    }
  });

  it("offers nothing beyond those types except `all`", () => {
    const returned = new Set(responseValues().getOpsItem);
    for (const v of filterValues()) {
      if (v === "all") continue;
      expect(returned.has(v), `filterable ${v} is never returned`).toBe(true);
    }
  });

  it("both response schemas agree", () => {
    const { listOpsItems, getOpsItem } = responseValues();
    expect(listOpsItems).toEqual(getOpsItem);
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
