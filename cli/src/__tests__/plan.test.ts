import { describe, it, expect } from "vitest";
import { planSetupUrl } from "../setup/plan";

describe("planSetupUrl", () => {
  // The two params are load-bearing and BOTH are whitelisted by the app:
  // `intent=cli` selects the two-step Plan → Finish funnel (everything else the
  // full wizard collects, this run already did), and `step=plan` opens straight
  // on the picker instead of the first step.
  it("opens the CLI onboarding funnel on the plan step", () => {
    expect(planSetupUrl("https://shipeasy.ai")).toBe(
      "https://shipeasy.ai/onboarding?intent=cli&step=plan",
    );
  });

  it("normalises a trailing slash so the path never doubles up", () => {
    expect(planSetupUrl("https://shipeasy.ai/")).toBe(
      "https://shipeasy.ai/onboarding?intent=cli&step=plan",
    );
  });

  it("honours a non-prod origin (local dev / preview deploys)", () => {
    expect(planSetupUrl("http://localhost:3000")).toBe(
      "http://localhost:3000/onboarding?intent=cli&step=plan",
    );
  });
});
