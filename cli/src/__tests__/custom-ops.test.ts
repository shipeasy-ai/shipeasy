import { describe, it, expect } from "vitest";
import { customOperations, METRIC_GRAMMAR, opId } from "@shipeasy/openapi/custom";

/**
 * The shared custom-operations registry (sugar commands that aren't spec
 * endpoints) — projected onto the CLI today and the MCP server later, so we
 * assert its shape + the pure ops here.
 */
describe("custom-operations registry", () => {
  it("exposes metrics grammar + docs list/get/skill", () => {
    expect(customOperations.map(opId).sort()).toEqual(
      ["docs.get", "docs.list", "docs.skill", "metrics.grammar"].sort(),
    );
  });

  it("every op has a group, summary, and run", () => {
    for (const op of customOperations) {
      expect(op.group.length).toBeGreaterThan(0);
      expect(op.summary).toBeTruthy();
      expect(typeof op.run).toBe("function");
    }
  });

  it("metrics grammar returns the DSL grammar (pure, no network)", async () => {
    const grammar = customOperations.find((o) => opId(o) === "metrics.grammar")!;
    const out = (await grammar.run({})) as { grammar: string };
    expect(out.grammar).toBe(METRIC_GRAMMAR);
    expect(out.grammar).toContain("count_users(checkout_completed)");
    // Locks in the concepts the parser/IR encode but the old text omitted.
    expect(out.grammar).toContain("Value label"); // required/forbidden rules
    expect(out.grammar).toMatch(/approx.*avg/); // experiment reducer approximation
    expect(out.grammar).toContain("NOT SUPPORTED"); // no formulas/subqueries
  });

  it("docs get rejects an unknown SDK before any fetch", async () => {
    const get = customOperations.find((o) => opId(o) === "docs.get")!;
    await expect(get.run({ sdk: "cobol", path: "flags" })).rejects.toThrow(/Unknown SDK/);
  });

  it("docs params mark sdk optional (defaulted from .shipeasy) and path positional", () => {
    const get = customOperations.find((o) => opId(o) === "docs.get")!;
    // `sdk` is optional: the CLI/MCP adapters default it from the nearest
    // `.shipeasy`, and the op throws a clear error only if it's still empty.
    expect(get.params.find((p) => p.name === "sdk")?.required).toBe(false);
    expect(get.params.find((p) => p.name === "path")?.positional).toBe(true);
  });

  it("docs get rejects a missing SDK with actionable guidance", async () => {
    const get = customOperations.find((o) => opId(o) === "docs.get")!;
    await expect(get.run({ path: "flags" })).rejects.toThrow(/No SDK given and none recorded/);
  });
});
