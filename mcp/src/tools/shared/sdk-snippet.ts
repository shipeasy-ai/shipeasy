import { ok } from "../../util/api-client.js";

interface SnippetInput {
  domain: string;
  language: string;
  type: string;
  name: string;
  framework?: string;
  params?: object;
  success_event?: string;
  success_value?: boolean;
}

export async function handleGetSdkSnippet(input: SnippetInput) {
  const { domain, language, type, name, framework } = input;

  // ── i18n snippets ──────────────────────────────────────────────────────────

  if (domain === "i18n" && type === "loader_script") {
    const snippet = `<!-- Place inside <head> of your root layout/HTML file -->
<script
  src="https://api.shipeasy.ai/sdk/i18n/loader.js"
  data-key="YOUR_SHIPEASY_CLIENT_KEY"
  data-profile="${name || "YOUR_PROFILE_NAME"}"
  defer
></script>`;
    return ok({
      snippet,
      language: "html",
      notes:
        "Replace YOUR_SHIPEASY_CLIENT_KEY with your public client key. " +
        "Run `shipeasy i18n install-loader --profile <name>` to inject automatically.",
    });
  }

  if (
    domain === "i18n" &&
    type === "provider_setup" &&
    (language === "typescript" || language === "javascript") &&
    framework === "nextjs"
  ) {
    const snippet = `// src/app/layout.tsx
import { shipeasy } from "@shipeasy/sdk/server";

await shipeasy({ apiKey: process.env.NEXT_PUBLIC_SHIPEASY_CLIENT_KEY ?? "" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* ShipEasy i18n loader — inject your client key + profile */}
        <script
          src="https://api.shipeasy.ai/sdk/i18n/loader.js"
          data-key={process.env.NEXT_PUBLIC_SHIPEASY_CLIENT_KEY}
          data-profile="${name || "en:prod"}"
          defer
        />
      </head>
      <body>{children}</body>
    </html>
  );
}`;
    return ok({
      snippet,
      language: "typescript",
      notes:
        "Set NEXT_PUBLIC_SHIPEASY_CLIENT_KEY in .env.local. " +
        "Install @shipeasy/sdk: `npm install @shipeasy/sdk`. " +
        "Call shipeasy() once in the root layout — it is idempotent across renders.",
    });
  }

  if (
    domain === "i18n" &&
    type === "label_render" &&
    (language === "typescript" || language === "javascript")
  ) {
    const snippet = `import { t } from "@shipeasy/sdk/client";

export function MyComponent() {
  return (
    <div>
      <h1>{t("${name || "my_key"}")}</h1>
      <p>{t("another_key", "Default text")}</p>
    </div>
  );
}`;
    return ok({
      snippet,
      language: "typescript",
      notes:
        "t() returns the translated string for the given key. Keys are loaded " +
        "from your ShipEasy profile at runtime by the loader script. " +
        "If you need re-renders on locale change, wrap in your framework's " +
        "reactivity primitive (React useEffect + shipeasy.subscribe, Vue watchEffect, etc).",
    });
  }

  // ── experiment snippets ────────────────────────────────────────────────────

  if (
    domain === "experiment" &&
    type === "gate" &&
    (language === "typescript" || language === "javascript")
  ) {
    const snippet = `import { Shipeasy } from "shipeasy/server";

const client = new Shipeasy({
  serverKey: process.env.SHIPEASY_SERVER_KEY!,
});

// Inside your server handler / server component:
const enabled = await client.getGate("${name || "my_gate"}", {
  userId: "user-123",
  // Optional attributes for targeting rules:
  // email: "user@example.com",
  // country: "US",
});

if (enabled) {
  // Show feature to this user
}`;
    return ok({
      snippet,
      language: "typescript",
      notes:
        "Set SHIPEASY_SERVER_KEY in your environment. " +
        "Install: `npm install shipeasy`. " +
        "getGate() is safe to call on every request — results are cached in KV.",
    });
  }

  if (
    domain === "experiment" &&
    type === "experiment" &&
    (language === "typescript" || language === "javascript")
  ) {
    const snippet = `import { Shipeasy } from "shipeasy/server";

const client = new Shipeasy({
  serverKey: process.env.SHIPEASY_SERVER_KEY!,
});

// Inside your server handler / server component:
const assignment = await client.getExperiment("${name || "my_experiment"}", {
  userId: "user-123",
});

// assignment.group is "control" | "treatment" | null (null = not enrolled)
if (assignment?.group === "treatment") {
  // Show treatment variant
} else {
  // Show control variant
}

// Track conversion events
await client.track({
  userId: "user-123",
  event: "${input.success_event || "conversion"}",
});`;
    return ok({
      snippet,
      language: "typescript",
      notes:
        "Set SHIPEASY_SERVER_KEY in your environment. " +
        "Install: `npm install shipeasy`. " +
        "Tracking calls are fire-and-forget — they do not block your response.",
    });
  }

  if (
    domain === "experiment" &&
    type === "config" &&
    (language === "typescript" || language === "javascript")
  ) {
    const snippet = `import { Shipeasy } from "shipeasy/server";

const client = new Shipeasy({
  serverKey: process.env.SHIPEASY_SERVER_KEY!,
});

// Fetch a static config value
const value = await client.getConfig("${name || "my_config"}");
// value is the JSON value you set when creating the config`;
    return ok({
      snippet,
      language: "typescript",
      notes: "Configs are static values served from the edge — no user context needed.",
    });
  }

  // ── fallback ───────────────────────────────────────────────────────────────

  return ok({
    snippet: `// No pre-built snippet available for domain="${domain}", type="${type}", language="${language}", framework="${framework ?? "none"}".
// See the ShipEasy docs at https://docs.shipeasy.ai for the full integration guide.`,
    language: language ?? "text",
    notes:
      `Available combinations:\n` +
      `  i18n / loader_script (html)\n` +
      `  i18n / provider_setup / typescript / nextjs\n` +
      `  i18n / label_render / typescript\n` +
      `  experiment / gate / typescript\n` +
      `  experiment / experiment / typescript\n` +
      `  experiment / config / typescript`,
  });
}
