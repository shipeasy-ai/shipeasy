import { Command } from "commander";
import { getApiClient, ApiError } from "../api/client";
import { printJson } from "../util/output";
import { withExamples, withDetails } from "../util/examples";

/**
 * `shipeasy install <module>` — the platform installer.
 *
 * Each install target turns on a coherent group of project modules in one
 * call, then verifies and prints a hand-off. This is the pure-CLI core that
 * the `flags:install` / `i18n:install` / `ops:install` slash commands used to
 * carry inline (via the now-removed `shipeasy modules enable …`). Module
 * toggling lives at `PATCH /api/admin/projects/:id` — there is no `modules`
 * command; this is the supported programmatic path.
 *
 * The slash commands keep only the parts a binary can't own:
 *   - flags / i18n  → pure CLI; the skill just calls `shipeasy install …`.
 *   - ops           → hybrid; the CLI enables the module, the skill wires
 *                     see() + the devtools overlay per the language docs.
 */

// Project shape returned by GET/PATCH /api/admin/projects/:id (getProject).
interface ProjectModules {
  id: string;
  moduleTranslations?: boolean | number;
  moduleConfigs?: boolean | number;
  moduleGates?: boolean | number;
  moduleExperiments?: boolean | number;
  moduleFeedback?: boolean | number;
  moduleEvents?: boolean | number;
}

// The module flags each install target turns on, in PATCH-body form.
const TARGETS = {
  flags: {
    label: "flags platform",
    blurb: "feature gates, dynamic configs, kill switches, A/B experiments, event metrics",
    patch: {
      moduleGates: true,
      moduleConfigs: true,
      moduleEvents: true,
      moduleExperiments: true,
    } as Record<string, boolean>,
    // Read paths the install verifies are reachable (never 403).
    verify: [
      "/api/admin/gates",
      "/api/admin/configs",
      "/api/admin/killswitches",
      "/api/admin/experiments",
      "/api/admin/metrics",
    ],
  },
  i18n: {
    label: "translations",
    blurb: "the i18n string manager (profiles, keys, machine translation)",
    patch: { moduleTranslations: true } as Record<string, boolean>,
    verify: ["/api/admin/i18n/profiles"],
  },
  ops: {
    label: "ops module",
    blurb: "in-app feedback (bugs + feature requests), production-error tickets, alerts",
    patch: { moduleFeedback: true, moduleEvents: true } as Record<string, boolean>,
    verify: ["/api/admin/ops?type=bug", "/api/admin/errors"],
  },
} as const;

type TargetName = keyof typeof TARGETS;

function isTruthy(v: boolean | number | undefined): boolean {
  return Boolean(v);
}

function enabledList(p: ProjectModules): string[] {
  const mods: [string, boolean | number | undefined][] = [
    ["gates", p.moduleGates],
    ["configs", p.moduleConfigs],
    ["events", p.moduleEvents],
    ["experiments", p.moduleExperiments],
    ["translations", p.moduleTranslations],
    ["feedback", p.moduleFeedback],
  ];
  return mods.filter(([, v]) => isTruthy(v)).map(([k]) => k);
}

export function installCommand(parent: Command): Command {
  const install = parent
    .command("install <module>")
    .description("Enable a platform module group (flags | i18n | ops) and verify it")
    .option("--profile <name>", "i18n only: primary profile to ensure exists", "en:prod")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(
      async (
        moduleArg: string,
        opts: { profile: string; json?: boolean; project?: string },
      ) => {
        const target = moduleArg as TargetName;
        if (!(target in TARGETS)) {
          console.error(
            `Unknown module '${moduleArg}'. Valid: ${Object.keys(TARGETS).join(", ")}.`,
          );
          process.exit(1);
        }
        const spec = TARGETS[target];

        try {
          const client = getApiClient(opts.project, { requireBinding: true });

          // 1. Enable the module group. PATCH returns the updated project, so
          //    we read the enabled set straight back from the response.
          const project = await client.request<ProjectModules>(
            "PATCH",
            `/api/admin/projects/${client.projectId}`,
            spec.patch,
          );

          // 2. i18n: ensure the primary profile exists (the server does NOT
          //    auto-create one). en:prod matches the default loader + SSR fetch.
          let profileCreated = false;
          if (target === "i18n") {
            const profiles = await client.request<Array<{ id: string; name: string }>>(
              "GET",
              "/api/admin/i18n/profiles",
            );
            if (!profiles.some((p) => p.name === opts.profile)) {
              await client.request("POST", "/api/admin/i18n/profiles", {
                name: opts.profile,
                locales: ["en"],
                default_locale: "en",
              });
              profileCreated = true;
            }
          }

          // 3. Verify each read path is reachable (never 403). A 403 here means
          //    the module flag didn't take — surface it rather than claim success.
          const verify: Array<{ path: string; ok: boolean; status: number | null }> = [];
          for (const path of spec.verify) {
            try {
              await client.request("GET", path);
              verify.push({ path, ok: true, status: 200 });
            } catch (e) {
              const status = e instanceof ApiError ? e.status : null;
              verify.push({ path, ok: status !== 403, status });
            }
          }
          const blocked = verify.filter((v) => v.status === 403);

          const enabled = enabledList(project);

          if (opts.json) {
            return printJson({
              module: target,
              enabled_modules: enabled,
              profile_created: profileCreated,
              verify,
              ok: blocked.length === 0,
            });
          }

          console.log(`✅ ${spec.label} install complete`);
          console.log(`   ${spec.blurb}`);
          console.log(`   Modules enabled: ${enabled.join(", ") || "(none)"}`);
          if (target === "i18n") {
            console.log(
              profileCreated
                ? `   Profile:         ${opts.profile} (created)`
                : `   Profile:         ${opts.profile} (already existed)`,
            );
          }
          if (blocked.length > 0) {
            console.error(
              `\n⚠ ${blocked.length} read path${blocked.length === 1 ? "" : "s"} returned 403 ` +
                `— the module may not have enabled:\n` +
                blocked.map((b) => `   • ${b.path}`).join("\n"),
            );
            process.exit(1);
          }

          // Per-target next steps.
          if (target === "flags") {
            console.log(
              "\nNext — create resources (CLI or the shipeasy MCP server):\n" +
                "   shipeasy release flags create   <name> --rollout <n>\n" +
                "   shipeasy release configs create <name>\n" +
                "   shipeasy release ks create      <folder.name>\n" +
                "   /shipeasy:experiments:create <name>   — design + draft an A/B test\n" +
                "   /shipeasy:metrics:create <name>       — analyze + instrument a metric",
            );
          } else if (target === "i18n") {
            console.log(
              "\nNext:\n" +
                "   shipeasy i18n extract            — wrap hardcoded copy + push keys\n" +
                "   shipeasy i18n install-loader     — only if the app doesn't render the\n" +
                "                                      default bootstrap (Pages/Vite/plain HTML)",
            );
          } else if (target === "ops") {
            console.log(
              "\nNext (these need codebase work — run the slash command):\n" +
                "   /shipeasy:ops:install   — wire the devtools overlay + see() error\n" +
                "                            reporting per your language's docs\n" +
                "   shipeasy ops bug list   — confirm the queue is reachable",
            );
          }
        } catch (e) {
          if (e instanceof ApiError) console.error(`Error (${e.status}): ${e.message}`);
          else console.error(String(e));
          process.exit(1);
        }
      },
    );

  withDetails(
    install,
    "Turns on a coherent group of project modules in one call, then verifies " +
      "the admin read paths are reachable and prints next steps. Module groups:\n\n" +
      "  • flags — gates + configs + events + experiments (kill switches ride the\n" +
      "    same KV blob; no separate flag).\n" +
      "  • i18n  — translations; also ensures the primary profile (--profile,\n" +
      "    default en:prod) exists, since the server does not auto-create one.\n" +
      "  • ops   — feedback + events (the queue + production-error tickets). The\n" +
      "    code wiring (devtools overlay, see() reporting) is language-specific\n" +
      "    and stays in `/shipeasy:ops:install`.\n\n" +
      "Requires an admin session (`shipeasy login`) and a bound project; an `ops` " +
      "key cannot toggle modules.",
  );

  withExamples(install, [
    { note: "Enable the whole flags + experimentation platform", run: "shipeasy install flags" },
    { note: "Enable translations + ensure en:prod exists", run: "shipeasy install i18n" },
    { note: "Use a different primary profile", run: "shipeasy install i18n --profile en:staging" },
    { note: "Enable the feedback / ops queue", run: "shipeasy install ops" },
  ]);

  return install;
}
