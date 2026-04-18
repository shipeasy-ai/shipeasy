import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { saveCredentials } from "./storage";

function defaultApiBaseUrl(): string {
  return process.env.SHIPEASY_API_BASE_URL?.trim() || "https://cdn.shipeasy.ai";
}

function defaultAppBaseUrl(): string {
  return process.env.SHIPEASY_APP_BASE_URL?.trim() || "https://shipeasy.ai";
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(s: string): Promise<string> {
  const hash = crypto.createHash("sha256").update(s, "utf8").digest();
  return base64url(hash);
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
    child.on("error", () => {});
    child.unref();
  } catch {
    // Browser launch is best-effort — user can paste the URL.
  }
}

export async function login(opts: { workerUrl?: string; appUrl?: string } = {}): Promise<void> {
  const workerUrl = (opts.workerUrl ?? defaultApiBaseUrl()).replace(/\/$/, "");
  const appUrl = (opts.appUrl ?? defaultAppBaseUrl()).replace(/\/$/, "");

  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = await sha256(codeVerifier);

  const startRes = await fetch(`${workerUrl}/auth/device/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code_challenge: codeChallenge }),
  });
  if (!startRes.ok) {
    throw new Error(
      `Device start failed: ${startRes.status} ${await startRes.text().catch(() => "")}`,
    );
  }
  const { state, expires_at } = (await startRes.json()) as {
    state: string;
    expires_at: string;
  };

  const authUrl =
    `${appUrl}/cli-auth` +
    `?state=${encodeURIComponent(state)}` +
    `&code_challenge=${encodeURIComponent(codeChallenge)}` +
    `&source=cli`;

  console.log(`\nOpening browser for authentication:\n\n  ${authUrl}\n`);
  console.log("Paste the URL above manually if the browser does not open.\n");
  tryOpenBrowser(authUrl);

  console.log("Waiting for browser authentication…");
  const deadline = new Date(expires_at).getTime();
  let tick = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, tick === 0 ? 1500 : 2500));
    tick++;

    const pollRes = await fetch(
      `${workerUrl}/auth/device/poll?state=${encodeURIComponent(state)}`,
      { headers: { "X-Code-Verifier": codeVerifier } },
    );
    if (pollRes.status === 202) {
      process.stdout.write(".");
      continue;
    }
    if (pollRes.status === 410) throw new Error("Session expired. Try again.");
    if (!pollRes.ok) {
      throw new Error(`Poll failed: ${pollRes.status} ${await pollRes.text().catch(() => "")}`);
    }

    process.stdout.write("\n");
    const payload = (await pollRes.json()) as {
      token: string;
      project_id: string;
      user_email?: string;
    };

    saveCredentials({
      project_id: payload.project_id,
      cli_token: payload.token,
      api_base_url: workerUrl,
      app_base_url: appUrl,
      user_email: payload.user_email,
      created_at: new Date().toISOString(),
    });

    console.log(
      `\nLogged in. Project: ${payload.project_id}` +
        (payload.user_email ? ` (${payload.user_email})` : ""),
    );
    return;
  }
  throw new Error("Authentication timed out. Try again.");
}
