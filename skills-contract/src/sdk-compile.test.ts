import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import ts from "typescript";

import { type SdkSnippet, extractSdkSnippets } from "./scan.js";

// Every ```ts / ```tsx snippet a skill embeds and tells the reader to write
// against @shipeasy/sdk is type-checked here against the REAL, latest SDK
// (`.d.ts` from the installed package). A renamed facade, a dropped method, a
// wrong argument shape — anything that would make the copied example fail to
// compile in a user's project — fails CI instead of shipping.
//
// Fragments are illustrative: they reference placeholder identifiers (`req`,
// `user_id`, …) that aren't declared. Those surface as TS2304 ("cannot find
// name") and are deliberately ignored — TypeScript's error-type suppression
// stops them cascading, so we still catch drift on the SDK surface itself while
// letting the snippets stay short. See SURFACE_CODES.

const here = dirname(fileURLToPath(import.meta.url));
const PKG = join(here, ".."); // skills-contract package root
const REPO = join(PKG, ".."); // marketplace root
const SKILLS_DIR = join(REPO, "shipeasy", "skills");
// Synthesized files live inside the package so bundler module resolution walks
// up into node_modules and finds @shipeasy/sdk (incl. its /client, /server
// subpath exports).
const WORK = join(PKG, ".snippet-check");

const skillFiles = readdirSync(SKILLS_DIR)
  .map((d) => join(SKILLS_DIR, d, "SKILL.md"))
  .filter(existsSync);

interface Prepared extends SdkSnippet {
  rel: string;
  fileName: string;
  wrapped: string;
}

const snippets: Prepared[] = [];
for (const file of skillFiles) {
  const rel = relative(REPO, file);
  const raw = readFileSync(file, "utf8");
  for (const s of extractSdkSnippets(rel, raw)) {
    const base = rel.replace(/[^a-z0-9]+/gi, "_") + "_" + s.index;
    const fileName = `${base}.${s.lang}`;
    // Hoisted imports at module scope; the rest inside an async fn so the
    // fragments' top-level `await` / `return` stay legal.
    const wrapped = `${s.imports}\nasync function __run() {\n${s.body}\n}\nvoid __run;\n`;
    snippets.push({ ...s, rel, fileName, wrapped });
  }
}

// Semantic diagnostics that indicate a real SDK-surface break. Everything else
// (notably TS2304 for placeholder identifiers) is ignored on purpose.
const SURFACE_CODES = new Set([
  2305, // module has no exported member 'X'
  2724, // module has no exported member named 'X'. Did you mean 'Y'?
  2614, // module has no exported member 'X' (maybe a default import?)
  2307, // cannot find module 'X' or its type declarations (bad subpath)
  2339, // property 'X' does not exist on type 'Y'
  2551, // property 'X' does not exist … Did you mean 'Y'?
  2554, // expected N arguments, but got M
  2345, // argument of type 'X' is not assignable to parameter of type 'Y'
]);

const diagnosticsByFile = new Map<string, string[]>(snippets.map((s) => [s.fileName, []]));

beforeAll(() => {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  // Ambient JSX so ```tsx blocks (intrinsic elements) don't drown the report in
  // unrelated JSX errors; we care about the SDK calls inside them.
  writeFileSync(
    join(WORK, "globals.d.ts"),
    "declare namespace JSX { interface Element {} interface IntrinsicElements { [e: string]: any } }\n",
  );

  const rootNames = [join(WORK, "globals.d.ts")];
  for (const s of snippets) {
    const p = join(WORK, s.fileName);
    writeFileSync(p, s.wrapped);
    rootNames.push(p);
  }

  const options: ts.CompilerOptions = {
    noEmit: true,
    skipLibCheck: true,
    strict: false,
    noImplicitAny: false,
    esModuleInterop: true,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    types: [],
    baseUrl: PKG,
  };

  const program = ts.createProgram(rootNames, options);
  for (const d of program.getSemanticDiagnostics()) {
    if (!d.file || !SURFACE_CODES.has(d.code)) continue;
    const fname = d.file.fileName.split("/").pop()!;
    if (!diagnosticsByFile.has(fname)) continue;
    const { line } = d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : { line: 0 };
    const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
    diagnosticsByFile.get(fname)!.push(`TS${d.code} (line ${line + 1}): ${msg}`);
  }
});

describe("SDK code snippets compile against @shipeasy/sdk", () => {
  // Guard against a broken extractor silently passing.
  it("finds a non-trivial number of SDK snippets", () => {
    expect(snippets.length).toBeGreaterThan(5);
  });

  it.each(snippets.map((s) => [`${s.rel} #${s.index} (${s.lang})`, s] as const))(
    "%s",
    (_label, s) => {
      expect(diagnosticsByFile.get(s.fileName) ?? []).toEqual([]);
    },
  );
});
