// One-time: restructure the tag tree so the tag `parent` chain defines the CLI
// command structure (and docs nav), and retag operations onto the new leaf
// tags. After this, the generator derives each command's group from its tag's
// ancestor chain; x-cli carries only the verb (see inject-xcli.mjs, group-less).
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SPEC = `${ROOT}/spec/openapi.yaml`;
const PATHS = `${ROOT}/spec/paths`;

// ── rewrite tags ────────────────────────────────────────────────────────────
const doc = parseDocument(readFileSync(SPEC, "utf8"));
const oldTags = doc.toJS().tags;
const descOf = (name) => oldTags.find((t) => t.name === name)?.description;

const newTags = [
  { name: "Release", summary: "Feature delivery", kind: "nav", description: descOf("Release") },
  { name: "Flags", parent: "Release", description: descOf("Gates") },
  { name: "Killswitch", parent: "Release", "x-cli": { aliases: ["ks"] }, description: descOf("Killswitches") },
  { name: "Configs", parent: "Release", description: descOf("Configs") },
  { name: "Experiments", parent: "Release", description: descOf("Experiments") },
  { name: "Universes", parent: "Experiments", description: descOf("Universes") },
  { name: "Attributes", parent: "Flags", description: descOf("Attributes") },
  { name: "Metrics", description: descOf("Metrics") },
  { name: "Events", parent: "Metrics", description: descOf("Events") },
  { name: "Ops", description: descOf("Ops") },
  { name: "Alerts", parent: "Ops", "x-cli": { aliases: ["ar"] }, description: descOf("Alert Rules") },
  { name: "Projects", description: descOf("Projects") },
  { name: "i18n", description: descOf("i18n") },
  { name: "Profiles", parent: "i18n", description: "Locale profiles (e.g. `en:prod`) — create, list, and publish a profile's chunks to the CDN." },
  { name: "Keys", parent: "i18n", description: "Translation keys — the insert-only push, single-key overwrite, and key listing." },
  { name: "Drafts", parent: "i18n", description: "Machine-translation drafts awaiting review before publish." },
];
doc.setIn(["tags"], doc.createNode(newTags));
writeFileSync(SPEC, doc.toString({ lineWidth: 0 }));
console.log(`rewrote ${newTags.length} tags`);

// ── retag operations ────────────────────────────────────────────────────────
const TAG = {
  listGates: "Flags", createGate: "Flags", updateGate: "Flags", enableGate: "Flags", disableGate: "Flags", deleteGate: "Flags",
  listKillswitches: "Killswitch", getKillswitch: "Killswitch", createKillswitch: "Killswitch", updateKillswitch: "Killswitch", deleteKillswitch: "Killswitch", setKillswitchSwitch: "Killswitch", unsetKillswitchSwitch: "Killswitch",
  listConfigs: "Configs", getConfig: "Configs", createConfig: "Configs", updateConfig: "Configs", deleteConfig: "Configs", saveConfigDraft: "Configs", discardConfigDraft: "Configs", publishConfigDraft: "Configs", listConfigActivity: "Configs",
  listExperiments: "Experiments", getExperiment: "Experiments", createExperiment: "Experiments", updateExperiment: "Experiments", deleteExperiment: "Experiments", setExperimentStatus: "Experiments", setExperimentMetrics: "Experiments", getExperimentResults: "Experiments", getExperimentTimeseries: "Experiments", reanalyzeExperiment: "Experiments",
  listUniverses: "Universes", createUniverse: "Universes", updateUniverse: "Universes", deleteUniverse: "Universes",
  listAttributes: "Attributes",
  listMetrics: "Metrics", getMetric: "Metrics", createMetric: "Metrics", deleteMetric: "Metrics",
  listEvents: "Events", getEvent: "Events", createEvent: "Events", updateEvent: "Events", deleteEvent: "Events", approveEvent: "Events",
  listOpsItems: "Ops", getOpsItem: "Ops", updateOpsItem: "Ops", createBug: "Ops", createFeatureRequest: "Ops", linkPrToOpsItem: "Ops", notifyOps: "Ops",
  listSlackChannels: "Alerts", listAlertRules: "Alerts", createAlertRule: "Alerts", updateAlertRule: "Alerts", deleteAlertRule: "Alerts",
  getCurrentProject: "Projects", upsertProject: "Projects",
  listI18nProfiles: "Profiles", createI18nProfile: "Profiles", publishI18nProfile: "Profiles",
  listI18nKeys: "Keys", pushI18nKeys: "Keys", updateI18nKey: "Keys",
  listI18nDrafts: "Drafts",
};
const METHODS = ["get", "post", "put", "patch", "delete"];
let retagged = 0;
for (const file of readdirSync(PATHS).filter((f) => f.endsWith(".yaml"))) {
  const full = `${PATHS}/${file}`;
  const d = parseDocument(readFileSync(full, "utf8"));
  let changed = false;
  for (const pair of d.contents.items) {
    const pathKey = pair.key.value;
    for (const method of METHODS) {
      const operationId = d.getIn([pathKey, method, "operationId"]);
      if (operationId && TAG[operationId]) {
        d.setIn([pathKey, method, "tags"], d.createNode([TAG[operationId]]));
        retagged++;
        changed = true;
      }
    }
  }
  if (changed) writeFileSync(full, d.toString({ lineWidth: 0 }));
}
console.log(`retagged ${retagged} operations`);
