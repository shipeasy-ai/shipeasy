// One-time: inject the hand-authored CLI/MCP taxonomy into the spec as
// operation-level `x-cli` extensions. After this, x-cli is part of the authored
// spec/ tree and the generator reads it to build the exact command tree. This
// map IS the taxonomy source of truth — edit here (or the YAML) to change it.
//
// x-cli per operation:
//   group:      command path, e.g. ["release","flags"]
//   name:       verb (omit when `commands` is present)
//   positional: field names (path or body) rendered as positional args
//   commands:   synthetic verbs sharing one endpoint, each {name, summary, preset}
//               where `preset` is body values baked in + hidden as flags
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const PATHS_DIR = fileURLToPath(new URL("../spec/paths", import.meta.url));

const X = {
  // ── release · flags (gates) ──
  listGates: { group: ["release", "flags"], name: "list" },
  createGate: { group: ["release", "flags"], name: "create", positional: ["name"] },
  updateGate: { group: ["release", "flags"], name: "update", positional: ["id"] },
  enableGate: { group: ["release", "flags"], name: "enable", positional: ["id"] },
  disableGate: { group: ["release", "flags"], name: "disable", positional: ["id"] },
  deleteGate: { group: ["release", "flags"], name: "archive", positional: ["id"] },
  // ── release · killswitch ──
  listKillswitches: { group: ["release", "killswitch"], name: "list" },
  getKillswitch: { group: ["release", "killswitch"], name: "get", positional: ["id"] },
  createKillswitch: { group: ["release", "killswitch"], name: "create", positional: ["name"] },
  updateKillswitch: { group: ["release", "killswitch"], name: "update", positional: ["id"] },
  deleteKillswitch: { group: ["release", "killswitch"], name: "archive", positional: ["id"] },
  setKillswitchSwitch: { group: ["release", "killswitch"], name: "set", positional: ["id"] },
  unsetKillswitchSwitch: { group: ["release", "killswitch"], name: "unset", positional: ["id"] },
  // ── release · configs ──
  listConfigs: { group: ["release", "configs"], name: "list" },
  getConfig: { group: ["release", "configs"], name: "get", positional: ["id"] },
  createConfig: { group: ["release", "configs"], name: "create", positional: ["name"] },
  updateConfig: { group: ["release", "configs"], name: "update", positional: ["id"] },
  deleteConfig: { group: ["release", "configs"], name: "archive", positional: ["id"] },
  saveConfigDraft: { group: ["release", "configs"], name: "draft", positional: ["id"] },
  discardConfigDraft: { group: ["release", "configs"], name: "discard-draft", positional: ["id"] },
  publishConfigDraft: { group: ["release", "configs"], name: "publish", positional: ["id"] },
  listConfigActivity: { group: ["release", "configs"], name: "activity", positional: ["id"] },
  // ── release · experiments ──
  listExperiments: { group: ["release", "experiments"], name: "list" },
  getExperiment: { group: ["release", "experiments"], name: "get", positional: ["id"] },
  createExperiment: { group: ["release", "experiments"], name: "create", positional: ["name"] },
  updateExperiment: { group: ["release", "experiments"], name: "update", positional: ["id"] },
  deleteExperiment: { group: ["release", "experiments"], name: "archive", positional: ["id"] },
  setExperimentStatus: {
    group: ["release", "experiments"],
    positional: ["id"],
    commands: [
      { name: "start", summary: "Start an experiment (draft → running)", preset: { status: "running" } },
      { name: "stop", summary: "Stop a running experiment", preset: { status: "stopped" } },
      { name: "restore", summary: "Restore an archived experiment (→ draft)", preset: { status: "draft" } },
    ],
  },
  setExperimentMetrics: { group: ["release", "experiments"], name: "set-metrics", positional: ["id"] },
  getExperimentResults: { group: ["release", "experiments"], name: "results", positional: ["id"] },
  getExperimentTimeseries: { group: ["release", "experiments"], name: "timeseries", positional: ["id"] },
  reanalyzeExperiment: { group: ["release", "experiments"], name: "reanalyze", positional: ["id"] },
  // ── release · experiments · universes ──
  listUniverses: { group: ["release", "experiments", "universes"], name: "list" },
  createUniverse: { group: ["release", "experiments", "universes"], name: "create", positional: ["name"] },
  updateUniverse: { group: ["release", "experiments", "universes"], name: "update", positional: ["id"] },
  deleteUniverse: { group: ["release", "experiments", "universes"], name: "archive", positional: ["id"] },
  // ── metrics ──
  listMetrics: { group: ["metrics"], name: "list" },
  getMetric: { group: ["metrics"], name: "show", positional: ["id"] },
  createMetric: { group: ["metrics"], name: "create", positional: ["name"] },
  deleteMetric: { group: ["metrics"], name: "archive", positional: ["id"] },
  // ── metrics · events ──
  listEvents: { group: ["metrics", "events"], name: "list" },
  getEvent: { group: ["metrics", "events"], name: "get", positional: ["id"] },
  createEvent: { group: ["metrics", "events"], name: "create", positional: ["name"] },
  updateEvent: { group: ["metrics", "events"], name: "update", positional: ["id"] },
  deleteEvent: { group: ["metrics", "events"], name: "archive", positional: ["id"] },
  approveEvent: { group: ["metrics", "events"], name: "approve", positional: ["id"] },
  // ── attributes ──
  listAttributes: { group: ["attributes"], name: "list" },
  // ── ops · alerts (alert rules) ──
  listAlertRules: { group: ["ops", "alerts"], name: "list" },
  createAlertRule: { group: ["ops", "alerts"], name: "create" },
  updateAlertRule: { group: ["ops", "alerts"], name: "update", positional: ["id"] },
  deleteAlertRule: { group: ["ops", "alerts"], name: "archive", positional: ["id"] },
  listSlackChannels: { group: ["ops", "alerts"], name: "channels" },
  // ── ops (queue) ──
  listOpsItems: { group: ["ops"], name: "list" },
  getOpsItem: { group: ["ops"], name: "get", positional: ["handle"] },
  updateOpsItem: { group: ["ops"], name: "update", positional: ["handle"] },
  createBug: { group: ["ops"], name: "create-bug" },
  createFeatureRequest: { group: ["ops"], name: "create-feature-request" },
  linkPrToOpsItem: { group: ["ops"], name: "link-pr", positional: ["handle"] },
  notifyOps: { group: ["ops"], name: "notify" },
  // ── projects ──
  getCurrentProject: { group: ["projects"], name: "current" },
  upsertProject: { group: ["projects"], name: "upsert" },
  // ── i18n ──
  listI18nProfiles: { group: ["i18n", "profiles"], name: "list" },
  createI18nProfile: { group: ["i18n", "profiles"], name: "create" },
  publishI18nProfile: { group: ["i18n", "profiles"], name: "publish", positional: ["profileId"] },
  listI18nKeys: { group: ["i18n", "keys"], name: "list" },
  pushI18nKeys: { group: ["i18n", "keys"], name: "push" },
  updateI18nKey: { group: ["i18n", "keys"], name: "update", positional: ["id"] },
  listI18nDrafts: { group: ["i18n", "drafts"], name: "list" },
};

const METHODS = ["get", "post", "put", "patch", "delete"];
let injected = 0;
const missing = new Set(Object.keys(X));

for (const file of readdirSync(PATHS_DIR).filter((f) => f.endsWith(".yaml"))) {
  const full = `${PATHS_DIR}/${file}`;
  const doc = parseDocument(readFileSync(full, "utf8"));
  let changed = false;
  for (const pair of doc.contents.items) {
    const pathKey = pair.key.value;
    for (const method of METHODS) {
      const op = doc.getIn([pathKey, method]);
      if (!op) continue;
      const operationId = doc.getIn([pathKey, method, "operationId"]);
      if (operationId && X[operationId]) {
        // `group` is now derived from the tag parent chain — strip it; x-cli
        // carries only the per-operation verb / positional / synthetic commands.
        const { group, ...xcli } = X[operationId];
        doc.setIn([pathKey, method, "x-cli"], doc.createNode(xcli));
        missing.delete(operationId);
        injected++;
        changed = true;
      }
    }
  }
  if (changed) writeFileSync(full, doc.toString({ lineWidth: 0 }));
}

console.log(`injected x-cli into ${injected} operations`);
if (missing.size) console.warn(`! never matched (operationId not found in spec): ${[...missing].join(", ")}`);
