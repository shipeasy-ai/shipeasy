import { describe, it, expect } from "vitest";
import {
  TRIGGER_PLATFORMS,
  normalizePlatform,
  triggerSetupUrl,
} from "../setup/triggers";

describe("normalizePlatform", () => {
  it("accepts each guided platform id", () => {
    for (const p of TRIGGER_PLATFORMS) expect(normalizePlatform(p.id)).toBe(p.id);
  });

  it("aliases jules → gemini and is case/space tolerant", () => {
    expect(normalizePlatform("jules")).toBe("gemini");
    expect(normalizePlatform("  CLAUDE ")).toBe("claude");
  });

  it("returns null for unknown or empty values", () => {
    expect(normalizePlatform("windsurf")).toBeNull();
    expect(normalizePlatform("")).toBeNull();
    expect(normalizePlatform(null)).toBeNull();
    expect(normalizePlatform(undefined)).toBeNull();
  });
});

describe("triggerSetupUrl", () => {
  it("points at the hosted dashboard triggers wizard with a provider deep link", () => {
    expect(triggerSetupUrl("https://app.shipeasy.ai", "prj_123", "claude")).toBe(
      "https://app.shipeasy.ai/dashboard/prj_123/triggers?provider=claude",
    );
  });

  it("omits the query when no platform is preselected", () => {
    expect(triggerSetupUrl("https://app.shipeasy.ai", "prj_123", null)).toBe(
      "https://app.shipeasy.ai/dashboard/prj_123/triggers",
    );
  });

  it("strips a trailing slash from the base URL", () => {
    expect(triggerSetupUrl("https://app.shipeasy.ai/", "prj_1", "cursor")).toBe(
      "https://app.shipeasy.ai/dashboard/prj_1/triggers?provider=cursor",
    );
  });
});
