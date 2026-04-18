import { ok } from "../../util/api-client.js";

interface I18nManifest {
  profiles?: unknown[];
  locale?: string;
  framework?: string;
  [key: string]: unknown;
}

export async function handleDiscoverSite(input: { url: string }) {
  const baseUrl = input.url.replace(/\/$/, "");

  let manifestUrl: string | null = null;
  let rawManifest: I18nManifest | null = null;

  // ── 1. Try /.well-known/i18n.json ─────────────────────────────────────────
  try {
    const wellKnownUrl = `${baseUrl}/.well-known/i18n.json`;
    const res = await fetch(wellKnownUrl);
    if (res.ok) {
      rawManifest = (await res.json()) as I18nManifest;
      manifestUrl = wellKnownUrl;
    }
  } catch {
    // ignore network errors
  }

  // ── 2. Try to find <link rel="i18n-config" href="..."> in the HTML ────────
  let linkHref: string | null = null;
  try {
    const res = await fetch(baseUrl);
    if (res.ok) {
      const html = await res.text();
      const match =
        /<link[^>]+rel=["']i18n-config["'][^>]+href=["']([^"']+)["']/i.exec(html) ??
        /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']i18n-config["']/i.exec(html);
      if (match?.[1]) {
        linkHref = match[1].startsWith("http") ? match[1] : `${baseUrl}${match[1]}`;
      }
    }
  } catch {
    // ignore network errors
  }

  // ── 3. Fetch manifest from <link> if we don't already have one ────────────
  if (linkHref && !rawManifest) {
    try {
      const res = await fetch(linkHref);
      if (res.ok) {
        rawManifest = (await res.json()) as I18nManifest;
        manifestUrl = linkHref;
      }
    } catch {
      // ignore
    }
  } else if (linkHref && !manifestUrl) {
    manifestUrl = linkHref;
  }

  if (!rawManifest && !linkHref) {
    return ok({
      found: false,
      message: "No i18n manifest found at this URL",
      checked: [`${baseUrl}/.well-known/i18n.json`, `${baseUrl} (HTML <link rel="i18n-config">)`],
    });
  }

  return ok({
    found: true,
    manifest_url: manifestUrl,
    profiles: rawManifest?.profiles ?? null,
    locale: rawManifest?.locale ?? null,
    framework_hints: rawManifest?.framework ?? null,
    raw_manifest: rawManifest,
  });
}
