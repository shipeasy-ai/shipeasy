import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getApiClient, ApiError } from "../api/client";
import { runI18nCodemod } from "./codemod";
import { withExamples, withDetails } from "../util/examples";

/**
 * Higher-level i18n orchestrators — `i18n extract` and `i18n migrate` — that
 * the `i18n:extract` / `i18n:migrate` slash commands now wrap thinly. Each runs
 * the whole pipeline the skills used to drive by hand (codemod → push →
 * publish) as ONE command, so the orchestration lives in the binary, not in the
 * skill body.
 *
 * The JS/TS AST rewrite lives in the codemod (`runI18nCodemod`). For any other
 * language there is no codemod yet, so these verbs detect the gap and exit with
 * a clear pointer to the per-language docs (the SDK-level extractors are the
 * planned bridge); the slash command's agent step then applies it by hand.
 */

type Keys = Array<{ key: string; value: string }>;

// A project is "JS/TS" for codemod purposes when it has a package.json. Other
// languages (python/ruby/php/go/…) have no codemod and route to the docs path.
function isJsTsProject(cwd: string): boolean {
  return existsSync(join(cwd, "package.json"));
}

// The codemod writes a flat keys file at src/i18n/en.json (or i18n/en.json when
// there's no src/). Mirror that resolution so we can push what it produced.
function resolveKeysFile(cwd: string): string | null {
  const candidates = [join(cwd, "src/i18n/en.json"), join(cwd, "i18n/en.json")];
  return candidates.find(existsSync) ?? null;
}

// Self-contained insert-only push (mirrors `i18n push` batching). Kept local so
// the orchestrators never destabilize the standalone push command.
async function pushKeysToProfile(
  client: ReturnType<typeof getApiClient>,
  profileId: string,
  chunk: string,
  keys: Keys,
): Promise<{ added: string[]; skipped: string[]; failed: string[] }> {
  const BATCH = 100;
  const added: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    try {
      const r = await client.request<{ added?: string[]; skipped?: string[] }>(
        "POST",
        "/api/admin/i18n/keys",
        { profile_id: profileId, chunk, keys: batch },
      );
      if (r.added) added.push(...r.added);
      if (r.skipped) skipped.push(...r.skipped);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      console.error(`  Batch starting at key ${i + 1} failed (${status}).`);
      failed.push(...batch.map((k) => k.key));
    }
  }
  return { added, skipped, failed };
}

async function resolveProfileId(
  client: ReturnType<typeof getApiClient>,
  name: string,
): Promise<string> {
  const profiles = await client.request<Array<{ id: string; name: string }>>(
    "GET",
    "/api/admin/i18n/profiles",
  );
  const p = profiles.find((x) => x.name === name);
  if (!p) {
    console.error(
      `Profile '${name}' not found. Create it with: shipeasy install i18n --profile ${name}`,
    );
    process.exit(1);
  }
  return p.id;
}

// Shared tail for extract + migrate: locate the codemod's keys file, push it,
// optionally publish, and report. `publish` is on by default for extract.
async function pushAndPublish(
  cwd: string,
  opts: { profile: string; chunk: string; project?: string; publish: boolean },
): Promise<void> {
  const file = resolveKeysFile(cwd);
  if (!file) {
    console.log(
      "\nCodemod ran but produced no keys file (src/i18n/en.json) — nothing to push.",
    );
    return;
  }
  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  } catch (e) {
    console.error(`Failed to parse ${file}: ${String(e)}`);
    process.exit(1);
  }
  const keys: Keys = Object.entries(parsed).map(([key, value]) => ({ key, value }));
  if (keys.length === 0) {
    console.log(`\n${file} has no keys — nothing to push.`);
    return;
  }

  const client = getApiClient(opts.project, { requireBinding: true });
  const profileId = await resolveProfileId(client, opts.profile);
  const { added, skipped, failed } = await pushKeysToProfile(client, profileId, opts.chunk, keys);
  console.log(
    `\nPushed ${added.length} new key(s); ${skipped.length} already existed; ${failed.length} failed.`,
  );

  if (opts.publish && failed.length === 0) {
    await client.request("POST", `/api/admin/i18n/profiles/${profileId}/publish`, {
      chunk: opts.chunk,
    });
    console.log(`Published profile '${opts.profile}' chunk '${opts.chunk}' to the CDN.`);
  }
  if (failed.length > 0) process.exit(1);
}

const NON_JS_HINT =
  "No package.json here — this looks like a non-JS/TS project, which has no\n" +
  "codemod yet. Wrap strings using your language's i18n docs:\n" +
  "  shipeasy docs list  --sdk <lang>\n" +
  "  shipeasy docs get   --sdk <lang> i18n\n" +
  "then push the keys with `shipeasy i18n push <file> --profile <profile>`.\n" +
  "(Per-language SDK extractors are the planned bridge; until then the\n" +
  "/shipeasy:i18n:extract skill applies the docs for you.)";

export function i18nWorkflowCommands(i18n: Command): void {
  // ── i18n extract ─────────────────────────────────────────────────────────
  const extract = i18n
    .command("extract [target]")
    .description("Extract hardcoded strings → wrap with i18n.t() → push + publish keys (JS/TS)")
    .option("--profile <name>", "Profile to push keys to", "en:prod")
    .option("--chunk <name>", "Chunk for the keys", "default")
    .option("--dry-run", "Preview the codemod without writing or pushing")
    .option("--no-publish", "Push keys but don't publish to the CDN")
    .option("--project <id>", "Project ID override")
    .action(
      async (
        target: string | undefined,
        opts: {
          profile: string;
          chunk: string;
          dryRun?: boolean;
          publish: boolean;
          project?: string;
        },
      ) => {
        const cwd = process.cwd();
        if (!isJsTsProject(cwd)) {
          console.log(NON_JS_HINT);
          process.exit(2);
        }
        try {
          const scanned = await runI18nCodemod({ target, dryRun: opts.dryRun });
          if (opts.dryRun) {
            console.log(`\nDry run — scanned ${scanned} file(s); no changes written.`);
            return;
          }
          await pushAndPublish(cwd, {
            profile: opts.profile,
            chunk: opts.chunk,
            project: opts.project,
            publish: opts.publish,
          });
        } catch (e) {
          console.error(`\n  Error: ${e instanceof Error ? e.message : String(e)}\n`);
          process.exit(1);
        }
      },
    );

  withDetails(
    extract,
    "Runs the whole extraction pipeline as one command: the AST codemod wraps " +
      "translatable strings with i18n.t() and writes a flat keys file, then those " +
      "keys are pushed (insert-only) and published. For non-JS/TS projects there " +
      "is no codemod — the command points you at the per-language docs and the " +
      "/shipeasy:i18n:extract skill applies them.",
  );
  withExamples(extract, [
    { note: "Extract under auto-detected dirs, push + publish", run: "shipeasy i18n extract" },
    { note: "Target one dir", run: "shipeasy i18n extract ./src" },
    { note: "Preview only", run: "shipeasy i18n extract --dry-run" },
    { note: "Push but don't publish", run: "shipeasy i18n extract --no-publish" },
  ]);

  // ── i18n migrate ───────────────────────────────────────────────────────────
  const SUPPORTED = ["react-i18next", "react-intl", "lingui", "next-intl", "raw-i18next"];
  const migrate = i18n
    .command("migrate <library>")
    .description(`Migrate an existing i18n library to Shipeasy (${SUPPORTED.join(", ")})`)
    .option("--profile <name>", "Profile to push existing translations to", "en:prod")
    .option("--chunk <name>", "Chunk for the keys", "default")
    .option("--dry-run", "Preview the migration without writing or pushing")
    .option("--no-publish", "Push keys but don't publish to the CDN")
    .option("--project <id>", "Project ID override")
    .action(
      async (
        library: string,
        opts: {
          profile: string;
          chunk: string;
          dryRun?: boolean;
          publish: boolean;
          project?: string;
        },
      ) => {
        if (!SUPPORTED.includes(library)) {
          console.error(`Unsupported source '${library}'. Supported: ${SUPPORTED.join(", ")}.`);
          process.exit(1);
        }
        const cwd = process.cwd();
        if (!isJsTsProject(cwd)) {
          console.log(NON_JS_HINT);
          process.exit(2);
        }
        try {
          const scanned = await runI18nCodemod({ migrate: library, dryRun: opts.dryRun });
          if (opts.dryRun) {
            console.log(`\nDry run — scanned ${scanned} file(s); no changes written.`);
            return;
          }
          // Migrations rewrite call sites; existing en.json (if any) is pushed.
          await pushAndPublish(cwd, {
            profile: opts.profile,
            chunk: opts.chunk,
            project: opts.project,
            publish: opts.publish,
          });
          console.log(
            "\nReview the diff, then remove the old library (e.g. `pnpm remove " +
              `${library}\`) and run your build.`,
          );
        } catch (e) {
          console.error(`\n  Error: ${e instanceof Error ? e.message : String(e)}\n`);
          process.exit(1);
        }
      },
    );

  withExamples(migrate, [
    { note: "Migrate from react-i18next", run: "shipeasy i18n migrate react-i18next" },
    { note: "Preview the migration", run: "shipeasy i18n migrate next-intl --dry-run" },
  ]);
}
