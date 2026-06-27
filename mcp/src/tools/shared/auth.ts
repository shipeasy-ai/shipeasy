import { configPath, readConfig } from "../../auth/config.js";
import { runLogout } from "../../auth/whoami.js";

/**
 * `auth_check` MCP tool handler — reports whether the shared config file
 * holds a valid token. Does NOT launch a browser (stdio transport can't)
 * — tell the caller to run `shipeasy-mcp install` instead.
 */
export async function handleAuthCheck() {
  const cfg = await readConfig();
  const result = cfg
    ? {
        authenticated: true,
        project_id: cfg.project_id,
        user_email: cfg.user_email ?? null,
        api_base_url: cfg.api_base_url,
        app_base_url: cfg.app_base_url,
        config_path: configPath(),
      }
    : {
        authenticated: false,
        project_id: null,
        config_path: configPath(),
        next_step:
          "Run `shipeasy-mcp install` in a terminal to authenticate. " +
          "The command opens a browser, completes PKCE device auth, and writes the token to the config path above.",
      };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

export async function handleAuthLogout() {
  await runLogout();
  return {
    content: [{ type: "text" as const, text: "Signed out locally." }],
  };
}
