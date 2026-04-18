import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { getApiClient, ApiError } from "../api/client";
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
  if (!deps["next"]) return existsSync(join(cwd, "index.html")) ? "react-vite" : "unknown";
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

          const loaderUrl = `${client.baseUrl.replace("shipeasy.ai", "api.shipeasy.ai")}/sdk/i18n/loader.js`;
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
              const htmlPath = join(cwd, "index.html");
              if (!existsSync(htmlPath)) {
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
}
