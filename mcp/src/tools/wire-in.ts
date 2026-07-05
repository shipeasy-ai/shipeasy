import { readProjectConfigSync } from "@shipeasy/openapi/node-context";

/**
 * Creating an event registers a NAME; it does not make any data flow. Until the
 * app actually calls `track("<name>", …)` at the point the action happens, every
 * metric over the event reads zero. So a successful `metrics_events_create` is
 * only half the job — the caller must still wire the tracking call into the
 * code. This module builds the extra `content` block that says so, with a
 * language-correct example picked up from the `.shipeasy` binding (`language` /
 * `sdk`), to reinforce that follow-through at the exact moment the event lands.
 */

type EventProperty = { name?: unknown; type?: unknown };

/** Placeholder literal for a property of the given declared type. */
function placeholder(type: unknown): string {
  if (type === "number") return "0";
  if (type === "boolean") return "true";
  return '"…"';
}

/** Render the event's declared properties into a `key: value` payload fragment. */
function payloadPairs(
  properties: EventProperty[] | undefined,
  quoteKey: boolean,
): string {
  const props = (properties ?? []).filter((p) => typeof p?.name === "string");
  if (!props.length) return quoteKey ? '/* add the properties your metric queries */' : "/* … */";
  return props
    .map((p) => {
      const key = quoteKey ? `"${p.name as string}"` : (p.name as string);
      return `${key}: ${placeholder(p.type)}`;
    })
    .join(", ");
}

/**
 * A language-correct `track(...)` example for the resolved SDK. Indicative form
 * — the authoritative, version-correct snippet is the `{{SDK_SNIPPET:metrics/track}}`
 * in the shipeasy-metrics skill; we point the caller there for the exact shape.
 */
function trackSnippet(lang: string, event: string, properties: EventProperty[] | undefined): string {
  const objKey = payloadPairs(properties, true); // "k": v  (JSON-ish langs)
  const bareKey = payloadPairs(properties, false); // k: v   (JS object literal)
  switch (lang) {
    case "python":
      return `client.track("${event}", { ${objKey} })`;
    case "ruby":
      return `client.track("${event}", { ${objKey} })`;
    case "go":
      return `client.Track(ctx, "${event}", map[string]any{ ${objKey} })`;
    case "php":
      return `$client->track("${event}", [ ${objKey} ]);`;
    case "java":
      return `client.track("${event}", Map.of(${objKey}));`;
    case "kotlin":
      return `client.track("${event}", mapOf(${objKey}))`;
    case "swift":
      return `client.track("${event}", [${objKey}])`;
    case "javascript":
    case "typescript":
    case "node":
    default:
      return `flags.track("${event}", { ${bareKey} });`;
  }
}

/** Human label for the resolved language, for the prose line. */
function langLabel(lang: string): string {
  const map: Record<string, string> = {
    typescript: "TypeScript",
    javascript: "JavaScript",
    node: "Node",
    python: "Python",
    ruby: "Ruby",
    go: "Go",
    php: "PHP",
    java: "Java",
    kotlin: "Kotlin",
    swift: "Swift",
  };
  return map[lang] ?? "your app's";
}

/**
 * Extra `content` block appended to a successful event-create response. Reads
 * the bound language from `.shipeasy` and hands back the follow-through: an
 * event emits nothing until it's instrumented, so wire the tracking call in now.
 */
export function wireInBlock(
  eventName: string,
  properties: EventProperty[] | undefined,
  dir: string,
): { type: "text"; text: string } {
  let lang = "";
  try {
    const cfg = readProjectConfigSync(dir);
    lang = (cfg.language || cfg.sdk || "").toString().toLowerCase();
  } catch {
    // No/unreadable .shipeasy — fall through to the generic (JS) example.
  }
  const snippet = trackSnippet(lang, eventName, properties);
  const known = lang && langLabel(lang) !== "your app's";
  const where = known ? `${langLabel(lang)} code` : "your app's code";
  return {
    type: "text",
    text: [
      `✅ Event "${eventName}" created — but it will emit NO data until you instrument it.`,
      `A metric over an un-fired event reads zero, so creating the event is only half the job.`,
      ``,
      `Now wire it in: add the tracking call at the point in ${where} where this action`,
      `actually happens (one edit), then build/type-check:`,
      ``,
      "```",
      snippet,
      "```",
      ``,
      known
        ? `Use the exact, version-correct form from the shipeasy-metrics skill ({{SDK_SNIPPET:metrics/track}}) — the example above is indicative.`
        : `No language is recorded in .shipeasy, so the example above is generic JS — use the exact form for your SDK from the shipeasy-metrics skill ({{SDK_SNIPPET:metrics/track}}).`,
      `Make sure every property your metric filters, groups (\`by (...)\`), or values on is present in the payload.`,
    ].join("\n"),
  };
}
