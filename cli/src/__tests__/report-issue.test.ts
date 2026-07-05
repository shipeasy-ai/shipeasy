import { describe, it, expect } from "vitest";
import {
  buildSetupIssuePayload,
  reportConfigured,
  sendSetupIssue,
} from "../setup/report-issue";

describe("report-issue", () => {
  it("builds a payload with the failing step, error, and a system context", () => {
    const payload = buildSetupIssuePayload({
      title: "Setup failed at Feature installs",
      step: "Feature installs",
      error: "enableModuleGroup(ops) 500",
      description: "ops enable failed",
      language: "typescript",
      frameworks: ["nextjs", "react"],
      cliVersion: "9.9.9",
    }) as Record<string, unknown>;

    expect(payload.title).toBe("Setup failed at Feature installs");
    expect(payload.step).toBe("Feature installs");
    expect(payload.error).toBe("enableModuleGroup(ops) 500");
    const ctx = payload.context as Record<string, unknown>;
    expect(ctx.cli_version).toBe("9.9.9");
    expect(ctx.language).toBe("typescript");
    expect(ctx.frameworks).toEqual(["nextjs", "react"]);
    expect(typeof ctx.os).toBe("string");
    expect(typeof ctx.node).toBe("string");
  });

  it("omits reporter_email unless provided", () => {
    const without = buildSetupIssuePayload({ title: "x" });
    expect("reporter_email" in without).toBe(false);
    const withEmail = buildSetupIssuePayload({ title: "x", reporterEmail: "a@b.com" });
    expect((withEmail as { reporter_email?: string }).reporter_email).toBe("a@b.com");
  });

  it("HARD-refuses to send without consent (no network)", async () => {
    const res = await sendSetupIssue({ title: "x" }, { consent: false });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/consent/i);
  });

  it("has a real report key baked in (reporter is live)", () => {
    // The production client key is baked in, so the reporter is configured.
    // (We deliberately do NOT call sendSetupIssue with consent here — that would
    // fire a real network request at the live endpoint.)
    expect(reportConfigured()).toBe(true);
  });
});
