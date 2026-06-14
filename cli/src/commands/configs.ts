import { Command } from "commander";
import { ApiError, getAdminClient } from "../api/client";
import { printTable, printJson } from "../util/output";
import { withExamples } from "../util/examples";

export function configsCommand(parent: Command): void {
  const configs = parent.command("configs").description("Manage remote-config values");

  const listConfigs = configs
    .command("list")
    .description("List all configs")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        const api = getAdminClient(opts.project);
        const items = await api.configs.listAll();
        if (opts.json) return printJson(items);
        if (!items.length) return void console.log("No configs found.");
        printTable(
          ["Name", "Schema", "Updated"],
          items.map((c) => [c.name, JSON.stringify(c.schema), c.updatedAt]),
        );
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(listConfigs, [{ run: "shipeasy configs list" }]);

  const getConfig = configs
    .command("get <name>")
    .description("Show a config by name")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project);
        const c = await api.configs.resolve(name);
        const detail = await api.configs.get(c.id);
        if (opts.json) return printJson(detail);
        console.log(JSON.stringify(detail, null, 2));
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(getConfig, [{ run: "shipeasy configs get pricing" }]);

  const createConfig = configs
    .command("create <name>")
    .description("Create a new config. Configs are JSON objects validated against a JSON Schema.")
    .option("--schema <json>", "JSON Schema (object only). Defaults to a permissive object schema.")
    .option("--value <json>", "Initial value as JSON object. Defaults to {}.")
    .option("--description <text>", "Human-readable description")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const schema = opts.schema
          ? JSON.parse(opts.schema)
          : { type: "object", properties: {}, additionalProperties: true };
        const value = opts.value ? JSON.parse(opts.value) : {};
        const data = await api.configs.create({
          name,
          schema,
          value,
          ...(opts.description ? { description: opts.description } : {}),
        });
        if (opts.json) return printJson(data);
        console.log(`Created config: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(createConfig, [
    { note: "Permissive schema, empty value", run: "shipeasy configs create pricing" },
    {
      note: "Seed an initial value",
      run: 'shipeasy configs create pricing --value \'{"free_trial_days":14}\'',
    },
  ]);

  const updateConfig = configs
    .command("update <name>")
    .description("Update a config's value (legacy flat update; use draft/publish for envs)")
    .requiredOption("--value <json>", "New value (JSON-encoded)")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const c = await api.configs.resolve(name);
        const data = await api.configs.update(c.id, { value: JSON.parse(opts.value) });
        if (opts.json) return printJson(data);
        console.log(`Updated config: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(updateConfig, [
    {
      note: "Overwrite the value (all envs)",
      run: 'shipeasy configs update pricing --value \'{"free_trial_days":30}\'',
    },
  ]);

  const draftConfig = configs
    .command("draft <name>")
    .description("Save a draft value for the given env")
    .requiredOption("--env <env>", "Target env (e.g. prod, staging, dev)")
    .requiredOption("--value <json>", "Draft value (JSON-encoded)")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const c = await api.configs.resolve(name);
        await api.configs.saveDraft(c.id, { env: opts.env, value: JSON.parse(opts.value) });
        console.log(`Saved draft for ${name} (${opts.env})`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(draftConfig, [
    {
      note: "Stage a prod value to publish later",
      run: 'shipeasy configs draft pricing --env prod --value \'{"free_trial_days":30}\'',
    },
  ]);

  const publishConfig = configs
    .command("publish <name>")
    .description("Publish the saved draft for the given env")
    .requiredOption("--env <env>", "Target env to publish")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const c = await api.configs.resolve(name);
        await api.configs.publish(c.id, { env: opts.env });
        console.log(`Published ${name} → ${opts.env}`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(publishConfig, [
    { note: "Promote the staged draft to prod", run: "shipeasy configs publish pricing --env prod" },
  ]);

  const activityConfig = configs
    .command("activity <name>")
    .description("Show recent activity for a config")
    .option("--limit <n>", "How many entries to show", "20")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project);
        const c = await api.configs.resolve(name);
        const entries = await api.configs.activity(c.id, Number(opts.limit));
        if (opts.json) return printJson(entries);
        if (!entries.length) return void console.log("No activity.");
        printTable(
          ["When", "Action", "Env", "Actor"],
          entries.map((e) => [e.createdAt, e.action, e.env ?? "—", e.actor ?? "—"]),
        );
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(activityConfig, [
    { run: "shipeasy configs activity pricing" },
    { note: "Last 5 entries", run: "shipeasy configs activity pricing --limit 5" },
  ]);

  const deleteConfig = configs
    .command("delete <name>")
    .description("Delete a config by name")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const c = await api.configs.resolve(name);
        await api.configs.delete(c.id);
        console.log(`Deleted: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(deleteConfig, [{ run: "shipeasy configs delete pricing" }]);
}

function handleError(e: unknown): void {
  if (e instanceof ApiError) {
    console.error(`Error (${e.status}): ${e.message}`);
  } else {
    console.error(String(e));
  }
  process.exit(1);
}
