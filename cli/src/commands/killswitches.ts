import { Command } from "commander";
import { ApiError, getAdminClient } from "../api/client";
import { printJson, printTable } from "../util/output";
import { withExamples, withDetails } from "../util/examples";

const ENVS = ["dev", "staging", "prod"] as const;

export function killswitchesCommand(parent: Command): void {
  const ks = parent.command("killswitch").alias("ks").description("Manage killswitches");

  const listKillswitches = ks
    .command("list")
    .description("List all killswitches")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (opts) => {
      try {
        const api = getAdminClient(opts.project);
        const rows = await api.killswitches.listAll();
        if (opts.json) return printJson(rows);
        if (!rows.length) {
          console.log("No killswitches found.");
          return;
        }
        printTable(
          ["Name", "Default (prod)", "Switches (prod)", "Updated"],
          rows.map((k) => {
            const prod = k.envs.prod ?? k.envs.staging ?? k.envs.dev;
            const switchCount = prod?.switches ? Object.keys(prod.switches).length : 0;
            return [
              k.name,
              prod?.value ? "ON" : "OFF",
              String(switchCount),
              k.updatedAt.slice(0, 19),
            ];
          }),
        );
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(listKillswitches, [{ run: "shipeasy flags killswitch list" }]);

  const createKillswitch = ks
    .command("create <name>")
    .description("Create a killswitch (name must be `folder.name`)")
    .option("--description <desc>", "Description")
    .option("--value <bool>", "Default value (true|false)", "false")
    .option("--switches <json>", "JSON object of { switch_key: bool }; takes precedence over value")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const switches = opts.switches
          ? (JSON.parse(opts.switches) as Record<string, boolean>)
          : undefined;
        const data = await api.killswitches.create({
          name,
          description: opts.description,
          value: parseBool(opts.value),
          switches,
        });
        if (opts.json) return printJson(data);
        console.log(`Created killswitch: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(createKillswitch, [
    { note: "Default OFF", run: "shipeasy flags killswitch create payments.stripe-gateway" },
    {
      note: "Pre-seed per-key switches",
      run: 'shipeasy flags killswitch create payments.stripe-gateway --switches \'{"refunds":true,"payouts":false}\'',
    },
  ]);

  const updateKillswitch = ks
    .command("update <name>")
    .description("Update a killswitch's default value, switches map, or description")
    .option("--value <bool>", "Default value (true|false)")
    .option("--switches <json>", "JSON object of { switch_key: bool } — replaces wholesale")
    .option("--description <desc>", "Description (pass empty to clear)")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const k = await api.killswitches.resolve(name);
        const patch: Parameters<typeof api.killswitches.update>[1] = {};
        if (opts.value !== undefined) patch.value = parseBool(opts.value);
        if (opts.switches !== undefined) patch.switches = JSON.parse(opts.switches);
        if (opts.description !== undefined) {
          patch.description = opts.description === "" ? null : opts.description;
        }
        const data = await api.killswitches.update(k.id, patch);
        if (opts.json) return printJson(data);
        console.log(`Updated killswitch: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(updateKillswitch, [
    { note: "Flip the default ON", run: "shipeasy flags killswitch update payments.stripe-gateway --value true" },
    {
      note: "Replace the whole switches map",
      run: 'shipeasy flags killswitch update payments.stripe-gateway --switches \'{"refunds":false}\'',
    },
  ]);

  const deleteKillswitch = ks
    .command("delete <name>")
    .description("Delete a killswitch")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, opts) => {
      try {
        const api = getAdminClient(opts.project, { requireBinding: true });
        const k = await api.killswitches.resolve(name);
        await api.killswitches.delete(k.id);
        console.log(`Deleted: ${name}`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(deleteKillswitch, [{ run: "shipeasy flags killswitch delete payments.stripe-gateway" }]);

  const setSwitch = ks
    .command("set <name> <switch_key> <value>")
    .description("Set or update one switch entry on one env (default env=prod)")
    .option("--env <env>", `Env: ${ENVS.join(" | ")}`, "prod")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, switchKey: string, value: string, opts) => {
      try {
        const env = assertEnv(opts.env);
        const api = getAdminClient(opts.project, { requireBinding: true });
        const k = await api.killswitches.resolve(name);
        await api.killswitches.setSwitch(k.id, {
          env,
          switchKey,
          value: parseBool(value),
        });
        console.log(`${name}[${env}].${switchKey} = ${parseBool(value)}`);
      } catch (e) {
        handleError(e);
      }
    });

  withDetails(
    setSwitch,
    "A kill switch is a named set of boolean **switches** that ship in the flags " +
      "KV blob alongside gates and configs, so the SDK reads them with no extra " +
      "round-trip. Each switch is keyed by `switch_key` and scoped per " +
      "environment (`dev` / `staging` / `prod`) — so you can flip one dependency " +
      "off in `prod` while leaving `staging` running. `set` creates or updates a " +
      "single switch entry; the value is coerced (`true/1/on` → true, " +
      "`false/0/off` → false).\n\n" +
      "See [Kill switches](/flags-experiments/killswitches) for the full model — " +
      "when to reach for a kill switch vs. a gate at 0%, and how switches " +
      "evaluate at the edge.",
  );

  withExamples(setSwitch, [
    { note: "Kill refunds in prod", run: "shipeasy flags killswitch set payments.stripe-gateway refunds true" },
    { note: "Target staging instead", run: "shipeasy flags killswitch set payments.stripe-gateway refunds true --env staging" },
  ]);

  const unsetSwitch = ks
    .command("unset <name> <switch_key>")
    .description("Remove one switch entry from one env (default env=prod)")
    .option("--env <env>", `Env: ${ENVS.join(" | ")}`, "prod")
    .option("--project <id>", "Project ID override")
    .action(async (name: string, switchKey: string, opts) => {
      try {
        const env = assertEnv(opts.env);
        const api = getAdminClient(opts.project, { requireBinding: true });
        const k = await api.killswitches.resolve(name);
        await api.killswitches.unsetSwitch(k.id, { env, switchKey });
        console.log(`Removed ${name}[${env}].${switchKey}`);
      } catch (e) {
        handleError(e);
      }
    });

  withDetails(
    unsetSwitch,
    "Removes one switch entry from one environment, reverting that key to its " +
      "default (absent = not overridden). The inverse of `set`. See " +
      "[Kill switches](/flags-experiments/killswitches).",
  );

  withExamples(unsetSwitch, [
    { run: "shipeasy flags killswitch unset payments.stripe-gateway refunds" },
    { note: "From staging", run: "shipeasy flags killswitch unset payments.stripe-gateway refunds --env staging" },
  ]);
}

function parseBool(v: string): boolean {
  const s = v.toLowerCase();
  if (s === "true" || s === "1" || s === "on") return true;
  if (s === "false" || s === "0" || s === "off") return false;
  throw new Error(`Expected true/false, got ${v}`);
}

function assertEnv(v: string): "dev" | "staging" | "prod" {
  if (v === "dev" || v === "staging" || v === "prod") return v;
  throw new Error(`Invalid --env=${v}. Must be one of: ${ENVS.join(", ")}`);
}

function handleError(e: unknown): void {
  if (e instanceof ApiError) {
    console.error(`Error (${e.status}): ${e.message}`);
  } else {
    console.error(String(e));
  }
  process.exit(1);
}
