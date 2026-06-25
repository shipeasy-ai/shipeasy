import { getApiClient, notAuthenticated, notBound, apiErr, ok } from "../../util/api-client.js";

/**
 * `file_bug` — file a bug report into the bound project's feedback queue. Hits
 * the same `POST /api/admin/bugs` endpoint the dashboard + CLI use, so the
 * report runs through the server's processor AND fires the project's connectors
 * (opening a GitHub issue / posting to Slack). The body fields become the issue
 * body verbatim — the model is expected to clarify a vague report before calling
 * this and fold the answers into them. `page_url` is dropped when blank so the
 * server's URL validation doesn't reject an empty string.
 */
export async function handleFileBug(input: {
  title: string;
  steps_to_reproduce?: string;
  actual_result?: string;
  expected_result?: string;
  priority?: string;
  page_url?: string;
}) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();
  if (!client.bound) return notBound(client);
  try {
    const payload: Record<string, unknown> = {
      title: input.title,
      stepsToReproduce: input.steps_to_reproduce ?? "",
      actualResult: input.actual_result ?? "",
      expectedResult: input.expected_result ?? "",
    };
    if (input.priority) payload.priority = input.priority;
    if (input.page_url) payload.pageUrl = input.page_url;
    const result = await client.post("/api/admin/bugs", payload);
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}

/** `file_feature` — twin of {@link handleFileBug} over `POST /api/admin/feature-requests`. */
export async function handleFileFeature(input: {
  title: string;
  description?: string;
  use_case?: string;
  priority?: string;
  page_url?: string;
}) {
  const client = await getApiClient();
  if (!client) return notAuthenticated();
  if (!client.bound) return notBound(client);
  try {
    const payload: Record<string, unknown> = {
      title: input.title,
      description: input.description ?? "",
      useCase: input.use_case ?? "",
    };
    if (input.priority) payload.priority = input.priority;
    if (input.page_url) payload.pageUrl = input.page_url;
    const result = await client.post("/api/admin/feature-requests", payload);
    return ok(result);
  } catch (err) {
    return apiErr(err);
  }
}
