import { describe, it, expect } from "vitest";
import {
  buildSetupIssuePayload,
  reportConfigured,
  sendSetupIssue,
} from "../setup/report-issue";

describe("report-issue", () => {
  // The payload IS the spec's `CreatePublicBugRequest` — camelCase field names,
  // the failing step carried in `context.step` (where the worker reads it for
  // its dedupe key). Asserting the exact names on purpose: a drift back to the
  // retired snake_case body would silently file blank bugs.
  it("builds the documented CreatePublicBugRequest body", () => {
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
    expect(payload.stepsToReproduce).toBe("ops enable failed");
    expect(payload.actualResult).toBe("enableModuleGroup(ops) 500");
    expect(payload.expectedResult).toBe("Setup completes without errors.");
    // No leftovers from the old body shape.
    expect("step" in payload).toBe(false);
    expect("error" in payload).toBe(false);
    expect("description" in payload).toBe(false);
    const ctx = payload.context as Record<string, unknown>;
    expect(ctx.step).toBe("Feature installs");
    expect(ctx.cli_version).toBe("9.9.9");
    expect(ctx.language).toBe("typescript");
    expect(ctx.frameworks).toEqual(["nextjs", "react"]);
    expect(typeof ctx.os).toBe("string");
    expect(typeof ctx.node).toBe("string");
  });

  it("omits reporterEmail unless provided", () => {
    const without = buildSetupIssuePayload({ title: "x" });
    expect("reporterEmail" in without).toBe(false);
    const withEmail = buildSetupIssuePayload({ title: "x", reporterEmail: "a@b.com" });
    expect((withEmail as { reporterEmail?: string }).reporterEmail).toBe("a@b.com");
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
