import { describe, it, expect } from "vitest";
import { zCreateKeyRequest } from "@shipeasy/openapi/schemas";
import { buildProgram } from "../index";

// `sdk keys create --scopes` derives its valid values from the OpenAPI
// CreateKeyRequest schema (single source of truth). These lock that wiring so a
// zod upgrade that breaks the schema-introspection can't silently strip it.

function find(cmd: { commands: unknown[] }, path: string[]): any {
  let c: any = cmd;
  for (const p of path) c = c.commands.find((x: any) => x.name() === p);
  return c;
}

describe("sdk keys create — spec-derived scopes", () => {
  it("reads the scope enum straight off the OpenAPI schema", () => {
    const opts = zCreateKeyRequest.shape.scopes.unwrap().element.options as readonly string[];
    expect(opts).toContain("tickets:public_create");
    expect(opts).toContain("gates:evaluate");
  });

  it("surfaces --name + --scopes (with the ticket scope) on the create command", () => {
    const create = find(buildProgram(), ["sdk", "keys", "create"]);
    expect(create).toBeTruthy();
    const longs = create.options.map((o: { long: string }) => o.long);
    expect(longs).toContain("--name");
    expect(longs).toContain("--scopes");
    const scopes = create.options.find((o: { long: string }) => o.long === "--scopes");
    expect(scopes.description).toContain("tickets:public_create");
  });
});
