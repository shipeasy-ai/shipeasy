import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { saveCredentials, loadCredentials, API_BASE_URL, APP_BASE_URL } from "./storage";
import { bindProject, readProjectConfig, getBoundProjectId } from "../util/project-config";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** What the browser delivers to the loopback server after the user authorizes. */
type CliAuthResult = {
  token: string;
  project_id: string;
  project_name?: string;
  user_email?: string;
};

/**
 * Stand up a throwaway loopback HTTP server on an ephemeral port (RFC 8252). The
 * `/cli-auth` page 302-redirects the browser here with the freshly minted token
 * in the query string once the user authorizes — so the token is delivered
 * straight to this process, no KV stash and no polling. `expectedState` is the
 * `state` we started the session with; the callback must echo it back (CSRF +
 * stray-request guard). Uses only `node:http` — no extra dependency.
 */
function startLoopbackServer(expectedState: string): Promise<{
  port: number;
  result: Promise<CliAuthResult>;
  close: () => void;
}> {
  return new Promise((resolveServer, rejectServer) => {
    let settle!: (r: CliAuthResult) => void;
    let fail!: (e: Error) => void;
    const result = new Promise<CliAuthResult>((res, rej) => {
      settle = res;
      fail = rej;
    });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      // The browser only ever GETs `/` (or `/callback`); ignore favicon etc.
      if (url.pathname !== "/" && url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const q = url.searchParams;
      const token = q.get("token");
      const projectId = q.get("project_id");
      const state = q.get("state");

      if (state !== expectedState) {
        // A stray or forged callback — don't complete login on it.
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(resultHtml(false, "This sign-in link didn’t match the one this terminal started."));
        return;
      }
      if (!token || !projectId) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(resultHtml(false, "The sign-in response was missing its token. Please try again."));
        fail(new Error("Loopback callback missing token."));
        return;
      }

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(resultHtml(true));
      settle({
        token,
        project_id: projectId,
        project_name: q.get("project_name") ?? undefined,
        user_email: q.get("user_email") ?? undefined,
      });
    });

    server.on("error", rejectServer);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolveServer({ port, result, close: () => server.close() });
    });
  });
}

/** Self-contained success/error page the loopback server returns to the browser.
 *  Mirrors the look of the app's `/cli-auth/success` page (green check, card,
 *  "continue in your terminal") but inline — this is served by the CLI, with no
 *  access to the app's stylesheet. */
function resultHtml(ok: boolean, message?: string): string {
  const accent = ok ? "#16a34a" : "#dc2626";
  const ring = ok ? "rgba(22,163,74,0.12)" : "rgba(220,38,38,0.12)";
  const title = ok ? "CLI authorized" : "Sign-in failed";
  const body =
    message ??
    (ok ? "You can now close this page and continue in your terminal." : "Please try again.");
  const glyph = ok
    ? `<path d="M20 6 9 17l-5-5" fill="none" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="M18 6 6 18M6 6l12 12" fill="none" stroke="${accent}" stroke-width="2.5" stroke-linecap="round"/>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title} · Shipeasy</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#f8fafc; font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; color:#0f172a; }
  @media (prefers-color-scheme: dark) { body { background:#0b1120; color:#e2e8f0; } .card { background:#0f172a !important; border-color:#1e293b !important; } .sub { color:#94a3b8 !important; } }
  .wrap { width:100%; max-width:24rem; padding:1rem; box-sizing:border-box; }
  .brand { text-align:center; font-weight:700; font-size:1.5rem; margin-bottom:1.5rem; }
  .card { background:#fff; border:1px solid #e2e8f0; border-radius:0.875rem; padding:2rem 1.5rem; text-align:center;
    box-shadow:0 10px 30px rgba(2,6,23,0.08); }
  .badge { width:3.5rem; height:3.5rem; border-radius:9999px; background:${ring}; display:flex; align-items:center;
    justify-content:center; margin:0 auto 1rem; }
  h1 { font-size:1.25rem; margin:0 0 .5rem; }
  .sub { color:#475569; font-size:0.95rem; line-height:1.4; margin:0; }
</style></head>
<body><div class="wrap">
  <div class="brand">Shipeasy</div>
  <div class="card">
    <div class="badge"><svg width="28" height="28" viewBox="0 0 24 24">${glyph}</svg></div>
    <h1>${title}</h1>
    <p class="sub">${body}</p>
  </div>
</div></body></html>`;
}

export function tryOpenBrowser(url: string): void {
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

/**
 * Verify the stored session token still works by fetching its own project.
 * Returns the live session when valid, or null when there are no credentials
 * or the token is expired/revoked (so the caller falls through to a real
 * login). Network failures are treated as "can't confirm" → null, so a
 * transient outage never blocks re-authentication.
 */
async function currentSession(): Promise<{ projectId: string; email?: string } | null> {
  const creds = loadCredentials();
  if (!creds) return null;
  const baseUrl = creds.app_base_url.replace(/\/$/, "");
  try {
    const res = await fetch(`${baseUrl}/api/admin/projects/${creds.project_id}`, {
      headers: { "X-SDK-Key": creds.cli_token, "X-Project-Id": creds.project_id },
    });
    if (!res.ok) return null;
    return { projectId: creds.project_id, email: creds.user_email };
  } catch {
    return null;
  }
}

/** What `login` resolved to. `ranBrowserFlow` is true only when the device/
 *  browser flow actually completed this call (a fresh, explicit project choice)
 *  — callers like `shipeasy setup` use it to decide whether the returned project
 *  is authoritative enough to (re)write `.shipeasy` over a stale binding. */
export type LoginResult = { projectId: string; ranBrowserFlow: boolean };

export async function login(
  opts: { force?: boolean; projectId?: string; ensureBound?: boolean } = {},
): Promise<LoginResult> {
  // Scope the login to a single project when one is known: an explicit
  // --project wins, otherwise the project bound to cwd via `.shipeasy`
  // (searched up the tree, like .git). When set, the browser flow offers
  // only that project instead of the full picker. When neither is present,
  // run the normal pick-or-create flow.
  const projectId = opts.projectId ?? getBoundProjectId(process.cwd());

  // Idempotent by default: if a valid session already exists, do nothing so
  // automation (and the create_trigger command) can call `login`
  // unconditionally at the start of a run. When a specific project is
  // requested, only short-circuit if the live session is already on it —
  // otherwise fall through to re-scope to the requested project.
  // `--force` always re-authenticates.
  //
  // `ensureBound` (used by `shipeasy setup`) tightens this: a valid session is
  // not enough if the current directory has no `.shipeasy` yet — we still run
  // the browser flow so the user can pick/create a project for this folder and
  // we can bind it. Without this, an already-authed user in a fresh repo would
  // short-circuit and never get a `.shipeasy`.
  if (!opts.force) {
    const session = await currentSession();
    const boundHere = !!getBoundProjectId(process.cwd());
    const sessionMatches = session && (!projectId || session.projectId === projectId);
    if (sessionMatches && (!opts.ensureBound || boundHere)) {
      console.log(
        `Already logged in${session.email ? ` as ${session.email}` : ""}` +
          ` (project ${session.projectId}). Use \`shipeasy login --force\` to re-authenticate.`,
      );
      return { projectId: session.projectId, ranBrowserFlow: false };
    }
  }

  const workerUrl = API_BASE_URL;
  const appUrl = APP_BASE_URL;

  // The `state` D1 session still gates a one-time completion + expiry; the
  // browser delivers the minted token straight to our loopback server (no poll),
  // so PKCE's verifier is gone. We still send a `code_challenge` because the
  // /cli-auth page treats a missing one as an invalid link.
  const codeChallenge = base64url(crypto.randomBytes(32));

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

  // Loopback server first, so we have a port to hand the browser.
  const { port, result, close } = await startLoopbackServer(state);

  const authUrl =
    `${appUrl}/cli-auth` +
    `?state=${encodeURIComponent(state)}` +
    `&code_challenge=${encodeURIComponent(codeChallenge)}` +
    `&port=${port}` +
    `&source=cli` +
    (projectId ? `&project_id=${encodeURIComponent(projectId)}` : "");

  console.log(`\nOpening browser for authentication:\n\n  ${authUrl}\n`);
  console.log("Paste the URL above manually if the browser does not open.\n");
  tryOpenBrowser(authUrl);

  console.log("Waiting for browser authentication…");

  // Race the browser callback against the session deadline, then always tear the
  // server down.
  const msLeft = Math.max(new Date(expires_at).getTime() - Date.now(), 0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Authentication timed out. Try again.")), msLeft);
  });

  let payload: CliAuthResult;
  try {
    payload = await Promise.race([result, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    close();
  }

  saveCredentials({
    project_id: payload.project_id,
    cli_token: payload.token,
    api_base_url: workerUrl,
    app_base_url: appUrl,
    user_email: payload.user_email,
    created_at: new Date().toISOString(),
  });

  console.log(
    `\nLogged in. Session project: ${payload.project_id}` +
      (payload.user_email ? ` (${payload.user_email})` : ""),
  );

  // Auto-bind the returned project_id to cwd when nothing is bound yet.
  // The /cli-auth page is now the single place where the user picks an
  // existing project OR creates a new one (with name + domain) — by the
  // time we get here, the choice is already final. Writing .shipeasy
  // means subsequent CLI/MCP commands in this tree go straight to the
  // right project without a separate `projects upsert` step.
  try {
    const existing = readProjectConfig(process.cwd());
    if (!existing.project_id) {
      const { path, created } = bindProject(
        process.cwd(),
        payload.project_id,
        payload.project_name,
      );
      console.log(
        `${created ? "Wrote" : "Updated"} ${path} → project ${payload.project_id}.\n` +
          "Commit .shipeasy alongside your code so teammates and CI agree on the project.",
      );
    } else if (existing.project_id !== payload.project_id) {
      console.log(
        `\nNote: cwd is already bound to ${existing.project_id}. Leaving the existing\n` +
          `.shipeasy in place. Override with: shipeasy bind ${payload.project_id}`,
      );
    }
  } catch (err) {
    console.error(
      `Auth succeeded but auto-bind failed (${String(err)}). ` +
        `Run \`shipeasy bind ${payload.project_id}\` manually.`,
    );
  }

  return { projectId: payload.project_id, ranBrowserFlow: true };
}
