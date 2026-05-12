import { Command } from "commander";
import { getApiClient, ApiError } from "../api/client";

const MODULE_FIELD = {
  translations: "moduleTranslations",
  configs: "moduleConfigs",
  gates: "moduleGates",
  experiments: "moduleExperiments",
  feedback: "moduleFeedback",
} as const;

type ModuleKey = keyof typeof MODULE_FIELD;
const MODULE_NAMES = Object.keys(MODULE_FIELD) as ModuleKey[];

interface ProjectMeta {
  id: string;
  name: string;
  moduleTranslations: boolean | number;
  moduleConfigs: boolean | number;
  moduleGates: boolean | number;
  moduleExperiments: boolean | number;
  moduleFeedback: boolean | number;
}

function asModuleKey(name: string): ModuleKey {
  if (!(name in MODULE_FIELD)) {
    console.error(`Unknown module "${name}". Valid: ${MODULE_NAMES.join(", ")}`);
    process.exit(1);
  }
  return name as ModuleKey;
}

async function patchModule(name: ModuleKey, value: boolean): Promise<ProjectMeta> {
  const client = getApiClient(undefined, { requireBinding: true });
  const field = MODULE_FIELD[name];
  return client.request<ProjectMeta>("PATCH", `/api/admin/projects/${client.projectId}`, {
    [field]: value,
  });
}

export function modulesCommand(parent: Command): void {
  const modules = parent
    .command("modules")
    .description("Enable, disable, or inspect per-project feature modules");

  modules
    .command("list")
    .description("Show which modules are enabled on the bound project")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const client = getApiClient(undefined, { requireBinding: true });
        const project = await client.request<ProjectMeta>(
          "GET",
          `/api/admin/projects/${client.projectId}`,
        );
        const rows = MODULE_NAMES.map((k) => ({
          module: k,
          enabled: Boolean(project[MODULE_FIELD[k]]),
        }));
        if (opts.json) {
          process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
          return;
        }
        for (const r of rows) {
          console.log(`  ${r.enabled ? "✓" : "·"} ${r.module}`);
        }
      } catch (e) {
        if (e instanceof ApiError) console.error(`API error (${e.status}): ${e.message}`);
        else console.error(String(e));
        process.exit(1);
      }
    });

  modules
    .command("enable <name>")
    .description(`Enable a module (${MODULE_NAMES.join(" | ")})`)
    .action(async (name: string) => {
      const key = asModuleKey(name);
      try {
        await patchModule(key, true);
        console.log(`Enabled module: ${key}`);
      } catch (e) {
        if (e instanceof ApiError) console.error(`API error (${e.status}): ${e.message}`);
        else console.error(String(e));
        process.exit(1);
      }
    });

  modules
    .command("disable <name>")
    .description(`Disable a module (${MODULE_NAMES.join(" | ")})`)
    .action(async (name: string) => {
      const key = asModuleKey(name);
      try {
        await patchModule(key, false);
        console.log(`Disabled module: ${key}`);
      } catch (e) {
        if (e instanceof ApiError) console.error(`API error (${e.status}): ${e.message}`);
        else console.error(String(e));
        process.exit(1);
      }
    });
}
