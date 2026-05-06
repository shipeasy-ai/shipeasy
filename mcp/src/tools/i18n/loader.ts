import { getApiClient, notAuthenticated, notBound } from "../../util/api-client.js";
import { getI18nClientKey, saveI18nClientKey } from "../../util/project-config.js";

interface CreatedKey {
  id: string;
  type: string;
  key: string;
  expires_at: string | null;
}

export async function handleInstallLoader(input: {
  profile?: string;
  framework?: string;
  path?: string;
}) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();
  // Minting an SDK key is a write into the project — refuse if cwd isn't
  // bound. Otherwise we'd burn a key on the wrong project.
  if (!client.bound) return notBound(client);

  const profile = input.profile ?? "default";
  const projectDir = input.path ?? process.cwd();

  let dataKey = await getI18nClientKey(projectDir);
  if (!dataKey) {
    try {
      const created = await client.post<CreatedKey>("/api/admin/keys", { type: "client" });
      dataKey = created.key;
      await saveI18nClientKey(projectDir, dataKey);
    } catch (err: unknown) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: `Failed to create SDK key: ${String(err)}` }],
      };
    }
  }

  const loaderUrl = `${client.cfg.api_base_url.replace(/\/$/, "")}/sdk/i18n/loader.js`;
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
