// CI guard: prove the committed artifacts are in sync with the authored spec/.
// Re-bundles spec/ → openapi.yaml and re-generates src/generated, then asserts
// `git` sees no change. If this fails, someone edited spec/ (or openapi.yaml /
// src/generated) without running `pnpm gen` — run it and commit the result.
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
const out = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

console.log("• re-bundling spec/ and re-generating the SDK…");
run("pnpm bundle");
run("pnpm gen:sdk");

const dirty = out("git status --porcelain -- openapi.yaml src/generated");
if (dirty) {
  console.error(
    "\n✗ drift: openapi.yaml / src/generated are stale relative to spec/.\n" +
      "  Run `pnpm gen` and commit. Changed:\n" +
      dirty
        .split("\n")
        .map((l) => "    " + l)
        .join("\n"),
  );
  process.exit(1);
}
console.log("✓ no drift — committed artifacts match spec/.");
