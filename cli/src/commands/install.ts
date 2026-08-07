import { Command } from "commander";
import { getApiClient, ApiError, printApiError } from "../api/client";
import { printJson } from "../util/output";
import { withExamples, withDetails } from "../util/examples";
import { getPlatformModuleGates } from "../util/platform-gates";
import { getBoundProjectId, getBoundSdk } from "../util/project-config";
import { detectAgents } from "../setup/agents";
import { installMarketplaceSkills } from "../setup/sdk-docs";
import { skillsCliAgentsFor, skillsForFeatures } from "../setup/skills-registry";
import { resolveScope } from "./upgrade";

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

export const MODULE_GROUPS = Object.keys(TARGETS) as TargetName[];

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

export interface EnableResult {
  module: TargetName;
  label: string;
  enabled_modules: string[];
  profile_created: boolean;
  verify: Array<{ path: string; ok: boolean; status: number | null }>;
  ok: boolean;
}

/**
 * The pure enable-and-verify core, shared by `shipeasy install <module>` and
 * `shipeasy setup`'s feature-install step: PATCH the module flags on, ensure
 * the i18n primary profile exists, then confirm each read path is reachable
 * (a 403 means the flag didn't take).
 */
export async function enableModuleGroup(
  target: TargetName,
  opts: { profile?: string; project?: string } = {},
): Promise<EnableResult> {
  const spec = TARGETS[target];
  const client = getApiClient(opts.project, { requireBinding: true });

  const project = await client.request<ProjectModules>(
    "PATCH",
    `/api/admin/projects/${client.projectId}`,
    spec.patch,
  );

  let profileCreated = false;
  if (target === "i18n") {
    const profile = opts.profile ?? "en:prod";
    const profiles = await client.request<Array<{ id: string; name: string }>>(
      "GET",
      "/api/admin/i18n/profiles",
    );
    if (!profiles.some((p) => p.name === profile)) {
      await client.request("POST", "/api/admin/i18n/profiles", {
        name: profile,
        locales: ["en"],
        default_locale: "en",
      });
      profileCreated = true;
    }
  }

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

  return {
    module: target,
    label: spec.label,
    enabled_modules: enabledList(project),
    profile_created: profileCreated,
    verify,
    ok: !verify.some((v) => v.status === 403),
  };
}

/**
 * Install the module group's how-to skills into every wired coding agent — the
 * half of an install that lives on disk rather than on the server. Without this
 * `shipeasy install ops` enabled the module and then told the user to use the
 * `shipeasy-ops` / `shipeasy-see` skills it had never placed. Claude at user
 * scope is skipped: it gets the same skills from the native plugin.
 *
 * Best-effort — no agents, no network, or a `skills` CLI that can't run prints
 * a line and leaves the (already successful) module enable alone.
 */
async function installModuleSkills(target: TargetName): Promise<void> {
  const cwd = process.cwd();
  const names = skillsForFeatures([target]);
  if (!names.length) return;
  const scope = resolveScope({}, cwd);
  const agents = detectAgents(cwd)
    .filter((a) => a.detected)
    .map((a) => a.id);
  const cliAgents = skillsCliAgentsFor(agents, scope);
  if (!cliAgents.length) {
    console.log(
      agents.includes("claude")
        ? "\nSkills:  come from the Claude plugin — nothing to add"
        : `\nSkills:  no coding agent detected — install later with \`shipeasy upgrade skills\``,
    );
    return;
  }
  const batch = await installMarketplaceSkills(names, getBoundSdk(cwd) ?? "typescript", {
    agents: cliAgents,
    global: scope === "user",
  });
  console.log(`\nSkills → ${cliAgents.join(", ")} (${scope} scope):`);
  for (const s of batch.skills) console.log(`   • ${s.name}`);
  for (const name of batch.missing) console.log(`   ✗ ${name}: could not fetch skill`);
  if (batch.skills.length) {
    console.log(`   ${batch.result.action === "failed" ? "✗" : "✓"} ${batch.result.detail}`);
  }
}

export function installCommand(parent: Command): Command {
  const install = parent
    .command("install <module>")
    .description("Enable a platform module group (flags | i18n | ops) and verify it")
    .option("--profile <name>", "i18n only: primary profile to ensure exists", "en:prod")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .option("--no-skills", "Enable the module only — don't install its how-to skills")
    .action(
      async (
        moduleArg: string,
        opts: { profile: string; json?: boolean; project?: string; skills?: boolean },
      ) => {
        const target = moduleArg as TargetName;
        if (!(target in TARGETS)) {
          console.error(
            `Unknown module '${moduleArg}'. Valid: ${Object.keys(TARGETS).join(", ")}.`,
          );
          process.exit(1);
        }
        const spec = TARGETS[target];

        // Translations is held behind the platform's `translation_module`
        // rollout gate, evaluated through @shipeasy/sdk with the CLI's platform
        // client key and this project as `project_id`. Not rolled out — or
        // unreachable — ⇒ refuse rather than half-enable a module whose
        // dashboard surfaces are still hidden.
        const boundProject = opts.project ?? getBoundProjectId(process.cwd()) ?? undefined;
        if (target === "i18n" && !(await getPlatformModuleGates(boundProject)).translations) {
          console.error(
            "The translations module isn't available yet — it's still rolling out.\n" +
              "Nothing was changed. Try again once it's live, or contact contact@shipeasy.ai.",
          );
          process.exit(1);
        }

        try {
          const result = await enableModuleGroup(target, {
            profile: opts.profile,
            project: opts.project,
          });
          const blocked = result.verify.filter((v) => v.status === 403);

          if (opts.json) {
            // No skill install on this path: the `skills` CLI writes to stdout
            // (inherited stdio), which would wreck the JSON a caller parses.
            // Name the skills instead so the caller can run the install itself.
            return printJson({
              module: result.module,
              skills: skillsForFeatures([target]),
              skills_installed: false,
              enabled_modules: result.enabled_modules,
              profile_created: result.profile_created,
              verify: result.verify,
              ok: result.ok,
            });
          }

          console.log(`✅ ${spec.label} install complete`);
          console.log(`   ${spec.blurb}`);
          console.log(`   Modules enabled: ${result.enabled_modules.join(", ") || "(none)"}`);
          if (target === "i18n") {
            console.log(
              result.profile_created
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

          // The module's how-to skills — the on-disk half of the install, so the
          // "next steps" below point at skills the agent actually has.
          if (opts.skills !== false) await installModuleSkills(target);

          // Per-target next steps.
          if (target === "flags") {
            console.log(
              "\nNext — create resources (CLI or the shipeasy MCP server):\n" +
                "   shipeasy release flags create   <name> --rollout <n>\n" +
                "   shipeasy release configs create <name>\n" +
                "   shipeasy release ks create      <folder.name>\n" +
                "   the shipeasy-experiments skill   — design + draft an A/B test\n" +
                "   the shipeasy-metrics skill       — analyze + instrument a metric",
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
              "\nNext (these need codebase work):\n" +
                "   the shipeasy-ops skill    — wire the devtools overlay + see() error\n" +
                "                               reporting per your language's docs\n" +
                "   the shipeasy-see skill    — error-reporting grammar (installed with ops)\n" +
                "   shipeasy ops bug list     — confirm the queue is reachable",
            );
          }
        } catch (e) {
          printApiError(e);
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
      "    and lives in the `shipeasy-ops` + `shipeasy-see` skills.\n\n" +
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
