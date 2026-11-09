import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { waitingLine } from "../auth/install.js";
import { wantsHelp } from "../util/cli-args.js";
import { PACKAGE_VERSION } from "../util/version.js";

describe("wantsHelp", () => {
  it("catches --help / -h after a subcommand (install --help must not start sign-in)", () => {
    expect(wantsHelp(["--help"])).toBe(true);
    expect(wantsHelp(["--force", "-h"])).toBe(true);
  });

  it("is false for ordinary flags", () => {
    expect(wantsHelp([])).toBe(false);
    expect(wantsHelp(["--force", "--no-browser"])).toBe(false);
  });
});

describe("PACKAGE_VERSION", () => {
  it("is the package.json version (serverInfo.version was stuck at 0.1.0)", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(PACKAGE_VERSION).toBe(pkg.version);
    expect(PACKAGE_VERSION).not.toBe("0.1.0");
  });
});

describe("waitingLine", () => {
  it("states the expiry up front in minutes", () => {
    const now = Date.parse("2026-11-09T00:00:00Z");
    expect(waitingLine("2026-11-09T00:10:00Z", now)).toContain("expires in 10 minutes");
  });

  it("degrades gracefully on an unparseable expiry", () => {
    expect(waitingLine("nope")).toBe("Waiting for approval in the browser…");
  });
});
