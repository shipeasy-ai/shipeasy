/**
 * Entry dispatcher for `shipeasy-mcp`.
 *
 *   shipeasy-mcp                    → start the stdio MCP server (default)
 *   shipeasy-mcp start|stdio        → same
 *   shipeasy-mcp install|login      → browser-based PKCE device auth, writes
 *                                     ~/.config/shipeasy/config.json
 *   shipeasy-mcp whoami             → print the current session
 *   shipeasy-mcp logout             → clear the local config
 *   shipeasy-mcp --help | -h        → usage
 *   shipeasy-mcp --version | -v     → version
 */

const HELP = `shipeasy-mcp — Model Context Protocol server for the Shipeasy platform

Usage:
  shipeasy-mcp                Start the stdio MCP server (default; for AI assistant use)
  shipeasy-mcp install        Sign in via browser, store token in ~/.config/shipeasy/config.json
  shipeasy-mcp whoami         Print the current session (project_id + email)
  shipeasy-mcp logout         Remove the local token

Install flags:
  --force                     Replace an existing token without prompting
  --no-browser                Print the auth URL instead of opening it
  --api-base-url <url>        Override the worker base URL (default: $SHIPEASY_API_BASE_URL or https://api.shipeasy.ai)
  --app-base-url <url>        Override the UI base URL (default: $SHIPEASY_APP_BASE_URL or https://app.shipeasy.ai)

Env:
  SHIPEASY_API_BASE_URL       Worker URL (used for /auth/device/*)
  SHIPEASY_APP_BASE_URL       Next.js UI URL (used for /cli-auth)
  XDG_CONFIG_HOME             Overrides the config file location
`;

function parseFlag<T>(args: string[], name: string, withValue = true): T | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  if (!withValue) return true as T;
  return args[idx + 1] as T | undefined;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(HELP);
    return 0;
  }

  if (cmd === "--version" || cmd === "-v") {
    const { default: pkg } = await import("../package.json", { with: { type: "json" } });
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  switch (cmd) {
    case undefined:
    case "":
    case "start":
    case "stdio":
    case "serve": {
      const { startStdioServer } = await import("./server.js");
      await startStdioServer();
      // Block forever — the MCP SDK's stdio transport keeps the process alive
      // via stdin listeners. Returning would let process.exit(0) fire before
      // any JSON-RPC response flushes.
      await new Promise<void>(() => {});
      return 0; // unreachable
    }

    case "install":
    case "login":
    case "enable": {
      const { runInstall } = await import("./auth/install.js");
      return runInstall({
        force: !!parseFlag<boolean>(rest, "force", false),
        noBrowser: !!parseFlag<boolean>(rest, "no-browser", false),
        apiBaseUrl: parseFlag<string>(rest, "api-base-url"),
        appBaseUrl: parseFlag<string>(rest, "app-base-url"),
      });
    }

    case "whoami":
    case "status": {
      const { runWhoami } = await import("./auth/whoami.js");
      return runWhoami();
    }

    case "logout":
    case "signout": {
      const { runLogout } = await import("./auth/whoami.js");
      return runLogout();
    }

    default:
      process.stderr.write(`Unknown subcommand: ${cmd}\n\n${HELP}`);
      return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(
      `[shipeasy-mcp] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  },
);
