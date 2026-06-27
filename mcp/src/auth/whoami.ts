import { configPath, readConfig } from "./config.js";

export async function runWhoami(): Promise<number> {
  const cfg = await readConfig();
  if (!cfg) {
    process.stderr.write(`Not authenticated.\n` + `Run \`shipeasy-mcp install\` to sign in.\n`);
    return 1;
  }
  process.stdout.write(
    JSON.stringify(
      {
        project_id: cfg.project_id,
        user_email: cfg.user_email,
        api_base_url: cfg.api_base_url,
        app_base_url: cfg.app_base_url,
        created_at: cfg.created_at,
        config_path: configPath(),
      },
      null,
      2,
    ) + "\n",
  );
  return 0;
}

export async function runLogout(): Promise<number> {
  const { clearConfig } = await import("./config.js");
  const existed = await clearConfig();
  process.stderr.write(existed ? "Signed out.\n" : "No active session.\n");
  return 0;
}
