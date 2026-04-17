import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Credentials {
  token: string;
  project_id: string;
  api_url: string;
  worker_url: string;
  saved_at: string;
  expires_at?: string;
}

const CONFIG_DIR = path.join(os.homedir(), ".shipeasy");
const CREDS_PATH = path.join(CONFIG_DIR, "credentials.json");

export function loadCredentials(): Credentials | null {
  try {
    const raw = fs.readFileSync(CREDS_PATH, "utf-8");
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function clearCredentials(): void {
  try {
    fs.unlinkSync(CREDS_PATH);
  } catch {
    // already gone
  }
}
