#!/usr/bin/env node
/**
 * Rewrite `workspace:` protocol deps to registry semver in the package being
 * published, so its published manifest carries a resolvable version. Run with
 * the cwd set to the package dir (the publish workflow does `working-directory:
 * <dir>` then `node ../scripts/inline-workspace-deps.mjs`).
 *
 *   "@shipeasy/openapi": "workspace:^1.0.0"  →  "@shipeasy/openapi": "^1.0.0"
 *   "@shipeasy/mcp": "workspace:*"           →  "@shipeasy/mcp": "<that pkg's version>"
 *
 * The `workspace:*` / `workspace:~` forms resolve to the sibling package's
 * current version (read from ../<name-after-scope>/package.json), matching what
 * pnpm would publish. `workspace:^X.Y.Z` / `workspace:~X.Y.Z` keep the range.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const pkgPath = join(process.cwd(), "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

// Map @shipeasy/<x> → sibling dir name in the workspace root.
const SIBLING_DIR = {
  "@shipeasy/openapi": "openapi",
  "@shipeasy/mcp": "mcp",
  "@shipeasy/cli": "cli",
};

function siblingVersion(name) {
  const dir = SIBLING_DIR[name];
  if (!dir) return null;
  const p = join(process.cwd(), "..", dir, "package.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")).version : null;
}

let changed = 0;
for (const field of [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]) {
  const deps = pkg[field];
  if (!deps) continue;
  for (const [name, spec] of Object.entries(deps)) {
    if (typeof spec !== "string" || !spec.startsWith("workspace:")) continue;
    const rest = spec.slice("workspace:".length);
    if (rest === "*" || rest === "~" || rest === "^") {
      const v = siblingVersion(name);
      if (!v) throw new Error(`cannot resolve sibling version for ${name} (${spec})`);
      const prefix = rest === "*" ? "^" : rest; // pin `*` to caret semver
      deps[name] = `${prefix === "^" ? "^" : prefix}${v}`;
    } else {
      deps[name] = rest; // keep the explicit range (^X.Y.Z / ~X.Y.Z / X.Y.Z)
    }
    changed++;
    console.log(`  ${name}: ${spec} → ${deps[name]}`);
  }
}

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log(`inline-workspace-deps: rewrote ${changed} dep(s) in ${pkg.name}`);
