# Provider: `claude` (Anthropic cloud routine)

The deepest, most automated flow and the only *routine* connector. Follow
this document end-to-end after the shared prep in `SKILL.md`.

## Hybrid split

The routine that runs the schedule lives in **Anthropic's cloud** and is created
over the **`/v1/code/triggers`** API. That API is reachable only by the agent's
**in-process `RemoteTrigger` tool** (OAuth added automatically, never exposed) —
**not** by a standalone CLI and **not** by `curl`. So this is a **hybrid split**:

- **`shipeasy ops trigger prep`** (Bash tool) does the Shipeasy side a binary
  can own — mints the restricted `ops` key, resolves repo + cron, builds the
  routine prompt, and **emits the exact `RemoteTrigger` create body** to a
  `0600` file.
- **You (the agent)** read that body, pick an `environment_id` from your
  `RemoteTrigger` env list, and call **`RemoteTrigger {action:"create"}`**, then
  **`{action:"run"}`** to verify.
- **`shipeasy ops trigger create claude --config '{"routineId":"trig_…"}'`**
  registers the routine as a Shipeasy connector.

There is **no `/schedule` slash command, no GitHub Actions, no `.github/` file**
in this flow.

## Claude-specific rules

- **Never echo the ops key into chat.** The CLI writes the create body (which
  embeds the key in the routine prompt — the only hands-off channel, since
  routine env vars are UI-only) to a `0600` temp file and prints only a masked
  summary. Pass the body to `RemoteTrigger` by reading that file; do not paste
  the key into the conversation.
- **Don't fire a paid run without telling the user.** The verify run
  (`RemoteTrigger {action:"run"}`) spends tokens and may open a real PR. Confirm
  first.
- **Do NOT probe `$ANTHROPIC_API_KEY`** — it's a secret and the Bash env doesn't
  reflect the session's auth anyway. `RemoteTrigger` handles auth in-process.

## 0. Connect GitHub for cloud sessions (one-time)

The routine clones, pushes a `claude/…` branch, and opens its PR under the
user's connected GitHub identity. Connect it (idempotent — don't ask whether
it's already connected):

- **`/web-setup`** when `gh` is installed + authed (syncs the local `gh` token to
  the Claude account), or
- **Authorize the Claude GitHub App** (browser OAuth: `github.com/apps/claude`)
  when `gh` isn't available.

If the user can't complete the consent, stop — a routine that can't open a PR
just burns tokens.

## 1. Ask the cadence

Ask the user for the schedule (skip if `--frequency` was passed). Map
to the `--frequency` value: `4h` (default), `6h`, `daily`, `weekdays`, `weekly`,
or a raw 5-field cron. (The routines API enforces a **1-hour minimum interval**.)

## 2. Run the Shipeasy-side prep

```bash
shipeasy ops trigger prep --frequency <FREQ>      # add --repo <url> if origin isn't the target
```

(`--dry-run` prints the plan and mints nothing.) On success it mints the `ops`
key and prints a **body file path** plus a redacted summary. It does NOT create
the routine — you do, next. Relay the summary (not the key) to the user.

## 3. Pick the cloud environment

The create body has `"environment_id": "<FILL…>"`. List your environments
(they're shown when `/schedule`'s skill loads, or infer from a prior
`RemoteTrigger` context) and pick one whose **network access allows
`shipeasy.ai` + `api.shipeasy.ai`** (plus the package-manager defaults — the run
`npm install`s the CLI). New environments default to **Trusted** (registries +
GitHub only), which would fail every `shipeasy` call.

- A suitable env exists (e.g. one named `shipeasy`) → use its `env_…` id.
- None exists → walk the user through creating one at
  `https://claude.ai/code/routines` → environment → **Custom** network +
  allowed domains `shipeasy.ai`, `api.shipeasy.ai`, "include common package
  managers". Reusable for every future trigger. (Network config is UI-only.)

## 4. Create the routine via RemoteTrigger

Read the body file, replace `environment_id` with the chosen `env_…`, then:

```
RemoteTrigger { action: "create", body: <the edited body> }
```

Capture the returned **`trig_…`** id. (This is the create the old `/schedule`
flow did — now one tool call, no UI.)

## 5. Register the Shipeasy connector

```bash
shipeasy ops trigger create claude --config '{"routineId":"trig_<id>"}'
```

Idempotent by routine id; registers a **tokenless** connector (shows in
Feedback → Connectors as registered but not yet "Fire now"-able). It's the
baseline — the fire token (step 7) is the optional upgrade.

## 6. Verify with one manual run (confirm first — spends tokens)

```
RemoteTrigger { action: "run", trigger_id: "trig_<id>" }
```

Confirm a PR appears (or a clean empty-queue exit). If it fails on Shipeasy auth
inside the run, the `ops` key lapsed (trigger paused > 7 days) — re-run step 2
and re-create. If it fails reaching `api.shipeasy.ai`, the environment's network
is still Trusted — fix step 3.

## 7. (Optional) Add the fire token

The fire token (for "Fire now" + event auto-fire) is **web-UI-only** — there is
no API to mint or read it. To enable it: open
`https://claude.ai/code/routines` → this routine → add an **API** trigger →
**Generate token**, copy it, then:

```bash
shipeasy ops trigger create claude --config '{"routineId":"trig_<id>"}' \
  --token "<token>" --events '["bug.created","feature_request.created"]'
```

(Re-runs the idempotent create, upgrading the same connector in place.) Deferrable
— the schedule already fires without it.

## 8. Hand-off

```
✅ Shipeasy feedback Claude trigger provisioned
Schedule:  <CRON>  (UTC; 1h minimum interval)
Routine:   trig_<id>  (Anthropic cloud — manage at claude.ai/code/routines)
Creds:     restricted `ops` key embedded in the routine prompt (queue reads +
           status flips + link-pr + create-only dev ops; auto-extends 7-day
           expiry on use).
Connector: Shipeasy → Feedback → Connectors ("Claude trigger").
Does:      updates plugin + CLI → runs ops:work --pr → one PR PER fixed item
           (Closes #issue for connected items) → ready_for_qa. Nothing merges.
Manage:    edit/pause the routine at claude.ai/code/routines (RemoteTrigger
           update/run; delete is UI-only). Re-run the shipeasy-ops-trigger
           skill to mint a fresh ops key if the trigger was paused > 7 days.
```
