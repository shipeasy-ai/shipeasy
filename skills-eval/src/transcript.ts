import { MCP_SERVER_NAME } from "./catalog.js";
import type { Observation } from "./types.js";

const MCP_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

/**
 * Parse the newline-delimited JSON emitted by
 * `claude -p --output-format stream-json --verbose` into the skills and MCP
 * tools that were invoked.
 *
 * We read the *complete* assistant-message events (`{type:"assistant",
 * message:{content:[…]}}`), whose `content[]` carries whole `tool_use` blocks
 * ({type,name,input}). That's far more robust than reassembling
 * `input_json_delta` chunks, and it's what stream-json emits per turn even
 * without `--include-partial-messages`.
 *
 * A Skill invocation shows up as a `tool_use` block named "Skill"; the skill's
 * name lives somewhere in `input` (field name has varied across versions:
 * `command`, `name`, `skill`, `skill_name`) — so we scan the whole input for a
 * known skill token rather than trusting one field. Pass the set of skill names
 * you care about as `knownSkills`.
 */
export function parseTranscript(ndjson: string, knownSkills: Iterable<string>): Observation {
  const skills: string[] = [];
  const tools: string[] = [];
  const toolCalls: Observation["toolCalls"] = [];
  const otherTools: string[] = [];
  let askedUser = false;
  const skillNames = [...knownSkills];

  const lines = ndjson.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    let evt: unknown;
    try {
      evt = JSON.parse(line);
    } catch {
      continue; // non-JSON noise (shouldn't happen with --output-format stream-json)
    }
    for (const block of toolUseBlocks(evt)) {
      if (block.name === "Skill") {
        const hit = matchSkill(block.input, skillNames);
        if (hit) skills.push(hit);
        else otherTools.push("Skill(?)");
      } else if (block.name.startsWith(MCP_PREFIX)) {
        const suffix = block.name.slice(MCP_PREFIX.length);
        tools.push(suffix);
        toolCalls.push({ name: suffix, inputText: JSON.stringify(block.input ?? "") });
      } else {
        if (block.name === "AskUserQuestion") askedUser = true;
        otherTools.push(block.name);
      }
    }
  }
  return { skills, tools, toolCalls, otherTools, askedUser };
}

interface ToolUse {
  name: string;
  input: unknown;
}

/** Pull `tool_use` content blocks out of one stream-json event, if any. */
function toolUseBlocks(evt: unknown): ToolUse[] {
  if (!isObject(evt)) return [];
  // Complete assistant message: { type:"assistant", message:{ content:[…] } }
  const message = isObject(evt.message) ? evt.message : undefined;
  const content = message && Array.isArray(message.content) ? message.content : undefined;
  if (!content) return [];
  const out: ToolUse[] = [];
  for (const block of content) {
    if (isObject(block) && block.type === "tool_use" && typeof block.name === "string") {
      out.push({ name: block.name, input: block.input });
    }
  }
  return out;
}

/** Find which known skill (if any) the Skill-tool input refers to. */
function matchSkill(input: unknown, skillNames: string[]): string | undefined {
  const hay = JSON.stringify(input ?? "").toLowerCase();
  // Longest name first so "shipeasy-ops-work" wins over "shipeasy-ops".
  for (const name of [...skillNames].sort((a, b) => b.length - a.length)) {
    if (hay.includes(name.toLowerCase())) return name;
  }
  return undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
