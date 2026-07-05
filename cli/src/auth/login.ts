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

// Deterministic beam set for the inline backdrop — mirrors the app's
// BeamsBackground component (left/width in %, per-beam hue + timing so they
// never march in lockstep). Ported to plain CSS keyframes since the loopback
// page has no React / Framer Motion.
const BEAMS = [
  { left: 8, width: 8, hue: "var(--se-info)", delay: 0, duration: 13, peak: 0.5 },
  { left: 22, width: 5, hue: "var(--se-purple)", delay: 2.4, duration: 16, peak: 0.7 },
  { left: 36, width: 11, hue: "var(--se-purple)", delay: 5.1, duration: 15, peak: 0.6 },
  { left: 49, width: 6, hue: "var(--se-cyan)", delay: 1.2, duration: 18, peak: 0.45 },
  { left: 61, width: 9, hue: "var(--se-purple)", delay: 3.6, duration: 14, peak: 0.65 },
  { left: 74, width: 5, hue: "var(--se-info)", delay: 6.3, duration: 17, peak: 0.5 },
  { left: 87, width: 8, hue: "var(--se-purple)", delay: 4.2, duration: 15, peak: 0.4 },
] as const;

// A light touch of feature discovery for the moment right after login. Picked at
// random per render, terminal-flavoured to fit the CLI context.
const TIPS = [
  "Manage flags, experiments, metrics, and alerts from your terminal — the CLI mirrors the whole dashboard.",
  "Ship every feature behind a kill switch and flip it off instantly — no redeploy, no waiting.",
  "Our MCP server lets Claude and other AI agents create flags, run experiments, and read your metrics.",
  "Run A/B experiments with real statistics — we compute significance and tell you when a result is trustworthy.",
  "Change values in production without a deploy using dynamic configs — remote config for anything.",
  "Set a metric alert and we'll ping you the moment a number crosses your threshold.",
] as const;

/** Self-contained success/error page the loopback server returns to the browser.
 *  Recreates the app's `/cli-auth/success` look — the on-brand animated beams
 *  backdrop, a translucent card and a purple check — inline, since this is
 *  served by the CLI process with no access to the app's stylesheet or React.
 *  Always the dark brand canvas; honours prefers-reduced-motion (beams hold
 *  still). Modern CSS (`oklch`, `color-mix`) is safe: the browser is one the
 *  user just opened to authorize. */
function resultHtml(ok: boolean, message?: string): string {
  const accent = ok ? "var(--se-purple)" : "oklch(0.68 0.2 25)";
  const title = ok ? "CLI authorized" : "Sign-in failed";
  const body =
    message ??
    (ok ? "You can now close this page and continue in your terminal." : "Please try again.");
  const glyph = ok
    ? `<path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>`;

  const beams = BEAMS.map(
    (b) =>
      `<div class="beam" style="left:${b.left}%;width:${b.width}%;--hue:${b.hue};--peak:${b.peak};--dur:${b.duration}s;--delay:${b.delay}s">` +
      `<div class="beam-glow"></div><div class="beam-core"></div></div>`,
  ).join("");

  // Success-only extras: the "CLI will finish automatically" reassurance row and
  // a docs link, matching the React success page.
  const extra = ok
    ? `<div class="row">
        <svg class="row-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
        <span>The CLI will finish logging in automatically.</span>
      </div>
      <a class="btn" href="https://docs.shipeasy.ai" target="_blank" rel="noreferrer">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        Read the docs
      </a>`
    : "";

  const tip = TIPS[Math.floor(Math.random() * TIPS.length)];

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title} · Shipeasy</title>
<style>
  :root {
    color-scheme: dark;
    --se-bg: #0a0a0b;
    --se-purple: oklch(0.72 0.18 295);
    --se-info: oklch(0.74 0.14 245);
    --se-cyan: oklch(0.82 0.13 200);
    --acc: ${accent};
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:1rem;
    background:var(--se-bg); color:#ededf0; overflow:hidden;
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }

  /* ── beams backdrop ─────────────────────────────────────────────── */
  .bg { position:fixed; inset:0; z-index:0; overflow:hidden; pointer-events:none; background:var(--se-bg); }
  .beams { position:absolute; inset:0; transform:rotate(-16deg) scale(1.35); transform-origin:center; }
  .beam { position:absolute; top:-25%; height:150%; opacity:.12; animation:drift var(--dur) var(--delay) infinite ease-in-out; }
  .beam-glow { position:absolute; inset:0; filter:blur(24px);
    background:linear-gradient(to top, transparent, color-mix(in oklab, var(--hue) 45%, transparent) 35%, color-mix(in oklab, var(--hue) 18%, transparent) 72%, transparent); }
  .beam-core { position:absolute; top:0; bottom:0; left:50%; width:3px; transform:translateX(-50%); filter:blur(2px);
    background:linear-gradient(to top, transparent, color-mix(in oklab, var(--hue) 90%, white 10%) 40%, color-mix(in oklab, var(--hue) 60%, transparent) 78%, transparent); }
  .spot { position:absolute; left:0; right:0; top:-33%; height:80%;
    background:radial-gradient(ellipse 46% 90% at 50% 0%, color-mix(in oklab, var(--se-purple) 30%, transparent), transparent 58%); }
  .halo { position:absolute; left:50%; top:50%; width:36rem; height:36rem; transform:translate(-50%,-50%); border-radius:9999px; filter:blur(64px);
    background:color-mix(in oklab, var(--se-purple) 14%, transparent); }
  .vignette { position:absolute; inset:0;
    background:radial-gradient(ellipse 130% 100% at 50% 40%, transparent 45%, rgba(4,4,7,0.7) 100%); }
  .grain { position:absolute; inset:0; opacity:.05;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
  @keyframes drift {
    0%   { opacity:.12; transform:translateY(0); }
    25%  { opacity:var(--peak); transform:translateY(-16%); }
    50%  { opacity:.28; transform:translateY(-5%); }
    75%  { opacity:calc(var(--peak) * .85); transform:translateY(-20%); }
    100% { opacity:.12; transform:translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .beam { animation:none; opacity:calc(var(--peak) * .7); transform:none; }
  }

  /* ── foreground ─────────────────────────────────────────────────── */
  .wrap { position:relative; z-index:1; width:100%; max-width:24rem; display:flex; flex-direction:column; gap:2rem; }
  .brand { display:flex; align-items:center; justify-content:center; gap:.5rem; font-weight:700; font-size:1.5rem; }
  .mark { width:1.75rem; height:1.75rem; border-radius:27%; position:relative;
    background:conic-gradient(from 140deg, var(--se-purple), var(--se-bg) 40%, var(--se-purple) 80%);
    box-shadow:0 0 0 1px rgba(255,255,255,0.14); }
  .mark::after { content:""; position:absolute; inset:23%; border-radius:14%; background:var(--se-bg);
    box-shadow:inset 0 0 0 1px rgba(255,255,255,0.14); }
  .card { border:1px solid rgba(255,255,255,0.09); border-radius:0.875rem; padding:2rem 1.5rem; text-align:center;
    background:rgba(20,20,22,0.7); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px);
    box-shadow:0 24px 60px rgba(0,0,0,0.5); }
  .badge { width:3.5rem; height:3.5rem; border-radius:9999px; margin:0 auto 1rem; display:flex; align-items:center; justify-content:center;
    color:var(--acc); background:color-mix(in oklab, var(--acc) 18%, transparent);
    box-shadow:0 0 0 1px color-mix(in oklab, var(--acc) 30%, transparent), 0 0 0 9px color-mix(in oklab, var(--acc) 10%, transparent); }
  h1 { font-size:1.25rem; margin:0 0 .5rem; letter-spacing:-0.01em; }
  .sub { color:#a1a1aa; font-size:0.95rem; line-height:1.45; margin:0; text-wrap:balance; }
  .row { display:flex; align-items:center; gap:.6rem; margin-top:1.25rem; padding:.6rem .75rem; border-radius:.6rem;
    border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.03); color:#a1a1aa; font-size:.85rem; text-align:left; }
  .row-ico { flex:0 0 auto; color:#d4d4d8; }
  .btn { display:flex; align-items:center; justify-content:center; gap:.5rem; margin-top:.75rem; padding:.5rem .75rem;
    border-radius:.6rem; border:1px solid rgba(255,255,255,0.12); color:#d4d4d8; text-decoration:none; font-size:.85rem; font-weight:500;
    transition:background .15s ease, border-color .15s ease; }
  .btn:hover { background:rgba(255,255,255,0.05); border-color:rgba(255,255,255,0.2); }
  .tip { display:flex; align-items:flex-start; gap:.55rem; padding:0 .5rem; color:#8f8f99; font-size:.75rem; line-height:1.5; text-align:left; }
  .tip svg { flex:0 0 auto; margin-top:.15rem; color:var(--se-purple); }
  .tip b { color:#c4c4cc; font-weight:500; }
</style></head>
<body>
  <div class="bg">
    <div class="beams">${beams}</div>
    <div class="spot"></div>
    <div class="halo"></div>
    <div class="vignette"></div>
    <div class="grain"></div>
  </div>
  <div class="wrap">
    <div class="brand"><span class="mark"></span>Shipeasy</div>
    <div class="card">
      <div class="badge"><svg width="28" height="28" viewBox="0 0 24 24">${glyph}</svg></div>
      <h1>${title}</h1>
      <p class="sub">${body}</p>
      ${extra}
    </div>
    <div class="tip">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>
      <p><b>Did you know?</b> ${tip}</p>
    </div>
  </div>
</body></html>`;
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
