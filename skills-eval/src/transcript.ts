import { MCP_SERVER_NAME } from "./catalog.js";
import type { Observation } from "./types.js";

const MCP_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

/** Which agent runner produced the transcript (its NDJSON shape differs). */
export type TranscriptFormat = "claude" | "copilot";

/**
 * Parse the newline-delimited JSON a headless agent run emits into the skills
 * and MCP tools that were invoked. Two shapes are supported (`format`):
 *
 * - **claude** (`claude -p --output-format stream-json --verbose`, default):
 *   the *complete* assistant-message events (`{type:"assistant",
 *   message:{content:[…]}}`), whose `content[]` carries whole `tool_use` blocks
 *   ({type,name,input}). A Skill invocation is a `tool_use` block named "Skill"
 *   whose skill name lives *somewhere* in `input` (the field has varied across
 *   versions: `command`, `name`, `skill`, `skill_name`), so we scan the whole
 *   input for a known skill token.
 *
 * - **copilot** (`copilot -p --output-format json`): one JSON object per line;
 *   tool calls ride on `{type:"assistant.message", data:{toolRequests:[…]}}`.
 *   An MCP call carries `{mcpServerName, mcpToolName, arguments}` (server-name
 *   agnostic — we key off `mcpToolName`); a skill invocation is the builtin
 *   `skill` tool with `{arguments:{skill:"<name>"}}`; asking is the `ask_user`
 *   tool. Copilot discovers the sandbox `.claude/skills/` (so it fires the same
 *   `shipeasy-*` skills), but an installed plugin may expose them under the
 *   short name (`flags`) — {@link matchSkillToken} maps `flags`→`shipeasy-flags`.
 *
 * Pass the set of skill names you care about as `knownSkills`.
 */
export function parseTranscript(
  ndjson: string,
  knownSkills: Iterable<string>,
  format: TranscriptFormat = "claude",
): Observation {
  return format === "copilot"
    ? parseCopilotTranscript(ndjson, knownSkills)
    : parseClaudeTranscript(ndjson, knownSkills);
}

function parseClaudeTranscript(ndjson: string, knownSkills: Iterable<string>): Observation {
  const skills: string[] = [];
  const tools: string[] = [];
  const toolCalls: Observation["toolCalls"] = [];
  const otherTools: string[] = [];
  const textParts: string[] = [];
  let askedUser = false;
  let lastAssistantText = "";
  const skillNames = [...knownSkills];

  const lines = ndjson.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    let evt: unknown;
    try {
      evt = JSON.parse(line);
    } catch {
      continue; // non-JSON noise (shouldn't happen with --output-format stream-json)
    }
    const blocks = textBlocks(evt);
    textParts.push(...blocks);
    // Track the agent's LAST piece of prose so we can detect a headless "ask".
    if (isObject(evt) && evt.type === "assistant") {
      for (const t of blocks) if (t.trim()) lastAssistantText = t;
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
  // Headless `claude -p` has no interactive UI, so the model asks the user in
  // prose (posing a question in its closing turn) rather than calling the
  // AskUserQuestion tool. Count either as "asked": the tool if present, else a
  // final assistant message that poses a question — a "…?" offer, even when a
  // rationale sentence follows it.
  if (!askedUser && posesQuestion(lastAssistantText)) askedUser = true;

  return { skills, tools, toolCalls, otherTools, askedUser, text: textParts.join("\n") };
}

/**
 * Parse `copilot -p --output-format json` (JSONL, one object per line). Tool
 * calls ride on `assistant.message` events under `data.toolRequests[]`; the
 * agent's prose is `data.content`. See {@link parseTranscript} for the shape.
 */
function parseCopilotTranscript(ndjson: string, knownSkills: Iterable<string>): Observation {
  const skills: string[] = [];
  const tools: string[] = [];
  const toolCalls: Observation["toolCalls"] = [];
  const otherTools: string[] = [];
  const textParts: string[] = [];
  let askedUser = false;
  let lastAssistantText = "";
  const skillNames = [...knownSkills];

  const lines = ndjson.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    let evt: unknown;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(evt) || evt.type !== "assistant.message") continue;
    const data = isObject(evt.data) ? evt.data : undefined;
    if (!data) continue;

    if (typeof data.content === "string" && data.content.trim()) {
      textParts.push(data.content);
      lastAssistantText = data.content;
    }
    const requests = Array.isArray(data.toolRequests) ? data.toolRequests : [];
    for (const req of requests) {
      if (!isObject(req)) continue;
      const name = typeof req.name === "string" ? req.name : "";
      const args = req.arguments;
      // MCP tool: identified by `mcpToolName` (server-name agnostic).
      if (typeof req.mcpToolName === "string" && req.mcpToolName) {
        tools.push(req.mcpToolName);
        toolCalls.push({ name: req.mcpToolName, inputText: JSON.stringify(args ?? "") });
        continue;
      }
      // Skill invocation: the builtin `skill` tool, arg `{skill:"<name>"}`.
      if (name === "skill") {
        const token = isObject(args) && typeof args.skill === "string" ? args.skill : "";
        const hit = matchSkillToken(token, skillNames);
        if (hit) skills.push(hit);
        else otherTools.push("skill(?)");
        continue;
      }
      if (name === "ask_user") askedUser = true;
      if (name) otherTools.push(name);
    }
  }
  // Same headless-ask heuristic as claude: a closing question in prose counts.
  if (!askedUser && posesQuestion(lastAssistantText)) askedUser = true;

  return { skills, tools, toolCalls, otherTools, askedUser, text: textParts.join("\n") };
}

/**
 * Map a copilot skill token to a known (claude-named) skill. The sandbox
 * `.claude/skills/` copies expose the full `shipeasy-flags` name, but an
 * installed plugin may register the short `flags`; accept an exact match, the
 * `shipeasy-<token>` form, or any known name ending in `-<token>`. Longest
 * known name first so `ops-work` wins over `ops`.
 */
function matchSkillToken(token: string, skillNames: string[]): string | undefined {
  if (!token) return undefined;
  const t = token.toLowerCase();
  for (const name of [...skillNames].sort((a, b) => b.length - a.length)) {
    const n = name.toLowerCase();
    if (n === t || n === `shipeasy-${t}` || n.endsWith(`-${t}`)) return name;
  }
  return undefined;
}

/** True if the agent's closing prose poses a question to the user. */
function posesQuestion(text: string): boolean {
  return text.includes("?");
}

interface ToolUse {
  name: string;
  input: unknown;
}

/**
 * Pull the AGENT'S OWN prose out of one stream-json event: the `text` of every
 * `{type:"text"}` block in an *assistant* message, plus the final
 * `{type:"result", result:"…"}` summary. We deliberately IGNORE user / system /
 * tool_result messages — a Skill invocation injects that skill's whole SKILL.md
 * body back as tool-result text, so capturing those would let `expect_text_contains`
 * match the skill's *documentation* ("…the guided `shipeasy setup`") instead of the
 * model's own recommendation. Assistant text is the model speaking; that's what we score.
 */
function textBlocks(evt: unknown): string[] {
  if (!isObject(evt)) return [];
  if (evt.type === "result" && typeof evt.result === "string") return [evt.result];
  if (evt.type !== "assistant") return [];
  const message = isObject(evt.message) ? evt.message : undefined;
  const content = message && Array.isArray(message.content) ? message.content : undefined;
  if (!content) return [];
  const out: string[] = [];
  for (const block of content) {
    if (isObject(block) && block.type === "text" && typeof block.text === "string") {
      out.push(block.text);
    }
  }
  return out;
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
