import { describe, expect, it } from "vitest";
import { parseTranscript } from "../transcript.js";

/** Build one stream-json assistant event with the given tool_use blocks. */
function assistant(blocks: Array<{ name: string; input: unknown }>): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: blocks.map((b, i) => ({
        type: "tool_use",
        id: `toolu_${i}`,
        name: b.name,
        input: b.input,
      })),
    },
  });
}

const KNOWN = ["shipeasy-flags", "shipeasy-ops", "shipeasy-ops-work"];

describe("parseTranscript", () => {
  it("pulls the skill name and MCP tool from a real-shaped stream", () => {
    const ndjson = [
      JSON.stringify({ type: "system", subtype: "init" }),
      assistant([{ name: "Skill", input: { command: "shipeasy-flags" } }]),
      assistant([
        { name: "mcp__shipeasy__release_flags_create", input: { name: "checkout_v2" } },
      ]),
      JSON.stringify({ type: "result", subtype: "success" }),
    ].join("\n");

    const obs = parseTranscript(ndjson, KNOWN);
    expect(obs.skills).toEqual(["shipeasy-flags"]);
    expect(obs.tools).toEqual(["release_flags_create"]);
    expect(obs.otherTools).toEqual([]);
  });

  it("matches the skill regardless of which input field holds it", () => {
    for (const input of [
      { skill_name: "shipeasy-flags" },
      { name: "shipeasy-flags" },
      { skill: "shipeasy-flags" },
      "invoking shipeasy-flags now",
    ]) {
      const obs = parseTranscript(assistant([{ name: "Skill", input }]), KNOWN);
      expect(obs.skills).toEqual(["shipeasy-flags"]);
    }
  });

  it("prefers the longest matching skill name (ops-work over ops)", () => {
    const obs = parseTranscript(
      assistant([{ name: "Skill", input: { command: "shipeasy-ops-work" } }]),
      KNOWN,
    );
    expect(obs.skills).toEqual(["shipeasy-ops-work"]);
  });

  it("classifies non-MCP, non-Skill tools as otherTools", () => {
    const obs = parseTranscript(
      assistant([
        { name: "Bash", input: { command: "ls" } },
        { name: "mcp__shipeasy__ops_create", input: {} },
      ]),
      KNOWN,
    );
    expect(obs.tools).toEqual(["ops_create"]);
    expect(obs.otherTools).toEqual(["Bash"]);
  });

  it("captures tool inputs as stringified text for arg assertions", () => {
    const obs = parseTranscript(
      assistant([
        {
          name: "mcp__shipeasy__release_flags_create",
          input: { name: "checkout", rules: [{ attr: "country", value: ["US"] }] },
        },
      ]),
      KNOWN,
    );
    expect(obs.toolCalls).toHaveLength(1);
    expect(obs.toolCalls[0]!.name).toBe("release_flags_create");
    expect(obs.toolCalls[0]!.inputText).toContain("US");
  });

  it("flags AskUserQuestion via askedUser", () => {
    const without = parseTranscript(assistant([{ name: "Bash", input: {} }]), KNOWN);
    expect(without.askedUser).toBe(false);
    const withAsk = parseTranscript(
      assistant([{ name: "AskUserQuestion", input: { questions: [] } }]),
      KNOWN,
    );
    expect(withAsk.askedUser).toBe(true);
  });

  it("tolerates non-JSON lines and empty input", () => {
    const obs = parseTranscript("not json\n\n{bad}\n", KNOWN);
    expect(obs).toEqual({
      skills: [], tools: [], toolCalls: [], otherTools: [], askedUser: false, text: "",
    });
  });

  it("captures assistant text blocks and the final result for text assertions", () => {
    const ndjson = [
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "Run `shipeasy setup` to onboard." }] },
      }),
      JSON.stringify({ type: "result", subtype: "success", result: "Done — I recommended shipeasy setup." }),
    ].join("\n");
    const obs = parseTranscript(ndjson, KNOWN);
    expect(obs.text).toContain("shipeasy setup");
    expect(obs.text).toContain("Done —");
  });
});
