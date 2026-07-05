// Self-reported setup-failure bug intake. When `shipeasy setup` breaks, the CLI
// (or the agent driving it) can file a structured bug into Shipeasy's own ops
// queue via the public POST /cli/report endpoint — but ONLY with the user's
// explicit consent, and only ever as a `pending_approval` ticket (the server
// forces that state; this key can do nothing else).
//
// Consent is mandatory. `sendSetupIssue` refuses unless `consent === true`, and
// every path prints the EXACT payload first so the user sees what leaves their
// machine before it does.

import os from "node:os";
import prompts from "prompts";
import { loadCredentials, API_BASE_URL } from "../auth/storage";
import { getBoundProjectId } from "../util/project-config";

// Shipeasy's own PUBLIC client key, scoped to `tickets:public_create` only.
// Client keys are designed to be embedded in shipped code, so baking this into
// the distributed CLI is safe: presenting it can do nothing but file a
// pending_approval bug into Shipeasy's own project. Overridable via
// SHIPEASY_REPORT_KEY for testing and until the production key is minted (see
// the bootstrap note in DEPLOY.md / the setup docs).
const BAKED_REPORT_KEY = "sdk_client_REPLACE_WITH_SHIPEASY_PUBLIC_REPORT_KEY";

export function reportClientKey(): string {
  return process.env.SHIPEASY_REPORT_KEY?.trim() || BAKED_REPORT_KEY;
}

/** True once a real key has been baked in (or provided via env) — the reporter
 *  stays inert until then rather than firing doomed requests at the endpoint. */
export function reportConfigured(): boolean {
  return reportClientKey() !== BAKED_REPORT_KEY;
}

const REPORT_TIMEOUT_MS = 4000;

export interface SetupIssueInput {
  title: string;
  step?: string;
  error?: string;
  description?: string;
  reporterEmail?: string;
  projectId?: string;
  language?: string;
  frameworks?: string[];
  cliVersion?: string;
}

/** The exact JSON body POSTed to /cli/report. Returned standalone so callers can
 *  show the user precisely what will be sent before sending (consent). */
export function buildSetupIssuePayload(input: SetupIssueInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: input.title,
    step: input.step ?? "",
    error: input.error ?? "",
    description: input.description ?? "",
    context: {
      os: os.platform(),
      arch: os.arch(),
      node: process.version,
      cli_version: input.cliVersion ?? "unknown",
      project_id: input.projectId ?? getBoundProjectId(process.cwd()) ?? null,
      language: input.language ?? null,
      frameworks: input.frameworks ?? [],
    },
  };
  if (input.reporterEmail) body.reporter_email = input.reporterEmail;
  return body;
}

/** Human-readable preview: what's collected + the exact payload. Shown before
 *  any send so consent is informed. */
export function reportPreview(input: SetupIssueInput): string {
  const payload = buildSetupIssuePayload(input);
  return [
    "This bug report goes to Shipeasy and is filed as PENDING APPROVAL — it's",
    "reviewed before anyone acts on it. It includes:",
    `  • your OS/arch, Node, and CLI version (${os.platform()}-${os.arch()}, ${process.version})`,
    "  • the failing setup step + the error message",
    "  • your Shipeasy project id, detected language + frameworks",
    "  • your description of the problem (if provided)",
    "",
    "Exact payload that will be sent:",
    JSON.stringify(payload, null, 2),
  ].join("\n");
}

export interface SendResult {
  ok: boolean;
  number?: number;
  error?: string;
}

/**
 * POST the report to Shipeasy. HARD consent gate: refuses unless
 * `opts.consent === true`. The endpoint files it as a pending_approval bug into
 * Shipeasy's own project (the baked client key resolves the target project).
 */
export async function sendSetupIssue(
  input: SetupIssueInput,
  opts: { consent: boolean },
): Promise<SendResult> {
  if (!opts.consent) {
    return {
      ok: false,
      error: "No consent recorded — nothing sent. Pass --consent (or answer yes) to send.",
    };
  }
  if (!reportConfigured()) {
    return {
      ok: false,
      error:
        "Bug reporting isn't wired up in this CLI build yet (no report key baked in). " +
        "Set SHIPEASY_REPORT_KEY to a scoped client key to test.",
    };
  }
  const creds = loadCredentials();
  const base = (creds?.api_base_url ?? API_BASE_URL).replace(/\/$/, "");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REPORT_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/cli/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SDK-Key": reportClientKey() },
      body: JSON.stringify(buildSetupIssuePayload(input)),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status}${msg ? `: ${msg.slice(0, 200)}` : ""}` };
    }
    const body = (await res.json().catch(() => ({}))) as { number?: number };
    return { ok: true, number: body.number };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Interactive consent-then-send, used by `setup` on failure and by the standalone
 * command when `--consent` wasn't passed: print the exact payload, ask, and send
 * only on an explicit yes. Non-interactive without consent → skip (never sends
 * silently).
 */
export async function promptAndSend(
  input: SetupIssueInput,
  interactive: boolean,
): Promise<SendResult> {
  if (!interactive) {
    return { ok: false, error: "Non-interactive and no --consent — skipped (nothing sent)." };
  }
  console.log("\n" + reportPreview(input) + "\n");
  const { yes } = await prompts({
    type: "confirm",
    name: "yes",
    message: "Send this bug report to Shipeasy?",
    initial: false,
  });
  if (!yes) return { ok: false, error: "Declined — nothing sent." };
  return sendSetupIssue(input, { consent: true });
}
