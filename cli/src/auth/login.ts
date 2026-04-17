import crypto from "node:crypto";
import { saveCredentials } from "./storage";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(s: string): Promise<string> {
  const hash = crypto.createHash("sha256").update(s, "utf8").digest();
  return base64url(hash);
}

async function openBrowser(url: string): Promise<void> {
  // Dynamic import so the CJS bundle can still load open (ESM)
  const { default: open } = await import("open");
  await open(url);
}

export async function login(opts: {
  workerUrl: string;
  apiUrl: string;
  projectId?: string;
}): Promise<void> {
  const workerUrl = opts.workerUrl.replace(/\/$/, "");
  const apiUrl = opts.apiUrl.replace(/\/$/, "");

  // Generate PKCE pair
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = await sha256(codeVerifier);

  // Start device session
  const startRes = await fetch(`${workerUrl}/auth/device/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code_challenge: codeChallenge }),
  });
  if (!startRes.ok) {
    throw new Error(`Device start failed: ${startRes.status}`);
  }
  const { state } = (await startRes.json()) as { state: string };

  // Open browser
  const authUrl = `${apiUrl}/cli-auth?state=${state}&code_challenge=${encodeURIComponent(codeChallenge)}`;
  console.log(`\nOpening browser for authentication...\n  ${authUrl}\n`);
  console.log("If the browser does not open, paste the URL above manually.\n");
  await openBrowser(authUrl).catch(() => {
    // Ignore open errors — user can copy the URL
  });

  // Poll for token
  console.log("Waiting for browser authentication...");
  const deadline = Date.now() + 600_000; // 10 minutes
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(`${workerUrl}/auth/device/poll?state=${state}`, {
      headers: { "X-Code-Verifier": codeVerifier },
    });
    if (pollRes.status === 202) continue; // pending
    if (pollRes.status === 410) {
      throw new Error("Authentication session expired. Try again.");
    }
    if (!pollRes.ok) {
      throw new Error(`Poll failed: ${pollRes.status}`);
    }
    const payload = (await pollRes.json()) as { token: string; project_id: string };
    const projectId = opts.projectId ?? payload.project_id;

    saveCredentials({
      token: payload.token,
      project_id: projectId,
      api_url: apiUrl,
      worker_url: workerUrl,
      saved_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    });
    console.log(`\nLogged in. Project: ${projectId}`);
    return;
  }
  throw new Error("Authentication timed out. Try again.");
}
