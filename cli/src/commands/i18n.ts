import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { scanFiles } from "@shipeasy/mcp/i18n/scan";
import { getApiClient, ApiError } from "../api/client";
import { printJson, printTable } from "../util/output";
import { getI18nClientKey, saveI18nClientKey } from "../util/project-config";
import { API_BASE_URL } from "../auth/storage";

// ── env helpers ───────────────────────────────────────────────────────────────

const ENV_FILES = [".env.local", ".env.development.local", ".env", ".env.development"];
const CLIENT_KEY_VARS = [
  "NEXT_PUBLIC_SHIPEASY_CLIENT_KEY",
  "VITE_SHIPEASY_CLIENT_KEY",
  "PUBLIC_SHIPEASY_CLIENT_KEY",
  "SHIPEASY_CLIENT_KEY",
];

function readClientKeyFromEnv(cwd: string): string | undefined {
  for (const file of ENV_FILES) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n#]+?)"?\s*$/.exec(line);
      if (!m) continue;
      const [, name, value] = m;
      if (name && value && CLIENT_KEY_VARS.includes(name) && value.startsWith("sdk_client_")) {
        return value;
      }
    }
  }
  return undefined;
}

// ── framework detection ───────────────────────────────────────────────────────

type Framework = "nextjs-app" | "nextjs-pages" | "react-vite" | "unknown";

function detectFramework(cwd: string): Framework {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return "unknown";
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps["next"]) {
    const htmlCandidates = ["index.html", "client/index.html", "public/index.html"];
    return htmlCandidates.some((f) => existsSync(join(cwd, f))) ? "react-vite" : "unknown";
  }
  // App Router: src/app/layout.tsx or app/layout.tsx
  if (existsSync(join(cwd, "src/app/layout.tsx")) || existsSync(join(cwd, "app/layout.tsx"))) {
    return "nextjs-app";
  }
  return "nextjs-pages";
}

// ── per-framework inject ──────────────────────────────────────────────────────

function injectNextjsApp(layoutPath: string, tag: string): void {
  let src = readFileSync(layoutPath, "utf8");
  if (src.includes("data-key=")) {
    console.log(`Loader script already present in ${layoutPath} — skipping.`);
    return;
  }
  // Insert before </head>, copying its leading whitespace as the tag's indent.
  if (!/<head[\s>]/.test(src) || !/<\/head>/.test(src)) {
    console.log(
      `No <head> element found in ${layoutPath}. Pass --print and paste the tag manually, or add an empty <head /> to your layout.`,
    );
    return;
  }
  src = src.replace(/([ \t]*)<\/head>/, (_, indent) => `${indent}  ${tag}\n${indent}</head>`);
  writeFileSync(layoutPath, src, "utf8");
  console.log(`Injected loader script into ${layoutPath}`);
}

function injectIndexHtml(htmlPath: string, tag: string): void {
  let src = readFileSync(htmlPath, "utf8");
  if (src.includes("data-key=")) {
    console.log(`Loader script already present in ${htmlPath} — skipping.`);
    return;
  }
  src = src.replace("</head>", `  ${tag}\n  </head>`);
  writeFileSync(htmlPath, src, "utf8");
  console.log(`Injected loader script into ${htmlPath}`);
}

// ── command ───────────────────────────────────────────────────────────────────

interface CreatedKey {
  id: string;
  type: string;
  key: string;
  expires_at: string | null;
}

export function i18nCommand(parent: Command): void {
  const i18n = parent.command("i18n").description("String Manager (i18n) tools");

  i18n
    .command("install-loader")
    .description("Inject the ShipEasy i18n loader script into your project")
    .option("--data-key <key>", "Client SDK key (created automatically if omitted)")
    .option("--profile <profile>", "Locale profile name", "default")
    .option("--path <file>", "Override target file path (auto-detected by default)")
    .option("--project <id>", "Project ID override")
    .option("--print", "Print the script tag only, do not write files")
    .action(
      async (opts: {
        dataKey?: string;
        profile: string;
        path?: string;
        project?: string;
        print?: boolean;
      }) => {
        try {
          const client = getApiClient(opts.project, { requireBinding: true });

          // Resolve the client SDK key — preference order:
          //   1. --data-key flag
          //   2. .shipeasy file (cached from a prior run)
          //   3. NEXT_PUBLIC_SHIPEASY_CLIENT_KEY / VITE_SHIPEASY_CLIENT_KEY /
          //      PUBLIC_SHIPEASY_CLIENT_KEY in the project's .env / .env.local
          //   4. Create a new one (last resort — wastes a key on every run)
          const cwd = process.cwd();
          let dataKey = opts.dataKey ?? getI18nClientKey(cwd);
          if (!dataKey) dataKey = readClientKeyFromEnv(cwd);
          if (!dataKey) {
            const created = await client.request<CreatedKey>("POST", "/api/admin/keys", {
              type: "client",
            });
            dataKey = created.key;
            saveI18nClientKey(cwd, dataKey);
            console.log(`Created client SDK key and saved to .shipeasy`);
          } else if (!opts.dataKey) {
            console.log(`Reusing existing client SDK key (from .env / .shipeasy).`);
          }

          const loaderUrl = `${API_BASE_URL}/sdk/i18n/loader.js`;
          const scriptTag = `<script src="${loaderUrl}" data-key="${dataKey}" data-profile="${opts.profile}" defer></script>`;

          if (opts.print) {
            console.log(scriptTag);
            return;
          }

          const framework = detectFramework(cwd);

          if (opts.path) {
            const target = resolve(opts.path);
            if (!existsSync(target)) {
              console.error(`File not found: ${target}`);
              process.exit(1);
            }
            if (target.endsWith(".html")) {
              injectIndexHtml(target, scriptTag);
            } else {
              injectNextjsApp(target, scriptTag);
            }
            return;
          }

          switch (framework) {
            case "nextjs-app": {
              const candidates = [join(cwd, "src/app/layout.tsx"), join(cwd, "app/layout.tsx")];
              const layoutPath = candidates.find(existsSync);
              if (!layoutPath) {
                console.error("Could not find layout.tsx. Pass --path to specify the file.");
                process.exit(1);
              }
              injectNextjsApp(layoutPath, scriptTag);
              break;
            }
            case "nextjs-pages": {
              const candidates = [
                join(cwd, "src/pages/_document.tsx"),
                join(cwd, "pages/_document.tsx"),
                join(cwd, "src/pages/_document.js"),
                join(cwd, "pages/_document.js"),
              ];
              const docPath = candidates.find(existsSync);
              if (docPath) {
                injectNextjsApp(docPath, scriptTag);
              } else {
                console.log(
                  `No _document file found. Add this tag inside <Head> in pages/_document.tsx:\n\n  ${scriptTag}`,
                );
              }
              break;
            }
            case "react-vite": {
              const htmlCandidates = [
                join(cwd, "index.html"),
                join(cwd, "client/index.html"),
                join(cwd, "public/index.html"),
              ];
              const htmlPath = htmlCandidates.find(existsSync);
              if (!htmlPath) {
                console.error("index.html not found. Pass --path to specify the file.");
                process.exit(1);
              }
              injectIndexHtml(htmlPath, scriptTag);
              break;
            }
            default:
              console.log(
                `Framework not auto-detected. Add this tag inside <head> of your entry HTML:\n\n  ${scriptTag}`,
              );
          }
        } catch (e) {
          if (e instanceof ApiError) {
            console.error(`Error (${e.status}): ${e.message}`);
          } else {
            console.error(String(e));
          }
          process.exit(1);
        }
      },
    );

  // ── i18n scan ──────────────────────────────────────────────────────────────
  i18n
    .command("scan [paths...]")
    .description(
      "Find translatable strings in source files. Reports both already-wrapped " +
        "t('key') calls and unwrapped JSX text / string props that look translatable.",
    )
    .option("--keys-only", "Only report existing t('key') call sites — skip discovery")
    .option("--json", "Output as JSON")
    .action(async (paths: string[], opts: { keysOnly?: boolean; json?: boolean }) => {
      try {
        const targets = paths.length > 0 ? paths.map((p) => resolve(p)) : [process.cwd()];
        const candidates = await scanFiles(targets, { keysOnly: opts.keysOnly });
        if (opts.json) return printJson(candidates);
        if (candidates.length === 0) {
          console.log("No candidates found.");
          return;
        }
        printTable(
          ["Kind", "Key", "Text", "Vars", "File:Line"],
          candidates
            .slice(0, 200)
            .map((c) => [
              c.kind,
              c.suggested_key ?? "—",
              c.text.length > 60 ? c.text.slice(0, 57) + "…" : c.text,
              (c.variables ?? []).join(",") || "—",
              `${c.file.replace(process.cwd() + "/", "")}:${c.line}`,
            ]),
        );
        if (candidates.length > 200) {
          console.log(`\nShowing first 200 of ${candidates.length}. Use --json for the full list.`);
        }
      } catch (e) {
        if (e instanceof ApiError) {
          console.error(`Error (${e.status}): ${e.message}`);
        } else {
          console.error(String(e));
        }
        process.exit(1);
      }
    });

  // ── i18n push ──────────────────────────────────────────────────────────────
  i18n
    .command("push <file>")
    .description(
      "Push key/value pairs from a JSON file to the i18n profile. The file is a flat " +
        '{ "<key>": "<value>" } map. Existing keys are skipped server-side.',
    )
    .requiredOption("--profile <name>", "Profile name (e.g. 'default')")
    .option("--chunk <name>", "Logical grouping for the keys", "default")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(
      async (
        file: string,
        opts: { profile: string; chunk: string; json?: boolean; project?: string },
      ) => {
        try {
          const filePath = resolve(file);
          if (!existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            process.exit(1);
          }
          let parsed: Record<string, string>;
          try {
            parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, string>;
          } catch (err) {
            console.error(`Failed to parse ${filePath}: ${String(err)}`);
            process.exit(1);
          }
          const keys = Object.entries(parsed).map(([key, value]) => ({ key, value }));
          if (keys.length === 0) {
            console.error(`No keys found in ${filePath}.`);
            process.exit(1);
          }

          const client = getApiClient(opts.project, { requireBinding: true });
          const profiles = await client.request<Array<{ id: string; name: string }>>(
            "GET",
            "/api/admin/i18n/profiles",
          );
          const profile = profiles.find((p) => p.name === opts.profile);
          if (!profile) {
            console.error(
              `Profile '${opts.profile}' not found. Existing: ${
                profiles.map((p) => p.name).join(", ") || "(none)"
              }`,
            );
            process.exit(1);
          }

          // Chunk the upload — large key sets (>200 keys / >50KB payload)
          // tend to 500 against admin endpoints. Send in slices of 100 and
          // aggregate counts. Each batch is still a single transaction
          // server-side; if any fails the CLI reports which slice errored.
          const BATCH = 100;
          const slices: (typeof keys)[] = [];
          for (let i = 0; i < keys.length; i += BATCH) slices.push(keys.slice(i, i + BATCH));

          let upserted = 0;
          let pushed_count = 0;
          let skipped_count = 0;
          const failed_keys: string[] = [];
          let lastResult: unknown;

          for (let i = 0; i < slices.length; i++) {
            const batch = slices[i]!;
            try {
              const result = await client.request<{
                upserted?: number;
                chunk?: string;
                pushed_count?: number;
                skipped_count?: number;
                failed_keys?: string[];
              }>("POST", "/api/admin/i18n/keys", {
                profile_id: profile.id,
                chunk: opts.chunk,
                keys: batch,
              });
              lastResult = result;
              upserted += result.upserted ?? 0;
              pushed_count += result.pushed_count ?? 0;
              skipped_count += result.skipped_count ?? 0;
              if (result.failed_keys) failed_keys.push(...result.failed_keys);
            } catch (err) {
              const status = err instanceof ApiError ? err.status : 0;
              const msg = err instanceof Error ? err.message : String(err);
              console.error(
                `\n  Batch ${i + 1}/${slices.length} failed (${status} ${msg}). ` +
                  `Keys ${i * BATCH + 1}–${i * BATCH + batch.length} not pushed.`,
              );
              failed_keys.push(...batch.map((k) => k.key));
              if (slices.length === 1) throw err; // single-batch — bubble up
            }
          }

          if (opts.json)
            return printJson(lastResult ?? { upserted, pushed_count, skipped_count, failed_keys });
          const total = upserted || pushed_count || keys.length - failed_keys.length;
          const summary =
            slices.length > 1
              ? `Pushed ${total}/${keys.length} keys across ${slices.length} batches`
              : `Pushed ${total} key${total === 1 ? "" : "s"}`;
          console.log(
            summary +
              (failed_keys.length > 0
                ? `, ${failed_keys.length} failed${failed_keys.length <= 5 ? `: ${failed_keys.join(", ")}` : ""}`
                : ""),
          );
          if (failed_keys.length > 0) process.exit(1);
        } catch (e) {
          if (e instanceof ApiError) {
            console.error(`Error (${e.status}): ${e.message}`);
          } else {
            console.error(String(e));
          }
          process.exit(1);
        }
      },
    );

  // ── i18n publish ───────────────────────────────────────────────────────────
  i18n
    .command("publish")
    .description("Publish a profile chunk to the CDN (rebuilds KV manifest, purges cache)")
    .requiredOption("--profile <name>", "Profile name (e.g. 'default')")
    .option("--chunk <name>", "Chunk to publish", "default")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts: { profile: string; chunk: string; json?: boolean; project?: string }) => {
      try {
        const client = getApiClient(opts.project, { requireBinding: true });
        const profiles = await client.request<Array<{ id: string; name: string }>>(
          "GET",
          "/api/admin/i18n/profiles",
        );
        const profile = profiles.find((p) => p.name === opts.profile);
        if (!profile) {
          console.error(
            `Profile '${opts.profile}' not found. Existing: ${
              profiles.map((p) => p.name).join(", ") || "(none)"
            }. Create with: shipeasy i18n profiles create ${opts.profile}`,
          );
          process.exit(1);
        }
        const result = await client.request<unknown>(
          "POST",
          `/api/admin/i18n/profiles/${profile.id}/publish`,
          { chunk: opts.chunk },
        );
        if (opts.json) return printJson(result);
        console.log(`Published profile '${opts.profile}' chunk '${opts.chunk}'.`);
      } catch (e) {
        if (e instanceof ApiError) console.error(`Error (${e.status}): ${e.message}`);
        else console.error(String(e));
        process.exit(1);
      }
    });

  // ── i18n validate ──────────────────────────────────────────────────────────
  i18n
    .command("validate [paths...]")
    .description("Check that all t('key', …) references in code exist on the server")
    .option("--profile <name>", "Restrict the check to a single profile")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(
      async (paths: string[], opts: { profile?: string; json?: boolean; project?: string }) => {
        try {
          const client = getApiClient(opts.project);
          const scanPaths = paths.length > 0 ? paths.map((p) => resolve(p)) : [process.cwd()];
          const candidates = await scanFiles(scanPaths, { keysOnly: true });
          const referenced = new Set(
            candidates.flatMap((c) => (c.suggested_key ? [c.suggested_key] : [])),
          );
          if (referenced.size === 0) {
            const result = {
              status: "ok",
              message: "No i18n key references found in code.",
              missing_keys: [] as string[],
            };
            if (opts.json) return printJson(result);
            console.log(result.message);
            return;
          }

          let profileId: string | undefined;
          if (opts.profile) {
            const profiles = await client.request<Array<{ id: string; name: string }>>(
              "GET",
              "/api/admin/i18n/profiles",
            );
            const p = profiles.find((x) => x.name === opts.profile);
            if (!p) {
              console.error(`Profile '${opts.profile}' not found.`);
              process.exit(1);
            }
            profileId = p.id;
          }
          const query = profileId ? `?profile_id=${encodeURIComponent(profileId)}` : "";
          const remote = await client.request<Array<{ key: string }>>(
            "GET",
            `/api/admin/i18n/keys${query}`,
          );
          const remoteKeys = new Set(remote.map((r) => r.key));
          const missing = [...referenced].filter((k) => !remoteKeys.has(k));
          const status = missing.length === 0 ? "ok" : "fail";
          const result = {
            status,
            checked: referenced.size,
            missing_keys: missing,
            message:
              status === "ok"
                ? `All ${referenced.size} referenced keys exist on the server.`
                : `${missing.length} key(s) missing from the server.`,
          };
          if (opts.json) return printJson(result);
          console.log(result.message);
          if (missing.length > 0) {
            for (const k of missing) console.log(`  • ${k}`);
            process.exit(1);
          }
        } catch (e) {
          if (e instanceof ApiError) console.error(`Error (${e.status}): ${e.message}`);
          else console.error(String(e));
          process.exit(1);
        }
      },
    );

  // ── i18n profiles {list,create} ────────────────────────────────────────────
  const profiles = i18n.command("profiles").description("Manage i18n locale profiles");

  profiles
    .command("list")
    .description("List i18n profiles for the current project")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts: { json?: boolean; project?: string }) => {
      try {
        const client = getApiClient(opts.project);
        const rows = await client.request<
          Array<{ id: string; name: string; locales?: string[]; default_locale?: string }>
        >("GET", "/api/admin/i18n/profiles");
        if (opts.json) return printJson(rows);
        if (rows.length === 0) {
          console.log("No profiles found. Create one with: shipeasy i18n profiles create <name>");
          return;
        }
        printTable(
          ["Name", "Default locale", "Locales", "ID"],
          rows.map((r) => [
            r.name,
            r.default_locale ?? "—",
            (r.locales ?? []).join(", ") || "—",
            r.id.slice(0, 8),
          ]),
        );
      } catch (e) {
        if (e instanceof ApiError) console.error(`Error (${e.status}): ${e.message}`);
        else console.error(String(e));
        process.exit(1);
      }
    });

  profiles
    .command("create <name>")
    .description("Create an i18n profile (e.g. 'default', 'en:prod')")
    .option(
      "--locales <locales>",
      "Comma-separated locale list (defaults to 'en')",
      (v: string) =>
        v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ["en"],
    )
    .option("--default-locale <locale>", "Default locale (defaults to first --locales entry)")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(
      async (
        name: string,
        opts: { locales: string[]; defaultLocale?: string; json?: boolean; project?: string },
      ) => {
        try {
          const client = getApiClient(opts.project, { requireBinding: true });
          const created = await client.request<{ id: string; name: string }>(
            "POST",
            "/api/admin/i18n/profiles",
            {
              name,
              locales: opts.locales,
              default_locale: opts.defaultLocale ?? opts.locales[0],
            },
          );
          if (opts.json) return printJson(created);
          console.log(`Created profile '${created.name}' (id ${created.id.slice(0, 8)})`);
        } catch (e) {
          if (e instanceof ApiError) console.error(`Error (${e.status}): ${e.message}`);
          else console.error(String(e));
          process.exit(1);
        }
      },
    );
}
