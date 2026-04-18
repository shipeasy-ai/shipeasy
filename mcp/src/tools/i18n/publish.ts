import { getApiClient, notAuthenticated, apiErr, ok } from "../../util/api-client.js";
import { resolveProfileId } from "./profiles.js";

export async function handlePublishProfile(input: { profile: string; chunk?: string }) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();

  const profileId = await resolveProfileId(input.profile).catch(() => null);
  if (!profileId) {
    return apiErr(
      `Profile '${input.profile}' not found. Create it first with i18n_create_profile.`,
    );
  }

  try {
    const result = await client.post(`/api/admin/i18n/profiles/${profileId}/publish`, {
      chunk: input.chunk ?? "default",
    });
    return ok(result);
  } catch (err) {
    // Provide a helpful message if the endpoint isn't implemented yet
    const status = (err as { status?: number }).status;
    if (status === 404 || status === 501) {
      return ok({
        warning:
          "Publish endpoint not yet implemented server-side — keys are stored in D1 but CDN publish " +
          "requires POST /api/admin/i18n/profiles/:id/publish to be implemented in apps/ui.",
        profile_id: profileId,
        chunk: input.chunk ?? "default",
      });
    }
    return apiErr(err);
  }
}
