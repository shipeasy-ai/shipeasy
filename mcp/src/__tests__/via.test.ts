import { afterEach, describe, expect, it } from "vitest";

import { setMcpClientName, viaHeaders } from "../util/via.js";

// Every admin-API call names its door so the dashboard can label the write
// ("via MCP · Claude"): the connected client's own name first, the harness env
// when the client sent none.
describe("viaHeaders", () => {
  afterEach(() => setMcpClientName(undefined));

  it("forwards the MCP client's self-reported name as the agent", () => {
    setMcpClientName("codex-mcp-client");
    expect(viaHeaders({})).toEqual({
      "X-Shipeasy-Via": "mcp",
      "X-Shipeasy-Agent": "codex-mcp-client",
    });
  });

  it("falls back to the harness env when the client sent no name", () => {
    expect(viaHeaders({ CLAUDECODE: "1" })).toEqual({
      "X-Shipeasy-Via": "mcp",
      "X-Shipeasy-Agent": "claude",
    });
  });

  it("names no agent for an unknown host", () => {
    setMcpClientName("  ");
    expect(viaHeaders({})).toEqual({ "X-Shipeasy-Via": "mcp" });
  });
});
