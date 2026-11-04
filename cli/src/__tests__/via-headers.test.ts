import { describe, expect, it } from "vitest";

import { viaHeaders } from "../api/client";

// Every admin-API call names its door so the dashboard can label the write
// ("via CLI · Claude") — and the agent only when one is actually driving.
describe("viaHeaders", () => {
  it("labels a plain terminal as the CLI with no agent", () => {
    expect(viaHeaders({})).toEqual({ "X-Shipeasy-Via": "cli" });
  });

  it("names the coding agent running the CLI", () => {
    expect(viaHeaders({ CLAUDECODE: "1" })).toEqual({
      "X-Shipeasy-Via": "cli",
      "X-Shipeasy-Agent": "Claude Code",
    });
    expect(viaHeaders({ CODEX_SANDBOX: "seatbelt" })["X-Shipeasy-Agent"]).toBe("OpenAI Codex");
  });

  it("honours an explicit opt-out inside a harness", () => {
    expect(viaHeaders({ CLAUDECODE: "1", SHIPEASY_AGENT: "0" })).toEqual({
      "X-Shipeasy-Via": "cli",
    });
  });

  it("carries the trail an agent is working under, and drops anything that is not one", () => {
    expect(viaHeaders({ SHIPEASY_TRAIL: "T-12" })).toEqual({
      "X-Shipeasy-Via": "cli",
      "X-Shipeasy-Trail": "T-12",
    });
    expect(viaHeaders({ SHIPEASY_TRAIL: "t-7" })["X-Shipeasy-Trail"]).toBe("T-7");
    expect(viaHeaders({ SHIPEASY_TRAIL: "not a trail" })).toEqual({ "X-Shipeasy-Via": "cli" });
    expect(viaHeaders({ SHIPEASY_TRAIL: "" })).toEqual({ "X-Shipeasy-Via": "cli" });
  });
});
