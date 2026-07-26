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

/**
 * `auth_logout` MCP tool handler.
 *
 * Schema-level `required: ["confirm"]` is advisory — a client that ignores it
 * still reaches this handler — so the guard is enforced here too. The cost of a
 * stray call is high and asymmetric: the deleted file is the session the CLI and
 * every MCP client share, and `auth_login` cannot run over stdio, so nothing on
 * this transport can put it back. A refusal costs one retry; a wrong deletion
 * costs a human a browser round-trip.
 */
export async function handleAuthLogout(args: { confirm?: unknown } = {}) {
  if (args.confirm !== true) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text:
            `Refused: auth_logout deletes ${configPath()}, the session shared by the ` +
            "`shipeasy` CLI and every MCP client on this machine, and it cannot be " +
            "restored from MCP (browser sign-in only runs in a terminal).\n\n" +
            "If a call is failing with 401/403, sign in — do not log out first; the " +
            "credential you would delete is the one you still need.\n\n" +
            "If the user explicitly asked to sign out, call again with confirm: true.",
        },
      ],
    };
  }
  await runLogout();
  return {
    content: [
      {
        type: "text" as const,
        text:
          "Signed out locally. Restoring the session needs `shipeasy login` (or " +
          "`shipeasy-mcp install`) in a terminal — a browser sign-in this transport cannot do.",
      },
    ],
  };
}
