import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { scanFiles } from "@shipeasy/mcp/i18n/scan";
import { getApiClient, ApiError } from "../api/client";
import { printJson, printTable } from "../util/output";
import { getI18nClientKey, saveI18nClientKey } from "../util/project-config";

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
  // Insert after the last existing tag inside <head>
  src = src.replace(/(<head[^>]*>)([\s\S]*?)(<\/head>)/, (_, open, inner, close) => {
    return `${open}${inner}        ${tag}\n      ${close}`;
  });
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
          const client = getApiClient(opts.project);

          // Get or create a client SDK key — reuse from .shipeasy if present
          const cwd = process.cwd();
          let dataKey = opts.dataKey ?? getI18nClientKey(cwd);
          if (!dataKey) {
            const created = await client.request<CreatedKey>("POST", "/api/admin/keys", {
              type: "client",
            });
            dataKey = created.key;
            saveI18nClientKey(cwd, dataKey);
            console.log(`Created client SDK key and saved to .shipeasy`);
          }

          const loaderUrl = "https://cdn.shipeasy.ai/sdk/i18n/loader.js";
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

          const client = getApiClient(opts.project);
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

          const result = await client.request<{
            upserted?: number;
            chunk?: string;
            pushed_count?: number;
            skipped_count?: number;
            failed_keys?: string[];
          }>("POST", "/api/admin/i18n/keys", {
            profile_id: profile.id,
            chunk: opts.chunk,
            keys,
          });
          if (opts.json) return printJson(result);
          const count = result.upserted ?? result.pushed_count ?? keys.length;
          const failed = result.failed_keys ?? [];
          console.log(
            `Pushed ${count} key${count === 1 ? "" : "s"}` +
              (failed.length > 0 ? `, failed ${failed.length}: ${failed.join(", ")}` : ""),
          );
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
}
