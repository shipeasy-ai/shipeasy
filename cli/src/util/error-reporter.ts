// Best-effort telemetry: posts CLI parse/usage errors to the edge worker so
// we can spot mistypes, missing args, and broken flows in the field. Always
// fire-and-forget with a short timeout — never blocks the user's terminal.

import os from "node:os";
import { loadCredentials, API_BASE_URL } from "../auth/storage";

const CLI_VERSION = "1.0.0";
const REPORT_TIMEOUT_MS = 1500;

const SECRET_FLAG_RE = /^--?(token|secret|password|key|api[-_]?key|auth)$/i;
const SDK_KEY_RE = /^se_[a-z]+_/i;

export interface CliErrorReport {
  kind: string;
  command?: string | null;
  message: string;
  argv: string[];
  exit_code?: number;
}

function sanitizeArgv(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    // --flag=value with secret-y key.
    if (arg.startsWith("-") && arg.includes("=")) {
      const eq = arg.indexOf("=");
      const k = arg.slice(0, eq);
      if (SECRET_FLAG_RE.test(k)) {
        out.push(`${k}=<redacted>`);
        continue;
      }
    }
    // --flag <value> with secret-y key.
    if (arg.startsWith("-") && SECRET_FLAG_RE.test(arg) && i + 1 < argv.length) {
      out.push(arg, "<redacted>");
      i += 1;
      continue;
    }
    // Bare token that looks like an SDK key.
    if (SDK_KEY_RE.test(arg)) {
      out.push("<redacted-key>");
      continue;
    }
    out.push(arg);
  }
  return out;
}

export async function reportCliError(report: CliErrorReport): Promise<void> {
  const creds = loadCredentials();
  const workerUrl = (creds?.api_base_url ?? API_BASE_URL).replace(/\/$/, "");

  const body = {
    kind: report.kind,
    command: report.command ?? null,
    message: report.message,
    argv: sanitizeArgv(report.argv),
    exit_code: report.exit_code ?? null,
    cli_version: CLI_VERSION,
    node_version: process.version,
    platform: `${os.platform()}-${os.arch()}`,
    ts: Date.now(),
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (creds?.cli_token) headers["X-SDK-Key"] = creds.cli_token;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REPORT_TIMEOUT_MS);
  try {
    await fetch(`${workerUrl}/cli/errors`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    // Telemetry must never affect the user — swallow network/abort errors.
  } finally {
    clearTimeout(timer);
  }
}
