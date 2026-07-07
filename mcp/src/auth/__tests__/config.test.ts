import { describe, it, expect } from "vitest";
import { configFromEnv, API_BASE_URL, APP_BASE_URL } from "../config.js";

describe("configFromEnv", () => {
  it("synthesizes a config from SHIPEASY_CLI_TOKEN + SHIPEASY_PROJECT_ID", () => {
    const cfg = configFromEnv({ SHIPEASY_CLI_TOKEN: "tok_1", SHIPEASY_PROJECT_ID: "prj_1" });
    expect(cfg).toEqual({
      project_id: "prj_1",
      cli_token: "tok_1",
      api_base_url: API_BASE_URL,
      app_base_url: APP_BASE_URL,
      created_at: "",
    });
  });

  it("trims whitespace around the env values", () => {
    const cfg = configFromEnv({ SHIPEASY_CLI_TOKEN: " tok ", SHIPEASY_PROJECT_ID: " prj " });
    expect(cfg).toMatchObject({ cli_token: "tok", project_id: "prj" });
  });

  it("returns null unless BOTH vars are present", () => {
    expect(configFromEnv({ SHIPEASY_CLI_TOKEN: "tok_1" })).toBeNull();
    expect(configFromEnv({ SHIPEASY_PROJECT_ID: "prj_1" })).toBeNull();
    expect(configFromEnv({})).toBeNull();
  });
});
