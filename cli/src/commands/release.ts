import { Command } from "commander";
import {
  gateOperations,
  killswitchOperations,
  configOperations,
  experimentOperations,
  universeOperations,
  mountOperations,
  opId,
  type Operation,
  type OpInput,
  type CliContext,
} from "@shipeasy/openapi";
import type { ExperimentResult } from "@shipeasy/openapi";
import { ApiError, getAdminClient } from "../api/client";
import { printJson, printTable, statusColor } from "../util/output";
import { withExamples, withDetails, withOutput, withTreeHelp } from "../util/examples";

/**
 * The `release` module — feature flags, kill switches, configs, experiments,
 * and universes. Every subcommand is generated from the shared operation
 * registry in `@shipeasy/openapi` (`mountOperations`), so the facade→wire
 * mapping lives once and the CLI, MCP server, and docs never drift.
 *
 * This file owns only the CLI-presentation concerns the registry deliberately
 * doesn't carry: the typed admin client + binding guard, the per-op table
 * formatting (`printResult`), and the rich `--help` extras (long-form details
 * and sample output) keyed by op id.
 */

// ── error + client plumbing (injected into the registry adapter) ────────────

function handleError(e: unknown): void {
  if (e instanceof ApiError) {
    console.error(`Error (${e.status}): ${e.message}`);
  } else {
    console.error(String(e));
  }
  process.exit(1);
}

const ctx: CliContext = {
  getClient: ({ mutates, projectOverride }) =>
    getAdminClient(projectOverride, { requireBinding: mutates }),
  printJson,
  printResult,
  onError: handleError,
};

// ── human-readable output per op (the JSON path is handled by the adapter) ──

function verdict(results: ExperimentResult[]): string {
  const treatment = results.filter((r) => r.group_name !== "control");
  if (!treatment.length) return "—";
  const last = treatment[treatment.length - 1];
  if (last.srm_detected === 1) return "Invalid (SRM)";
  if (last.p_value === null) return "Wait";
  return last.p_value < 0.05 ? "Ship" : "Hold";
}

function printResult(op: Operation, data: unknown, input: OpInput): void {
  const name = input.name as string | undefined;
  const env = (input.env as string | undefined) ?? "prod";
  switch (opId(op)) {
    // ── flags (gates) ──
    case "release.flags.list": {
      const gates = data as { name: string; enabled: boolean; rolloutPct: number }[];
      if (!gates.length) return void console.log("No flags found.");
      return printTable(
        ["Name", "Enabled", "Rollout %"],
        gates.map((g) => [g.name, g.enabled ? "yes" : "no", `${(g.rolloutPct / 100).toFixed(0)}%`]),
      );
    }
    case "release.flags.create":
      return void console.log(`Created flag: ${name}`);
    case "release.flags.update":
      return void console.log(`Updated flag: ${name}`);
    case "release.flags.enable":
      return void console.log(`Enabled: ${name}`);
    case "release.flags.disable":
      return void console.log(`Disabled: ${name}`);
    case "release.flags.rollout":
      return void console.log(`Set rollout for ${name}: ${input.pct}%`);

    // ── kill switches ──
    case "release.killswitch.list": {
      const rows = data as {
        name: string;
        envs: Record<string, { value?: boolean; switches?: Record<string, boolean> } | undefined>;
        updatedAt: string;
      }[];
      if (!rows.length) return void console.log("No killswitches found.");
      return printTable(
        ["Name", "Default (prod)", "Switches (prod)", "Updated"],
        rows.map((k) => {
          const prod = k.envs.prod ?? k.envs.staging ?? k.envs.dev;
          const switchCount = prod?.switches ? Object.keys(prod.switches).length : 0;
          return [k.name, prod?.value ? "ON" : "OFF", String(switchCount), k.updatedAt.slice(0, 19)];
        }),
      );
    }
    case "release.killswitch.create":
      return void console.log(`Created killswitch: ${name}`);
    case "release.killswitch.update":
      return void console.log(`Updated killswitch: ${name}`);
    case "release.killswitch.set":
      return void console.log(`${name}[${env}].${input.switchKey} = ${input.value}`);
    case "release.killswitch.unset":
      return void console.log(`Removed ${name}[${env}].${input.switchKey}`);

    // ── configs ──
    case "release.configs.list": {
      const items = data as { name: string; schema: unknown; updatedAt: string }[];
      if (!items.length) return void console.log("No configs found.");
      return printTable(
        ["Name", "Schema", "Updated"],
        items.map((c) => [c.name, JSON.stringify(c.schema), c.updatedAt]),
      );
    }
    case "release.configs.get":
      return void console.log(JSON.stringify(data, null, 2));
    case "release.configs.create":
      return void console.log(`Created config: ${name}`);
    case "release.configs.update":
      return void console.log(`Updated config: ${name}`);
    case "release.configs.draft":
      return void console.log(`Saved draft for ${name} (${input.env})`);
    case "release.configs.publish":
      return void console.log(`Published ${name} → ${input.env}`);

    // ── experiments ──
    case "release.experiments.list": {
      const experiments = data as {
        name: string;
        status: string;
        universe: string;
        allocationPct?: number;
      }[];
      if (!experiments.length) return void console.log("No experiments found.");
      return printTable(
        ["Name", "Status", "Universe", "Allocation"],
        experiments.map((e) => [
          e.name,
          statusColor(e.status),
          e.universe,
          `${((e.allocationPct ?? 10000) / 100).toFixed(0)}%`,
        ]),
      );
    }
    case "release.experiments.create":
      return void console.log(`Created experiment: ${name}`);
    case "release.experiments.update":
      return void console.log(`Updated experiment: ${name}`);
    case "release.experiments.start":
      return void console.log(`Started: ${name}`);
    case "release.experiments.stop":
      return void console.log(`Stopped: ${name}`);
    case "release.experiments.restore":
      return void console.log(`Restored: ${name}`);
    case "release.experiments.reanalyze":
      return void console.log(`Reanalyzed: ${name}`);
    case "release.experiments.status": {
      const { experiment: e, results } = data as {
        experiment: { name: string; status: string; universe: string; allocationPct?: number };
        results: ExperimentResult[];
      };
      console.log(`\nExperiment: ${e.name}`);
      console.log(`Status:     ${statusColor(e.status)}`);
      console.log(`Universe:   ${e.universe}`);
      console.log(`Allocation: ${((e.allocationPct ?? 10000) / 100).toFixed(0)}%`);
      console.log(`Verdict:    ${verdict(results)}`);
      if (results.length) {
        console.log("\nLatest results:");
        printTable(
          ["Metric", "Group", "N", "Mean", "Delta %", "p-value"],
          results.map((r) => [
            r.metric,
            r.group_name,
            r.n ?? "—",
            r.mean?.toFixed(4) ?? "—",
            r.delta_pct !== null ? `${(r.delta_pct * 100).toFixed(2)}%` : "—",
            r.p_value?.toFixed(4) ?? "—",
          ]),
        );
      } else {
        console.log("\nNo results yet. Start the experiment and wait for the daily cron.");
      }
      return;
    }

    // ── universes ──
    case "release.experiments.universes.list": {
      const items = data as { name: string; allocationPct?: number; holdoutPct?: number }[];
      if (!items.length) return void console.log("No universes found.");
      return printTable(
        ["Name", "Allocation %", "Holdout %"],
        items.map((x) => [
          x.name,
          `${((x.allocationPct ?? 10000) / 100).toFixed(0)}%`,
          `${((x.holdoutPct ?? 0) / 100).toFixed(0)}%`,
        ]),
      );
    }
    case "release.experiments.universes.create":
      return void console.log(`Created universe: ${name}`);
    case "release.experiments.universes.update":
      return void console.log(`Updated universe: ${name}`);

    // ── archive (every resource) ──
    default:
      if (op.name === "archive") return void console.log(`Archived: ${name}`);
      // Fallback: print whatever the op returned.
      return void console.log(JSON.stringify(data, null, 2));
  }
}

// ── rich `--help` extras the registry op doesn't carry (CLI-only) ───────────

/** Long-form `withDetails` prose, keyed by op id. */
const DETAILS: Record<string, string> = {
  "release.killswitch.set":
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
  "release.killswitch.unset":
    "Removes one switch entry from one environment, reverting that key to its " +
    "default (absent = not overridden). The inverse of `set`. See " +
    "[Kill switches](/flags-experiments/killswitches).",
};

/** Sample `--json` output, keyed by op id. */
const OUTPUT: Record<string, Parameters<typeof withOutput>[1]> = {
  "release.flags.list": {
    note: "with --json",
    json: [
      {
        id: "gate_7Hq2",
        name: "checkout-v2",
        enabled: true,
        rolloutPct: 2500,
        rules: [{ attr: "plan", op: "eq", value: "pro" }],
        updatedAt: "2026-06-14T17:00:00.000Z",
      },
    ],
  },
};

/**
 * Mount a resource's ops onto `node`, then re-attach the CLI-only help extras
 * (examples from the registry op, plus any long-form details / sample output)
 * to each generated subcommand.
 */
function mountResource(node: Command, ops: Operation[]): void {
  mountOperations(node, ops, ctx);
  for (const op of ops) {
    const cmd = node.commands.find((c) => c.name() === op.name);
    if (!cmd) continue;
    if (op.examples?.length) withExamples(cmd, op.examples);
    const details = DETAILS[opId(op)];
    if (details) withDetails(cmd, details);
    const output = OUTPUT[opId(op)];
    if (output) withOutput(cmd, output);
  }
}

export function releaseCommand(program: Command): void {
  const release = program
    .command("release")
    .description("Feature flags, kill switches, experiments & configs");

  mountResource(release.command("flags").description("Manage feature flags (gates)"), gateOperations);

  const ks = release.command("killswitch").alias("ks").description("Manage kill switches");
  mountResource(ks, killswitchOperations);

  mountResource(
    release.command("configs").description("Manage remote-config values"),
    configOperations,
  );

  const experiments = release.command("experiments").description("Manage experiments");
  mountResource(experiments, experimentOperations);
  mountResource(
    experiments
      .command("universes")
      .description("Manage experiment universes (containers + holdouts)"),
    universeOperations,
  );

  withTreeHelp(release);
}
