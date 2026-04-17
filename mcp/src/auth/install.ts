import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  defaultApiBaseUrl,
  defaultAppBaseUrl,
  readConfig,
  writeConfig,
  type ShipeasyConfig,
} from "./config.js";
import { challengeFromVerifier, generateVerifier } from "./pkce.js";

interface InstallOptions {
  apiBaseUrl?: string;
  appBaseUrl?: string;
  /** If true, print the browser URL instead of trying to open it. */
  noBrowser?: boolean;
  /** If true, overwrite an existing config without prompting. */
  force?: boolean;
}

interface StartResponse {
  state: string;
  expires_at: string;
}

interface PollResponse {
  token: string;
  project_id: string;
  user_email?: string;
}

/**
 * `shipeasy-mcp install` — drive the CLI device-auth flow, save token to
 * ~/.config/shipeasy/config.json. Same endpoints as the CLI `shipeasy login`;
 * the resulting config is shared between the two tools.
 */
export async function runInstall(opts: InstallOptions = {}): Promise<number> {
  const apiBase = opts.apiBaseUrl ?? defaultApiBaseUrl();
  const appBase = opts.appBaseUrl ?? defaultAppBaseUrl();

  const existing = await readConfig();
  if (existing && !opts.force) {
    process.stderr.write(
      `Already authenticated as project ${existing.project_id}${existing.user_email ? ` (${existing.user_email})` : ""}.\n` +
        `Re-run with --force to replace the current token, or run \`shipeasy-mcp logout\` first.\n`,
    );
    return 0;
  }

  const verifier = generateVerifier();
  const challenge = await challengeFromVerifier(verifier);

  let startRes: StartResponse;
  try {
    startRes = await startDeviceSession(apiBase, challenge);
  } catch (err) {
    process.stderr.write(
      `Failed to start auth session at ${apiBase}/auth/device/start: ${stringifyError(err)}\n`,
    );
    return 1;
  }

  const authUrl = `${appBase.replace(/\/$/, "")}/cli-auth?state=${encodeURIComponent(
    startRes.state,
  )}&code_challenge=${encodeURIComponent(challenge)}&source=mcp`;

  process.stderr.write(`\nOpen this URL in your browser to authenticate:\n\n  ${authUrl}\n\n`);

  if (!opts.noBrowser) {
    tryOpenBrowser(authUrl);
  }

  process.stderr.write(`Waiting for auth (expires ${startRes.expires_at})…\n`);

  const result = await pollUntilAuthorized(apiBase, startRes.state, verifier, startRes.expires_at);
  if (!result.ok) {
    process.stderr.write(`Auth failed: ${result.error}\n`);
    return 1;
  }

  const cfg: ShipeasyConfig = {
    project_id: result.payload.project_id,
    cli_token: result.payload.token,
    api_base_url: apiBase,
    app_base_url: appBase,
    user_email: result.payload.user_email,
    created_at: new Date().toISOString(),
  };
  await writeConfig(cfg);

  process.stderr.write(
    `\nSigned in — project ${cfg.project_id}${cfg.user_email ? ` (${cfg.user_email})` : ""}.\n` +
      `Token stored at: ${configPathForDisplay()}\n\n` +
      `Next: restart your AI assistant so it picks up the new credentials, then try \`auth_check\` from the shipeasy MCP server.\n`,
  );
  return 0;
}

async function startDeviceSession(apiBase: string, codeChallenge: string): Promise<StartResponse> {
  const url = `${apiBase.replace(/\/$/, "")}/auth/device/start`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code_challenge: codeChallenge }),
  });
  if (!res.ok)
    throw new Error(`${res.status} ${res.statusText}: ${await res.text().catch(() => "")}`);
  const body = (await res.json()) as StartResponse;
  if (!body.state) throw new Error("no state returned");
  return body;
}

async function pollUntilAuthorized(
  apiBase: string,
  state: string,
  verifier: string,
  expiresAtIso: string,
): Promise<{ ok: true; payload: PollResponse } | { ok: false; error: string }> {
  const expiresAt = new Date(expiresAtIso).getTime();
  const url = `${apiBase.replace(/\/$/, "")}/auth/device/poll?state=${encodeURIComponent(state)}`;

  let tick = 0;
  while (Date.now() < expiresAt) {
    await sleep(tick === 0 ? 1500 : 2500);
    tick++;

    let res: Response;
    try {
      res = await fetch(url, { headers: { "x-code-verifier": verifier } });
    } catch (err) {
      // transient network error — keep polling
      process.stderr.write(`.`);
      continue;
    }

    if (res.status === 202) {
      process.stderr.write(`.`);
      continue;
    }

    if (res.status === 200) {
      const body = (await res.json()) as PollResponse;
      if (!body.token || !body.project_id) {
        return {
          ok: false,
          error: "malformed /auth/device/poll response (missing token or project_id)",
        };
      }
      process.stderr.write(`\n`);
      return { ok: true, payload: body };
    }

    const text = await res.text().catch(() => "");
    return {
      ok: false,
      error: `${res.status} ${res.statusText}${text ? `: ${text}` : ""}`,
    };
  }

  return { ok: false, error: "session expired before authorization completed" };
}

function tryOpenBrowser(url: string): void {
  const platform = process.platform;
  const [cmd, ...args] =
    platform === "darwin"
      ? ["open", url]
      : platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];

  try {
    const child = spawn(cmd!, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
      /* user can still paste the URL */
    });
    child.unref();
  } catch {
    // Browser launch is best-effort. The URL was already printed above.
  }
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function configPathForDisplay(): string {
  // Avoid circular import — recompute here for the success message only.
  const xdg = process.env.XDG_CONFIG_HOME;
  const root = xdg ? xdg : `${process.env.HOME ?? "~"}/.config`;
  return `${root}/shipeasy/config.json`;
}
