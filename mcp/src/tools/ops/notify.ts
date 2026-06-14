import { getApiClient, notAuthenticated, notBound, apiErr, ok } from "../../util/api-client.js";

/**
 * `ops_notify` — raise a "needs your attention" bell notification. The
 * escalation channel for an agent working the ops queue when a fix can't land
 * in code (missing credential/device/prod env, a product call, an env or
 * alert-rule knob only a human can change). Create-only; idempotent on the
 * dedupe key. Hits the same `POST /api/admin/notifications` endpoint as the CLI
 * `ops.notify` command, so the server composes the feed body from summary+steps.
 */
export async function handleOpsNotify(input: {
  title: string;
  summary: string;
  steps?: string[];
  href?: string;
  dedupeKey?: string;
  item?: string | number;
}) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();
  if (!client.bound) return notBound(client);
  try {
    const dedupeKey =
      input.dedupeKey ??
      (input.item != null ? `feedback:${String(input.item).replace(/^#/, "")}` : undefined);
    const payload: Record<string, unknown> = {
      title: input.title,
      summary: input.summary,
      steps: input.steps ?? [],
    };
    if (input.href) payload.href = input.href;
    if (dedupeKey) payload.dedupeKey = dedupeKey;
    const result = await client.post("/api/admin/notifications", payload);
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}
