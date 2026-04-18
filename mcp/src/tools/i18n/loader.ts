import { readConfig } from "../../auth/config.js";
import { getI18nClientKey, saveI18nClientKey } from "../../util/project-config.js";

interface CreatedKey {
  id: string;
  type: string;
  key: string;
  expires_at: string | null;
}

async function createClientKey(
  appBaseUrl: string,
  token: string,
  projectId: string,
): Promise<string> {
  const res = await fetch(`${appBaseUrl.replace(/\/$/, "")}/api/admin/keys`, {
    method: "POST",
    headers: {
      "X-SDK-Key": token,
      "Content-Type": "application/json",
      "X-Project-Id": projectId,
    },
    body: JSON.stringify({ type: "client" }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  return ((await res.json()) as CreatedKey).key;
}

export async function handleInstallLoader(input: {
  profile?: string;
  framework?: string;
  path?: string;
}) {
  const cfg = await readConfig();
  if (!cfg) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: "Not authenticated. Run `shipeasy auth login` in the terminal first.",
        },
      ],
    };
  }

  const profile = input.profile ?? "default";
  const projectDir = input.path ?? process.cwd();

  let dataKey = await getI18nClientKey(projectDir);
  if (!dataKey) {
    try {
      dataKey = await createClientKey(cfg.app_base_url, cfg.cli_token, cfg.project_id);
      await saveI18nClientKey(projectDir, dataKey);
    } catch (err: unknown) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Failed to create SDK key: ${String(err)}` }],
      };
    }
  }

  const loaderUrl = `${cfg.api_base_url.replace(/\/$/, "")}/sdk/i18n/loader.js`;
  const scriptTag = `<script src="${loaderUrl}" data-key="${dataKey}" data-profile="${profile}" defer></script>`;

  const result = {
    data_key: dataKey,
    profile,
    loader_url: loaderUrl,
    script_tag: scriptTag,
    framework: input.framework ?? "unknown — run detect_project first",
    next_step:
      `Run the CLI to inject the script tag automatically:\n` +
      `  shipeasy i18n install-loader --profile "${profile}"\n\n` +
      `The CLI reads the key from .shipeasy automatically. ` +
      `Or paste script_tag manually into your framework's root layout/HTML file inside <head>.`,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}
